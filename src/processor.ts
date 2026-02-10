import * as vscode from "vscode";
import { Block, CallExpression, Node, Project, SourceFile, SyntaxKind } from "ts-morph";

const DEBUG_TAG = "//@debug";
const UNDEBUG_TAG = "//@undebug";

const PROTECTED_FUNCTIONS = new Set([
  "describe",
  "before",
  "beforeEach",
  "test",
  "it",
  "after",
  "afterEach",
  "step",
]);

type Mode = "debug" | "undebug";

type MarkerInfo = {
  mode: Mode;
  markerLine: number;
  markerOffset: number;
};

type LineRange = {
  startLine: number;
  endLine: number;
};

type ProtectedCallInfo = LineRange & {
  bodyStartLine?: number;
  bodyEndLine?: number;
};

const PROTECTED_CALL_LINE_PATTERN =
  /^\s*(?:\/\/+\s*)?(?:await\s+)?(?:describe|before|beforeEach|test|it|after|afterEach|step)\s*\(/;

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

function getProtectedLines(sourceFile: SourceFile): Set<number> {
  const protectedLines = new Set<number>();

  sourceFile.forEachDescendant((node) => {
    if (Node.isCallExpression(node)) {
      const expression = node.getExpression();
      if (Node.isIdentifier(expression)) {
        const fnName = expression.getText();
        if (PROTECTED_FUNCTIONS.has(fnName)) {
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

    if (Node.isVariableStatement(node)) {
      const start = node.getStartLineNumber() - 1;
      const end = node.getEndLineNumber() - 1;
      addProtectedRange(protectedLines, start, end);
    }
  });

  return protectedLines;
}

function getProtectedCallInfos(sourceFile: SourceFile): ProtectedCallInfo[] {
  const infos: ProtectedCallInfo[] = [];

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) {
      return;
    }

    const expression = node.getExpression();
    if (!Node.isIdentifier(expression)) {
      return;
    }

    if (!PROTECTED_FUNCTIONS.has(expression.getText())) {
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

function getRegexProtectedLines(lines: string[]): Set<number> {
  const protectedLines = new Set<number>();
  for (let i = 0; i < lines.length; i += 1) {
    if (PROTECTED_CALL_LINE_PATTERN.test(lines[i])) {
      protectedLines.add(i);
    }
  }
  return protectedLines;
}

function hasAmbiguousInnerProtectedCallBeforeMarker(
  lines: string[],
  markerLine: number,
  callInfos: ProtectedCallInfo[],
): boolean {
  for (let i = markerLine - 1; i >= 0; i -= 1) {
    if (!PROTECTED_CALL_LINE_PATTERN.test(lines[i])) {
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

function isProtectedCallbackBlock(block: Node): boolean {
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

  return PROTECTED_FUNCTIONS.has(expression.getText());
}

function getProcessingStartLine(
  sourceFile: SourceFile,
  markerOffset: number,
): number | undefined {
  const markerNode =
    sourceFile.getDescendantAtPos(markerOffset) ??
    sourceFile.getDescendantAtPos(Math.max(markerOffset - 1, 0));

  if (!markerNode) {
    return undefined;
  }

  const candidateBlocks = markerNode
    .getAncestors()
    .filter((ancestor) => Node.isBlock(ancestor) && isProtectedCallbackBlock(ancestor));

  if (candidateBlocks.length === 0) {
    return undefined;
  }

  // getAncestors() is ordered from nearest parent to farthest; use nearest protected block.
  const nearestProtectedBlock = candidateBlocks[0];
  return nearestProtectedBlock.getStartLineNumber();
}

export function computeTransformedText(text: string): string {
  const markerInfo = getMarkerInfo(text);
  if (!markerInfo) {
    return text;
  }

  const lines = text.split(/\r?\n/);
  const parseText = markerInfo.mode === "undebug" ? stripFirstCommentPrefixPerLine(text) : text;
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile("temp.ts", parseText, { overwrite: true });
  const protectedCallInfos = getProtectedCallInfos(sourceFile);
  if (hasAmbiguousInnerProtectedCallBeforeMarker(lines, markerInfo.markerLine, protectedCallInfos)) {
    return text;
  }
  const protectedLines = getProtectedLines(sourceFile);
  for (const protectedLine of getRegexProtectedLines(lines)) {
    protectedLines.add(protectedLine);
  }
  const processingStartLine = getProcessingStartLine(
    sourceFile,
    markerInfo.markerOffset,
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

export async function processFileOnSave(document: vscode.TextDocument): Promise<boolean> {
  const originalText = document.getText();
  const transformedText = computeTransformedText(originalText);

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
