# Mocha Test Debug Helper

A VS Code extension to help debug Mocha-style tests by automatically commenting/uncommenting code blocks based on special markers.

## Features

### Debug Mode (`// @debug`)

When you add a `// @debug` comment in your test file, the extension will automatically comment out:

1. **Statements before the debug line** in the current step
2. **All statements in previous steps** (at the same test level)
3. **All statements at test level** (code between steps, e.g., `console.log('before step')`)
4. **All statements in `before()` and `beforeEach()` blocks**

This allows you to focus on debugging a specific part of your test without executing earlier code.

**Example:**

Before (with `// @debug` at line 32):
```typescript
test("my test", {}, async () => {
    await step('first step', async () => {
        const content = [];
        await sleep(3000);
    });

    await step('second step', async () => {
        await sleep(3000);
        await $('selector').tap();
        // @debug
        await $('other-selector').setValue('value');
    });
});
```

After save:
```typescript
test("my test", {}, async () => {
    await step('first step', async () => {
        // const content = [];
        // await sleep(3000);
    });

    await step('second step', async () => {
        // await sleep(3000);
        // await $('selector').tap();
        // @debug
        await $('other-selector').setValue('value');
    });
});
```

**Example with test-level code:**

Before (with code between steps):
```typescript
test("my test", {}, async () => {
    console.log('before first step');
    await step('first step', async () => {
        await doSomething();
    });

    console.log('before second step');
    await step('second step', async () => {
        // @debug
        await targetAction();
    });
});
```

After save:
```typescript
test("my test", {}, async () => {
    // console.log('before first step');
    await step('first step', async () => {
        // await doSomething();
    });

    // console.log('before second step');
    await step('second step', async () => {
        // @debug
        await targetAction();
    });
});
```

### Undebug Mode (`// @undebug`)

When you add a `// @undebug` comment, the extension will uncomment code that was previously commented by the debug mode.

**Important:** The extension only uncomments code once per save to prevent uncommenting intentional comments. It preserves comments that start with special markers (like `// intentional comment`).

**Example:**

With `// @undebug` at line 32:
```typescript
test("my test", {}, async () => {
    await step('first step', async () => {
        // const content = [];
        // await sleep(3000);
    });

    await step('second step', async () => {
        // await sleep(3000);
        // await $('selector').tap();
        // @undebug
        await $('other-selector').setValue('value');
    });
});
```

After save:
```typescript
test("my test", {}, async () => {
    await step('first step', async () => {
        const content = [];
        await sleep(3000);
    });

    await step('second step', async () => {
        await sleep(3000);
        await $('selector').tap();
        // @undebug
        await $('other-selector').setValue('value');
    });
});
```

## Usage

1. Add `// @debug` or `// @undebug` comment in your test file where you want to apply the commenting/uncommenting
2. Save the file (Cmd+S / Ctrl+S)
3. The extension automatically processes the markers and updates your code

## Supported File Types

- TypeScript (`.ts`)
- JavaScript (`.js`)

## Installation

### From Source

1. Clone this repository
2. Run `npm install`
3. Run `npm run compile`
4. Press F5 to open a new VS Code window with the extension loaded
5. Open a test file and try it out!

### From VSIX

1. Package the extension: `vsce package`
2. Install the `.vsix` file in VS Code

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Package extension
vsce package
```

## Requirements

- VS Code 1.85.0 or higher

## Known Limitations

- The extension preserves comments that look intentional (e.g., containing "intentional" in the text)
- Works best with properly formatted and indented code
- Assumes standard Mocha test structure with `describe`, `test`, `step`, `before`, and `beforeEach` blocks

## License

MIT

