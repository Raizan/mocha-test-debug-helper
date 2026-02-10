# Mocha Test Debug Helper

VS Code extension to debug Mocha-style tests by toggling marker lines and auto commenting/uncommenting lines on save.

## Main behavior

### Keyboard toggle (`Ctrl+Shift+D`)

Inside `.ts`/`.js` editor:

1. first press -> insert `//@debug`
2. second press on that line -> replace with `//@undebug`
3. third press on that line -> delete marker line

If current line is not empty, marker is inserted above that line with matching indentation.

### Save processing

On save, extension validates marker count:

- multiple `//@debug` -> error popup
- multiple `//@undebug` -> error popup
- both markers in same file -> error popup

If valid:

- `//@debug` -> add one `//` prefix to eligible lines before marker
- `//@undebug` -> remove one `//` prefix from eligible lines before marker

Processing is limited to the nearest protected callback body around the marker. Call/header lines and closing lines are protected.

## Configurable settings

Use `settings.json`:

```json
{
  "narukami-dev.mochaTestDebugHelper.protectedFunctions": [
    "describe",
    "before",
    "beforeEach",
    "test",
    "it",
    "after",
    "afterEach",
    "step"
  ],
  "narukami-dev.mochaTestDebugHelper.functionAllowlist": [
    "findElementByText"
  ]
}
```

- `narukami-dev.mochaTestDebugHelper.protectedFunctions`
  - overrides protected callback names used for scope + header/closure protection
- `narukami-dev.mochaTestDebugHelper.functionAllowlist`
  - affects variable declarations with function-call initializers
  - variable declaration rules:
    - non-function-call initializers are protected
    - function-call initializers are commentable by default
    - if called function name is in allowlist, declaration stays protected
    - function names are resolved from:
      - direct call: `findElementByText(...)`
      - static/member call: `SomeClass.findElementByText(...)`
      - instance call: `wowClass.findElementByText(...)`

## Example for function allowlist

With `functionAllowlist: ["findElementByText"]` and `//@debug` below:

```ts
const number = 0;
const element = await findElementByText("Hello");
const element2 = await SomeClass.findElementByText("Hello");

const wowClass = new SomeClass();
const element3 = await wowClass.findElementByText("Hello");
//@debug
```

after save:

```ts
const number = 0;
const element = await findElementByText("Hello");
const element2 = await SomeClass.findElementByText("Hello");

const wowClass = new SomeClass();
const element3 = await wowClass.findElementByText("Hello");
//@debug
```

## Development

```bash
npm install
npm run compile
npm test
npx vsce package
```

## Requirements

- VS Code `^1.85.0`

## License

MIT

