import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { before, describe, it } from "mocha";
import * as vscode from "vscode";
import { __setTestHooks } from "../../src/extension";

const COMMAND_ID = "mocha-debug-helper.toggleDebug";
const RUN_SCRIPT_COMMAND_ID = "mocha-debug-helper.runScriptForFocusedFile";
const SCRIPT_RUNNER_CONFIG_PREFIX = "narukami-dev.mochaTestDebugHelper.scriptRunner";
const capturedOutput: string[] = [];
const capturedProgressTitles: string[] = [];
let vscodeWindowPatched = false;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function patchVscodeWindowForScriptRunnerSpies(): void {
  if (vscodeWindowPatched) {
    return;
  }

  const windowApi = vscode.window as unknown as {
    withProgress: typeof vscode.window.withProgress;
  };
  const originalWithProgress = windowApi.withProgress.bind(vscode.window);

  windowApi.withProgress = async <R>(
    options: vscode.ProgressOptions,
    task: (
      progress: vscode.Progress<{ message?: string; increment?: number }>,
      token: vscode.CancellationToken,
    ) => Thenable<R>,
  ): Promise<R> => {
    capturedProgressTitles.push(options.title ?? "");
    return originalWithProgress(options, task);
  };

  vscodeWindowPatched = true;
}

async function ensureExtensionActivated(): Promise<void> {
  __setTestHooks({
    createOutputChannel: (name: string): vscode.OutputChannel =>
      ({
        name,
        append(value: string): void {
          capturedOutput.push(value);
        },
        appendLine(value: string): void {
          capturedOutput.push(`${value}\n`);
        },
        clear(): void {
          capturedOutput.length = 0;
        },
        show(): void {
          // no-op for test
        },
        hide(): void {
          // no-op for test
        },
        replace(value: string): void {
          capturedOutput.length = 0;
          capturedOutput.push(value);
        },
        dispose(): void {
          // no-op for test
        },
      }) as vscode.OutputChannel,
  });
  patchVscodeWindowForScriptRunnerSpies();
  const extension = vscode.extensions.all.find(
    (item) => item.packageJSON?.name === "mocha-test-debug-helper",
  );
  if (extension && !extension.isActive) {
    await extension.activate();
  }
}

async function createTempTestFile(fileName: string, content: string): Promise<vscode.Uri> {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const baseDir = workspace ?? path.join(os.tmpdir(), "mocha-test-debug-helper-tests");
  const tempDir = path.join(baseDir, ".tmp-tests");
  await fs.mkdir(tempDir, { recursive: true });

  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return vscode.Uri.file(filePath);
}

describe("extension integration", () => {
  before(async () => {
    await ensureExtensionActivated();
  });

  it("toggle command cycles debug marker states", async () => {
    const uri = await createTempTestFile(
      "toggle-cycle.ts",
      ["describe('', async function(){", "    test('', async function(){", "        console.log('x')", "    })", "})"].join("\n"),
    );
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);

    editor.selection = new vscode.Selection(new vscode.Position(2, 8), new vscode.Position(2, 8));
    await vscode.commands.executeCommand(COMMAND_ID);
    assert.strictEqual(doc.lineAt(2).text.trim(), "//@debug");

    await vscode.commands.executeCommand(COMMAND_ID);
    assert.strictEqual(doc.lineAt(2).text.trim(), "//@undebug");

    await vscode.commands.executeCommand(COMMAND_ID);
    assert.notStrictEqual(doc.lineAt(2).text.trim(), "//@undebug");
  });

  it("on save with //@debug comments only valid lines before marker", async () => {
    const uri = await createTempTestFile(
      "save-debug.ts",
      [
        "describe('', async function(){",
        "    before('', async function(){",
        "        console.log('1')",
        "    })",
        "    test('', async function(){",
        "        const a = 'abc'",
        "        console.log('2')",
        "    })",
        "    //@debug",
        "})",
      ].join("\n"),
    );
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);

    await editor.edit((builder) => {
      builder.insert(new vscode.Position(8, doc.lineAt(8).text.length), " ");
    });
    await doc.save();
    await sleep(700);

    const refreshed = await vscode.workspace.openTextDocument(uri);
    const lines = refreshed.getText().split(/\r?\n/);

    assert.strictEqual(lines[2].trim(), "//console.log('1')");
    assert.strictEqual(lines[5].trim(), "const a = 'abc'");
    assert.strictEqual(lines[6].trim(), "//console.log('2')");
  });

  it("manual run (runOnSave=false) shows progress toast and writes output channel logs", async () => {
    capturedOutput.length = 0;
    capturedProgressTitles.length = 0;

    const scriptConfig = vscode.workspace.getConfiguration(SCRIPT_RUNNER_CONFIG_PREFIX);
    await scriptConfig.update("runOnSave", false, vscode.ConfigurationTarget.Workspace);
    const marker = "custom-shortcut-output-marker";
    await scriptConfig.update(
      "command",
      `node -e "console.log('${marker}')"`,
      vscode.ConfigurationTarget.Workspace,
    );

    const uri = await createTempTestFile("manual-script-run.ts", "const x = 1;\n");
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    await vscode.commands.executeCommand(RUN_SCRIPT_COMMAND_ID);
    await sleep(300);

    assert.ok(
      capturedProgressTitles.some((title) => title.includes("Running script: node -e")),
      "expected running toast/progress title to be shown",
    );
    assert.ok(
      capturedOutput.join("").includes(marker),
      "expected script stdout marker to be written to output channel",
    );
  });
});
