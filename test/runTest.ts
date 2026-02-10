import * as path from "node:path";
import * as fs from "node:fs/promises";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../..");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");
    const testWorkspace = path.resolve(__dirname, "../../test/workspace");
    await fs.mkdir(testWorkspace, { recursive: true });

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [testWorkspace, "--disable-extensions"],
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to run tests:", error);
    process.exit(1);
  }
}

void main();
