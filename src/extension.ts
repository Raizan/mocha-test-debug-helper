import * as vscode from "vscode";
import {
  DEFAULT_FUNCTION_ALLOWLIST,
  DEFAULT_PROTECTED_FUNCTIONS,
  processFileOnSave,
} from "./processor";
import {
  buildScriptCommand,
  getConfiguredScriptCommand,
  runScriptCommand as executeScriptCommand,
  ScriptExecutionError,
  shouldRunOnSaveForFile,
} from "./scriptRunner";

const DEBUG_TAG = "//@debug";
const UNDEBUG_TAG = "//@undebug";
const MARKER_LANGS = new Set(["javascript", "typescript"]);
const SCRIPT_RUNNER_OUTPUT_CHANNEL = "Mocha Test Debug Helper";

type ExtensionTestHooks = {
  createOutputChannel?: (name: string) => vscode.OutputChannel;
};

let extensionTestHooks: ExtensionTestHooks | undefined;

export function __setTestHooks(hooks?: ExtensionTestHooks): void {
  extensionTestHooks = hooks;
}

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

async function runScriptForDocument(
  document: vscode.TextDocument,
  outputChannel: vscode.OutputChannel,
  options?: {
    showNoCommandError?: boolean;
  },
): Promise<void> {
  const showNoCommandError = options?.showNoCommandError ?? true;

  if (document.uri.scheme !== "file") {
    await vscode.window.showErrorMessage("Script runner only supports local files.");
    return;
  }

  const config = vscode.workspace.getConfiguration("narukami-dev.mochaTestDebugHelper.scriptRunner");
  const configuredCommand = getConfiguredScriptCommand(config.get<unknown>("command", ""));
  if (!configuredCommand) {
    if (showNoCommandError) {
      await vscode.window.showErrorMessage(
        "No script configured. Set 'narukami-dev.mochaTestDebugHelper.scriptRunner.command'.",
      );
    }
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const filePath = document.uri.fsPath;
  const command = buildScriptCommand(configuredCommand, filePath);
  const cwd = workspaceFolder?.uri.fsPath;
  const timestamp = new Date().toISOString();

  outputChannel.appendLine(`[${timestamp}] Running script for: ${filePath}`);
  outputChannel.appendLine(`Command: ${command}`);

  try {
    const displayCommand =
      configuredCommand.length > 80 ? `${configuredCommand.slice(0, 77)}...` : configuredCommand;
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running script: ${displayCommand}`,
        cancellable: false,
      },
      async () => executeScriptCommand(command, cwd),
    );
    if (result.stdout.trim().length > 0) {
      outputChannel.appendLine("stdout:");
      outputChannel.append(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
    }
    if (result.stderr.trim().length > 0) {
      outputChannel.appendLine("stderr:");
      outputChannel.append(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
    }
    outputChannel.appendLine("Script finished successfully.");
  } catch (error) {
    if (error instanceof ScriptExecutionError) {
      outputChannel.appendLine(`Script failed (exit code: ${error.exitCode ?? "unknown"}).`);
      if (error.stdout.trim().length > 0) {
        outputChannel.appendLine("stdout:");
        outputChannel.append(error.stdout.endsWith("\n") ? error.stdout : `${error.stdout}\n`);
      }
      if (error.stderr.trim().length > 0) {
        outputChannel.appendLine("stderr:");
        outputChannel.append(error.stderr.endsWith("\n") ? error.stderr : `${error.stderr}\n`);
      }
      outputChannel.show(true);
      await vscode.window.showErrorMessage(
        `Script runner failed. Check '${SCRIPT_RUNNER_OUTPUT_CHANNEL}' output for details.`,
      );
      return;
    }

    throw error;
  } finally {
    outputChannel.appendLine("---");
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const skipNextSaveForDocument = new Set<string>();
  const skipNextSaveScriptRunnerForDocument = new Set<string>();
  const outputChannel = (extensionTestHooks?.createOutputChannel ?? vscode.window.createOutputChannel)(
    SCRIPT_RUNNER_OUTPUT_CHANNEL,
  );

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

  const runScriptCommand = vscode.commands.registerCommand(
    "mocha-debug-helper.runScriptForFocusedFile",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      try {
        const key = editor.document.uri.toString();
        skipNextSaveScriptRunnerForDocument.add(key);
        const didSave = await editor.document.save();
        if (!didSave) {
          skipNextSaveScriptRunnerForDocument.delete(key);
          return;
        }
        await runScriptForDocument(editor.document, outputChannel, {
          showNoCommandError: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await vscode.window.showErrorMessage(`Script Runner Error: ${message}`);
      }
    },
  );

  const onSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
    const key = document.uri.toString();
    let skipDebugProcessorForThisSave = false;
    if (skipNextSaveForDocument.has(key)) {
      skipNextSaveForDocument.delete(key);
      skipDebugProcessorForThisSave = true;
    }

    if (!skipDebugProcessorForThisSave && MARKER_LANGS.has(document.languageId)) {
      const text = document.getText();
      if (text.includes(DEBUG_TAG) || text.includes(UNDEBUG_TAG)) {
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
          if (didChange) {
            skipNextSaveForDocument.add(key);
            await document.save();
            return;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await vscode.window.showErrorMessage(`Debug Helper Error: ${message}`);
        }
      }
    }

    if (skipNextSaveScriptRunnerForDocument.has(key)) {
      skipNextSaveScriptRunnerForDocument.delete(key);
      return;
    }

    const scriptRunnerConfig = vscode.workspace.getConfiguration(
      "narukami-dev.mochaTestDebugHelper.scriptRunner",
    );
    const runOnSave = scriptRunnerConfig.get<boolean>("runOnSave", true);
    if (!runOnSave) {
      return;
    }
    const runOnSaveExtensions = scriptRunnerConfig.get<unknown>("runOnSaveExtensions", []);
    if (!shouldRunOnSaveForFile(document.uri.fsPath, runOnSaveExtensions)) {
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || activeEditor.document.uri.toString() !== key) {
      return;
    }

    try {
      await runScriptForDocument(document, outputChannel, {
        showNoCommandError: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await vscode.window.showErrorMessage(`Script Runner Error: ${message}`);
    }
  });

  context.subscriptions.push(toggleCommand, runScriptCommand, onSave, outputChannel);
}

export function deactivate(): void { }
