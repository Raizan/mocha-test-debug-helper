
import * as vscode from "vscode";
import { Block, CallExpression, Node, Project, SourceFile, SyntaxKind } from "ts-morph";

const DEBUG_TAG = "//@debug";
const UNDEBUG_TAG = "//@undebug";

const DEFAULT_PROTECTED_FUNCTIONS = [
  "describe",
  "before",
  "beforeEach",
  "test",
  "it",
  "after",
  "afterEach",
  "step",
];

const DEFAULT_FUNCTION_ALLOWLIST: string[] = [];

type Mode = "debug" | "undebug";

type MarkerInfo = {
  mode: Mode;
  markerLine: number;
  markerOffset: number;
};

export type ProcessorConfig = {
  protectedFunctions: string[];
  functionAllowlist: string[];
};

type LineRange = {
  startLine: number;
  endLine: number;
};

type ProtectedCallInfo = LineRange & {
  bodyStartLine?: number;
  bodyEndLine?: number;
};

function getDefaultConfig(): ProcessorConfig {
  return {
    protectedFunctions: [...DEFAULT_PROTECTED_FUNCTIONS],
    functionAllowlist: [...DEFAULT_FUNCTION_ALLOWLIST],
  };
}

function normalizeConfig(config?: Partial<ProcessorConfig>): ProcessorConfig {
  const defaults = getDefaultConfig();

  const protectedFunctions = (config?.protectedFunctions ?? defaults.protectedFunctions)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const functionAllowlist = (config?.functionAllowlist ?? defaults.functionAllowlist)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return {
    protectedFunctions,
    functionAllowlist,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getProtectedCallLinePattern(protectedFunctions: string[]): RegExp | undefined {
  if (protectedFunctions.length === 0) {
    return undefined;
  }

  const fnPart = protectedFunctions.map(escapeRegex).join("|");
  return new RegExp(`^\\s*(?:\\/\\/+\\s*)?(?:await\\s+)?(?:${fnPart})\\s*\\(`);
}

function getLineStartOffsets(lines: string[], eol: string): number[] {
  const offsets: number[] = [];
  let running = 0;
  for (const line of lines) {
    offsets.push(running);
    running += line.length + eol.length;
  }
  return offsets;
}

function getMarkerInfo(text: string): MarkerInfo | undefined {
  const lines = text.split(/\r?\n/);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const offsets = getLineStartOffsets(lines, eol);
  const debugLines: number[] = [];
  const undebugLines: number[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === DEBUG_TAG) {
      debugLines.push(i);
    }
    if (trimmed === UNDEBUG_TAG) {
      undebugLines.push(i);
    }
  }

  if (debugLines.length > 1) {
    throw new Error("Multiple //@debug tags found.");
  }
  if (undebugLines.length > 1) {
    throw new Error("Multiple //@undebug tags found.");
  }
  if (debugLines.length > 0 && undebugLines.length > 0) {
    throw new Error("Found both //@debug and //@undebug tags.");
  }
  if (debugLines.length === 0 && undebugLines.length === 0) {
    return undefined;
  }

  if (debugLines.length === 1) {
    return {
      mode: "debug",
      markerLine: debugLines[0],
      markerOffset: offsets[debugLines[0]],
    };
  }

  return {
    mode: "undebug",
    markerLine: undebugLines[0],
    markerOffset: offsets[undebugLines[0]],
  };
}

function stripFirstCommentPrefixPerLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^(\s*)\/\//, "$1"))
    .join("\n");
}

function addProtectedRange(target: Set<number>, start: number, end: number): void {
  for (let line = start; line <= end; line += 1) {
    target.add(line);
  }
}

function getProtectedCallbackBodyBlock(callExpression: CallExpression): Block | undefined {
  const functionLikeArg = [...callExpression.getArguments()].find((arg) => {
    return Node.isFunctionExpression(arg) || Node.isArrowFunction(arg);
  });

  if (!functionLikeArg) {
    return undefined;
  }

  if (Node.isFunctionExpression(functionLikeArg)) {
    const body = functionLikeArg.getBody();
    if (Node.isBlock(body)) {
      return body;
    }
    return undefined;
  }

  if (Node.isArrowFunction(functionLikeArg)) {
    const body = functionLikeArg.getBody();
    if (Node.isBlock(body)) {
      return body;
    }
  }

  return undefined;
}

