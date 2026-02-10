import * as assert from "node:assert";
import { describe, it } from "mocha";
import { computeTransformedText, computeTransformedTextWithConfig } from "../../src/processor";

describe("processor logic", () => {
  it("debug mode comments lines before marker and skips protected lines", () => {
    const input = [
      "describe('x', async function(){",
      "    before('', async function(){",
      "        console.log('1')",
      "    })",
      "    test('', async function(){",
      "        const a = 'abc'",
      "        console.log('2')",
      "    })",
      "    //@debug",
      "})",
    ].join("\n");

    const output = computeTransformedText(input);
    const lines = output.split("\n");

    assert.strictEqual(lines[2], "        //console.log('1')");
    assert.strictEqual(lines[5], "        const a = 'abc'");
    assert.strictEqual(lines[6], "        //console.log('2')");
    assert.strictEqual(lines[8], "    //@debug");
  });

  it("undebug mode strips only first comment prefix", () => {
    const input = [
      "describe('x', async function(){",
      "    before('', async function(){",
      "        ////console.log('1')",
      "        //console.log('2')",
      "    })",
      "    //@undebug",
      "})",
    ].join("\n");

    const output = computeTransformedText(input);
    const lines = output.split("\n");

    assert.strictEqual(lines[2], "        //console.log('1')");
    assert.strictEqual(lines[3], "        console.log('2')");
  });

  it("throws when both markers are present", () => {
    const input = [
      "describe('x', async function(){",
      "    //@debug",
      "    //@undebug",
      "})",
    ].join("\n");

    assert.throws(() => computeTransformedText(input), /Found both/);
  });

  it("does not comment protected call lines on malformed code", () => {
    const input = [
      "import { test } from '@mobile/utils/mocha.js';",
      "import { step } from \"@wdio/allure-reporter\";",
      "import { findElementByText } from '@mobile/utils/wdio/common.js';",
      "",
      "describe('password login', function () {",
      "  before(async function () {",
      "    //// await AuthenticationFlow.runInitialFlow();",
      "    //});",
      "",
      "    test('should login successfully', {",
      "      //tags: [",
      "      //'@MOBILE-3',",
      "      //'@tribe-growth'",
      "      //],",
      "      //}, async function () {",
      "      const element = await findElementByText('Hello');",
      "      //@debug",
      "    });",
      "  });",
      "});",
    ].join("\n");

    const output = computeTransformedText(input);
    const lines = output.split("\n");

    assert.strictEqual(lines[0], "import { test } from '@mobile/utils/mocha.js';");
    assert.strictEqual(lines[9], "    test('should login successfully', {");
    assert.strictEqual(lines[15], "      const element = await findElementByText('Hello');");
    assert.strictEqual(lines[16], "      //@debug");
  });

  it("keeps multiline protected call signatures and closure lines intact", () => {
    const input = [
      "describe('x', async function () {",
      "  test(",
      "    'works',",
      "    {",
      "      tags: ['@a', '@b'],",
      "    },",
      "    async function () {",
      "      console.log('1');",
      "      //@debug",
      "    }",
      "  );",
      "});",
    ].join("\n");

    const output = computeTransformedText(input);
    const lines = output.split("\n");

    assert.strictEqual(lines[1], "  test(");
    assert.strictEqual(lines[3], "    {");
    assert.strictEqual(lines[6], "    async function () {");
    assert.strictEqual(lines[7], "      //console.log('1');");
    assert.strictEqual(lines[9], "    }");
    assert.strictEqual(lines[10], "  );");
  });

  it("does not transform when marker is outside detectable callback body", () => {
    const input = [
      "import { test } from '@mobile/utils/mocha.js';",
      "import { step } from \"@wdio/allure-reporter\";",
      "import { findElementByText } from '@mobile/utils/wdio/common.js';",
      "",
      "describe('password login', function () {",
      "  before(async function () {",
      "    //// await AuthenticationFlow.runInitialFlow();",
      "    //});",
      "",
      "    test('should login successfully', {",
      "      //tags: [",
      "      //'@MOBILE-3',",
      "      //'@tribe-growth'",
      "      //],",
      "      //}, async function () {",
      "      //@debug",
      "      const element = await findElementByText('Hello');",
      "    });",
      "  });",
      "});",
    ].join("\n");

    const output = computeTransformedTextWithConfig(input, {
      functionAllowlist: ["findElementByText"],
    });
    assert.strictEqual(output, input);
  });

  it("does not comment multiline test config or outer hooks when marker is after variable line", () => {
    const input = [
      "import { test } from '@mobile/utils/mocha.js';",
      "import { step } from \"@wdio/allure-reporter\";",
      "import { findElementByText } from '@mobile/utils/wdio/common.js';",
      "",
      "describe('password login', function () {",
      "  before(async function () {",
      "    // await AuthenticationFlow.runInitialFlow();",
      "  });",
      "",
      "  test('should login successfully', {",
      "    tags: [",
      "      '@MOBILE-3',",
      "      '@tribe-growth'",
      "    ],",
      "  }, async function () {",
      "    const element = await findElementByText('Hello');",
      "    //@debug",
      "  });",
      "});",
    ].join("\n");

    const output = computeTransformedTextWithConfig(input, {
      functionAllowlist: ["findElementByText"],
    });
    assert.strictEqual(output, input);
  });

  it("keeps allowlisted function-call declarations protected", () => {
    const input = [
      "describe('x', async function(){",
      "  test('a', async function(){",
      "    const number = 0;",
      "    const element = await findElementByText('Hello');",
      "    const element2 = await SomeClass.findElementByText('Hello');",
      "    const wowClass = new SomeClass();",
      "    const element3 = await wowClass.findElementByText('Hello');",
      "    const other = await anotherFinder('x');",
      "    //@debug",
      "  })",
      "})",
    ].join("\n");

    const output = computeTransformedTextWithConfig(input, {
      functionAllowlist: ["findElementByText"],
    });
    const lines = output.split("\n");

    assert.strictEqual(lines[2], "    const number = 0;");
    assert.strictEqual(lines[3], "    const element = await findElementByText('Hello');");
    assert.strictEqual(lines[4], "    const element2 = await SomeClass.findElementByText('Hello');");
    assert.strictEqual(lines[5], "    const wowClass = new SomeClass();");
    assert.strictEqual(lines[6], "    const element3 = await wowClass.findElementByText('Hello');");
    assert.strictEqual(lines[7], "    //const other = await anotherFinder('x');");
  });

  it("allows overriding protected function names", () => {
    const input = [
      "suiteCase('x', async function(){",
      "  console.log('1');",
      "  //@debug",
      "})",
    ].join("\n");

    const output = computeTransformedTextWithConfig(input, {
      protectedFunctions: ["suiteCase"],
    });
    const lines = output.split("\n");

    assert.strictEqual(lines[1], "  //console.log('1');");
  });
});
