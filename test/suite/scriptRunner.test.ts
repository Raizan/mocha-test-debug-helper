import * as assert from "node:assert";
import { describe, it } from "mocha";
import {
  buildScriptCommand,
  getConfiguredScriptCommand,
  shouldRunOnSaveForFile,
} from "../../src/scriptRunner";

describe("script runner logic", () => {
  it("reads configured script command", () => {
    const command = getConfiguredScriptCommand("  node ./scripts/process-file.js  ");
    assert.strictEqual(command, "node ./scripts/process-file.js");
  });

  it("returns undefined for empty script command", () => {
    assert.strictEqual(getConfiguredScriptCommand("   "), undefined);
  });

  it("throws when configured command setting is not a string", () => {
    assert.throws(() => getConfiguredScriptCommand(123), /must be a string/);
  });

  it("builds command by appending quoted file path", () => {
    const command = buildScriptCommand(
      "node ./scripts/process-file.js",
      "/workspace/src/my file.ts",
    );
    assert.strictEqual(
      command,
      "node ./scripts/process-file.js '/workspace/src/my file.ts'",
    );
  });

  it("escapes single quotes in file path", () => {
    const command = buildScriptCommand("runner", "/tmp/it's-file.ts");
    assert.strictEqual(command, "runner '/tmp/it'\\''s-file.ts'");
  });

  it("runs on save for all extensions when extension list is empty", () => {
    assert.strictEqual(shouldRunOnSaveForFile("/workspace/a.ts", []), true);
    assert.strictEqual(shouldRunOnSaveForFile("/workspace/b.js", []), true);
  });

  it("matches configured extensions with or without dot", () => {
    assert.strictEqual(shouldRunOnSaveForFile("/workspace/a.ts", [".ts", "js"]), true);
    assert.strictEqual(shouldRunOnSaveForFile("/workspace/a.jsx", [".ts", "js"]), false);
  });

  it("supports wildcard extension matcher", () => {
    assert.strictEqual(shouldRunOnSaveForFile("/workspace/file.anything", ["*"]), true);
  });

  it("throws when runOnSaveExtensions is not an array", () => {
    assert.throws(() => shouldRunOnSaveForFile("/workspace/a.ts", "ts"), /must be an array/);
  });
});
