import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "mocha";
import * as vscode from "vscode";

const COMMAND_ID = "mocha-debug-helper.toggleDebug";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureExtensionActivated(): Promise<void> {
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
  it("toggle command cycles debug marker states", async () => {
    await ensureExtensionActivated();

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
    await ensureExtensionActivated();

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
});
