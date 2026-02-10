import * as path from "node:path";
import Mocha from "mocha";

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "bdd",
    timeout: 20000,
  });

  const testsRoot = __dirname;
  const testFiles = ["extension.test.js", "logic.test.js"];

  for (const testFile of testFiles) {
    mocha.addFile(path.resolve(testsRoot, testFile));
  }

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
        return;
      }
      resolve();
    });
  });
}
