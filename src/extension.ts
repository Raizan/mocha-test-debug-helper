import * as vscode from "vscode";
import {
  DEFAULT_FUNCTION_ALLOWLIST,
  DEFAULT_PROTECTED_FUNCTIONS,
  processFileOnSave,
} from "./processor";

const DEBUG_TAG = "//@debug";
const UNDEBUG_TAG = "//@undebug";
const MARKER_LANGS = new Set(["javascript", "typescript"]);

function getLeadingWhitespace(text: string): string {
  const match = text.match(/^\s*/);
  return match ? match[0] : "";
}

async function toggleDebugMarker(editor: vscode.TextEditor): Promise<void> {
  const document = editor.document;
  const lineIndex = editor.selection.active.line;
  const line = document.lineAt(lineIndex);
  const lineText = line.text;
  const trimmed = lineText.trim();
  const indent = getLeadingWhitespace(lineText);

  let nextCursor: vscode.Position | undefined;

  await editor.edit((builder) => {
    if (trimmed === DEBUG_TAG) {
      const replacement = `${indent}${UNDEBUG_TAG}`;
      builder.replace(line.range, replacement);
      nextCursor = new vscode.Position(lineIndex, replacement.length);
      return;
    }

    if (trimmed === UNDEBUG_TAG) {
      builder.delete(line.rangeIncludingLineBreak);
      const prevLineIndex = Math.max(0, lineIndex - 1);
      const prevLineText = prevLineIndex < document.lineCount ? document.lineAt(prevLineIndex).text : "";
      nextCursor = new vscode.Position(prevLineIndex, prevLineText.length);
      return;
    }

    if (trimmed.length > 0) {
      const insertion = `${indent}${DEBUG_TAG}\n`;
      builder.insert(new vscode.Position(lineIndex, 0), insertion);
      nextCursor = new vscode.Position(lineIndex, `${indent}${DEBUG_TAG}`.length);
      return;
    }

    const replacement = `${indent}${DEBUG_TAG}`;
    builder.replace(line.range, replacement);
    nextCursor = new vscode.Position(lineIndex, replacement.length);
  });

  if (nextCursor) {
    editor.selection = new vscode.Selection(nextCursor, nextCursor);
    editor.revealRange(new vscode.Range(nextCursor, nextCursor));
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const skipNextSaveForDocument = new Set<string>();

  const toggleCommand = vscode.commands.registerCommand("mocha-debug-helper.toggleDebug", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    if (!MARKER_LANGS.has(editor.document.languageId)) {
      return;
    }

    await toggleDebugMarker(editor);
  });

  const onSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    if (!MARKER_LANGS.has(document.languageId)) {
      return;
    }

    const key = document.uri.toString();
    if (skipNextSaveForDocument.has(key)) {
      skipNextSaveForDocument.delete(key);
      return;
    }

    const text = document.getText();
    if (!text.includes(DEBUG_TAG) && !text.includes(UNDEBUG_TAG)) {
      return;
    }

    try {
      const config = vscode.workspace.getConfiguration("narukami-dev.mochaTestDebugHelper");
      const protectedFunctions = config.get<string[]>(
        "protectedFunctions",
        DEFAULT_PROTECTED_FUNCTIONS,
      );
      const functionAllowlist = config.get<string[]>(
        "functionAllowlist",
        DEFAULT_FUNCTION_ALLOWLIST,
      );

      const didChange = await processFileOnSave(document, {
        protectedFunctions,
        functionAllowlist,
      });
      if (!didChange) {
        return;
      }

      skipNextSaveForDocument.add(key);
      await document.save();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await vscode.window.showErrorMessage(`Debug Helper Error: ${message}`);
    }
  });

  context.subscriptions.push(toggleCommand, onSave);
}

export function deactivate(): void {}