function unwrapExpression(node: Node): Node {
  let current = node;
  while (true) {
    if (Node.isParenthesizedExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isAwaitExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isAsExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isSatisfiesExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isTypeAssertion(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isNonNullExpression(current)) {
      current = current.getExpression();
      continue;
    }
    return current;
  }
}

function getCallName(expression: Node): string | undefined {
  const normalized = unwrapExpression(expression);
  if (!Node.isCallExpression(normalized)) {
    return undefined;
  }

  const target = normalized.getExpression();
  if (Node.isIdentifier(target)) {
    return target.getText();
  }

  if (Node.isPropertyAccessExpression(target)) {
    return target.getName();
  }

  return undefined;
}

function shouldProtectVariableStatement(
  node: Node,
  functionAllowlist: Set<string>,
): boolean {
  if (!Node.isVariableStatement(node)) {
    return false;
  }

  const declarations = node.getDeclarations();
  if (declarations.length === 0) {
    return true;
  }

  for (const declaration of declarations) {
    const initializer = declaration.getInitializer();
    if (!initializer) {
      continue;
    }

    const callName = getCallName(initializer);
    if (!callName) {
      continue;
    }

    if (!functionAllowlist.has(callName)) {
      return false;
    }
  }

  return true;
}

function getProtectedLines(
  sourceFile: SourceFile,
  protectedFunctions: Set<string>,
  functionAllowlist: Set<string>,
): Set<number> {
  const protectedLines = new Set<number>();

  sourceFile.forEachDescendant((node) => {
    if (Node.isCallExpression(node)) {
      const expression = node.getExpression();
      if (Node.isIdentifier(expression)) {
        const fnName = expression.getText();
        if (protectedFunctions.has(fnName)) {
          const callStart = node.getStartLineNumber() - 1;
          const callEnd = node.getEndLineNumber() - 1;
          const callbackBodyBlock = getProtectedCallbackBodyBlock(node);

          if (!callbackBodyBlock) {
            addProtectedRange(protectedLines, callStart, callEnd);
            return;
          }

          const bodyStart = callbackBodyBlock.getStartLineNumber() - 1;
          const bodyEnd = callbackBodyBlock.getEndLineNumber() - 1;

          // Protect call signature lines up to callback block opening line.
          addProtectedRange(protectedLines, callStart, bodyStart);
          // Protect callback close + trailing call closure lines (for multiline `});`).
          addProtectedRange(protectedLines, bodyEnd, callEnd);
        }
      }
    }

    if (Node.isVariableStatement(node) && shouldProtectVariableStatement(node, functionAllowlist)) {
      const start = node.getStartLineNumber() - 1;
      const end = node.getEndLineNumber() - 1;
      addProtectedRange(protectedLines, start, end);
    }
  });

  return protectedLines;
}

function getProtectedCallInfos(
  sourceFile: SourceFile,
  protectedFunctions: Set<string>,
): ProtectedCallInfo[] {
  const infos: ProtectedCallInfo[] = [];

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) {
      return;
    }

    const expression = node.getExpression();
    if (!Node.isIdentifier(expression)) {
      return;
    }

    if (!protectedFunctions.has(expression.getText())) {
      return;
    }

    const callbackBodyBlock = getProtectedCallbackBodyBlock(node);
    infos.push({
      startLine: node.getStartLineNumber() - 1,
      endLine: node.getEndLineNumber() - 1,
      bodyStartLine: callbackBodyBlock ? callbackBodyBlock.getStartLineNumber() - 1 : undefined,
      bodyEndLine: callbackBodyBlock ? callbackBodyBlock.getEndLineNumber() - 1 : undefined,
    });
  });

  return infos;
}

function getRegexProtectedLines(
  lines: string[],
  protectedCallLinePattern: RegExp | undefined,
): Set<number> {
  const protectedLines = new Set<number>();
  if (!protectedCallLinePattern) {
    return protectedLines;
  }

  for (let i = 0; i < lines.length; i += 1) {
    if (protectedCallLinePattern.test(lines[i])) {
      protectedLines.add(i);
    }
  }
  return protectedLines;
}

function hasAmbiguousInnerProtectedCallBeforeMarker(
  lines: string[],
  markerLine: number,
  callInfos: ProtectedCallInfo[],
  protectedCallLinePattern: RegExp | undefined,
): boolean {
  if (!protectedCallLinePattern) {
    return false;
  }

  for (let i = markerLine - 1; i >= 0; i -= 1) {
    if (!protectedCallLinePattern.test(lines[i])) {
      continue;
    }

    const matchingCallInfo = callInfos.find((info) => info.startLine === i);
    if (!matchingCallInfo) {
      return true;
    }

    if (matchingCallInfo.endLine < markerLine) {
      return false;
    }

    if (
      matchingCallInfo.bodyStartLine === undefined ||
      matchingCallInfo.bodyEndLine === undefined
    ) {
      return true;
    }

    const markerInsideBody =
      markerLine > matchingCallInfo.bodyStartLine &&
      markerLine < matchingCallInfo.bodyEndLine;

    return !markerInsideBody;
  }

  return false;
}

function isProtectedCallbackBlock(block: Node, protectedFunctions: Set<string>): boolean {
  if (!Node.isBlock(block)) {
    return false;
  }

  const parent = block.getParent();
  if (!parent) {
    return false;
  }

  if (!Node.isArrowFunction(parent) && !Node.isFunctionExpression(parent)) {
    return false;
  }

  const callExpression = parent.getParentIfKind(SyntaxKind.CallExpression);
  if (!callExpression) {
    return false;
  }

  const expression = callExpression.getExpression();
  if (!Node.isIdentifier(expression)) {
    return false;
  }

  return protectedFunctions.has(expression.getText());
}

function getProcessingStartLine(
  sourceFile: SourceFile,
  markerOffset: number,
  protectedFunctions: Set<string>,
): number | undefined {
  const markerNode =
    sourceFile.getDescendantAtPos(markerOffset) ??
    sourceFile.getDescendantAtPos(Math.max(markerOffset - 1, 0));

  if (!markerNode) {
    return undefined;
  }

  const candidateBlocks = markerNode
    .getAncestors()
    .filter(
      (ancestor) =>
        Node.isBlock(ancestor) && isProtectedCallbackBlock(ancestor, protectedFunctions),
    );

  if (candidateBlocks.length === 0) {
    return undefined;
  }

  // getAncestors() is ordered from nearest parent to farthest; use nearest protected block.
  const nearestProtectedBlock = candidateBlocks[0];
  return nearestProtectedBlock.getStartLineNumber();
}

export function computeTransformedText(text: string): string {
  return computeTransformedTextWithConfig(text);
}

export function computeTransformedTextWithConfig(
  text: string,
  config?: Partial<ProcessorConfig>,
): string {
  const markerInfo = getMarkerInfo(text);
  if (!markerInfo) {
    return text;
  }

  const normalizedConfig = normalizeConfig(config);
  const protectedFunctions = new Set(normalizedConfig.protectedFunctions);
  const functionAllowlist = new Set(normalizedConfig.functionAllowlist);
  const protectedCallLinePattern = getProtectedCallLinePattern(
    normalizedConfig.protectedFunctions,
  );

  const lines = text.split(/\r?\n/);
  const parseText = markerInfo.mode === "undebug" ? stripFirstCommentPrefixPerLine(text) : text;
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile("temp.ts", parseText, { overwrite: true });
  const protectedCallInfos = getProtectedCallInfos(sourceFile, protectedFunctions);
  if (
    hasAmbiguousInnerProtectedCallBeforeMarker(
      lines,
      markerInfo.markerLine,
      protectedCallInfos,
      protectedCallLinePattern,
    )
  ) {
    return text;
  }
  const protectedLines = getProtectedLines(
    sourceFile,
    protectedFunctions,
    functionAllowlist,
  );
  for (const protectedLine of getRegexProtectedLines(lines, protectedCallLinePattern)) {
    protectedLines.add(protectedLine);
  }
  const processingStartLine = getProcessingStartLine(
    sourceFile,
    markerInfo.markerOffset,
    protectedFunctions,
  );
  if (processingStartLine === undefined) {
    return text;
  }

  for (let lineIndex = processingStartLine; lineIndex < markerInfo.markerLine; lineIndex += 1) {
    if (protectedLines.has(lineIndex)) {
      continue;
    }

    const originalLine = lines[lineIndex];
    if (!originalLine || originalLine.trim().length === 0) {
      continue;
    }

    if (markerInfo.mode === "debug") {
      const leadingWhitespace = getLeadingWhitespace(originalLine);
      const lineWithoutIndent = originalLine.slice(leadingWhitespace.length);
      lines[lineIndex] = `${leadingWhitespace}//${lineWithoutIndent}`;
      continue;
    }

    const match = originalLine.match(/^(\s*)\/\/(.*)$/);
    if (!match) {
      continue;
    }
    lines[lineIndex] = `${match[1]}${match[2]}`;
  }

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return lines.join(eol);
}

function getLeadingWhitespace(text: string): string {
  const match = text.match(/^\s*/);
  return match ? match[0] : "";
}

export async function processFileOnSave(
  document: vscode.TextDocument,
  config?: Partial<ProcessorConfig>,
): Promise<boolean> {
  const originalText = document.getText();
  const transformedText = computeTransformedTextWithConfig(originalText, config);

  if (transformedText === originalText) {
    return false;
  }

  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(originalText.length),
  );

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, fullRange, transformedText);
  const applied = await vscode.workspace.applyEdit(edit);

  return applied;
}

export { DEFAULT_FUNCTION_ALLOWLIST, DEFAULT_PROTECTED_FUNCTIONS };
