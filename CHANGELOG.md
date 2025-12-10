# Changelog

## [0.3.1] - 2025-12-10

### Fixed
- **Dependency bundling**: Added esbuild bundling to include `ts-morph` dependency in VSIX package
  - Previously, when packaging with `vsce package`, dependencies from `node_modules` were excluded (via `.vscodeignore`), causing the extension to fail when installed via VSIX
  - Extension now uses esbuild to bundle all dependencies (including `ts-morph`) into a single `extension.js` file
  - This ensures all required dependencies are included in the VSIX package and the extension works correctly after installation
  - Fixes issue where extension worked in debug mode but failed when installed via VSIX due to missing `ts-morph` dependency

## [0.3.0] - 2025-12-10

### Changed
- **Major rewrite: AST-based scope parsing**: Replaced regex and brace-counting approach with ts-morph AST parsing for more accurate scope detection
  - Uses TypeScript compiler API to parse code structure
  - Handles complex nested structures correctly
  - More reliable detection of `step`, `describe`, `test`, `before`, and `beforeEach` blocks

### Fixed
- **Closing brace detection**: Fixed critical bug where closing braces/parentheses for `step`, `describe`, `test`, `before`, and `beforeEach` blocks were being incorrectly commented out
  - Now uses scope endLine information to accurately identify closing braces
  - Prevents false positives from nested structures (e.g., object literals inside function calls)
- **Scope boundary accuracy**: Improved accuracy of scope start and end line detection using AST parsing instead of brace counting

### Added
- **ts-morph dependency**: Added ts-morph library for robust TypeScript/JavaScript AST parsing

## [0.2.1] - 2025-12-10

### Fixed
- **Debug marker at end of step**: Fixed issue where `@debug` placed after the last line of a step wouldn't comment out lines properly
- **Undebug functionality**: Fixed bug where `@undebug` wasn't properly uncommenting all lines. Now removes the first `//` found on any commented line
- **Respect existing comments**: When `@debug` encounters already-commented lines, it now adds another `//` before them (e.g., `// await` → `//// await`) so `@undebug` can reverse it properly
- **Double-undebug protection**: Fixed issue where running `@undebug` twice would fully uncomment originally commented lines
- **Already-commented lines**: Fixed bug where lines that were already commented before using `@debug` weren't being processed. Now they are included and get double-commented correctly

### Added
- **Multiple markers validation**: Extension now detects and shows error if multiple `@debug` or `@undebug` markers are found in the same file
- **Consecutive operation prevention**: Added protection to prevent running `@debug` consecutively or `@undebug` consecutively. Must alternate between them
- **Scope restriction**: Debug/undebug operations now only work inside `describe` or `test` callbacks (prevents accidental processing outside test files)
- **Before/beforeEach support**: Full support for placing `@debug` or `@undebug` inside `before` and `beforeEach` blocks

### Changed
- **Comment pattern**: `@debug` now always adds `//` before the first character, regardless of existing comments
- **Uncomment pattern**: `@undebug` now only removes the first `//` found, strictly preserving original comment structure

## [0.2.0] - 2025-10-28

### Added
- **Keyboard shortcut** (`Ctrl+Shift+D`): Toggle debug markers quickly
  - Press once: Insert `// @debug` at cursor
  - Press again on `// @debug` line: Replace with `// @undebug`
  - Press again on `// @undebug` line: Delete the line
  - Works automatically in TypeScript and JavaScript files
  - Keybinding is auto-registered on install and removed on uninstall

### Fixed
- **Critical**: Extension now works when `// @debug` or `// @undebug` is placed anywhere within test body, not just inside steps
  - Previously only worked when marker was inside a step scope
  - Now supports placing markers before steps at test level
  - Both debug and undebug modes fixed

## [0.1.5] - 2025-10-28

### Fixed
- Fixed TypeScript compilation configuration

## [0.1.4] - Initial Release

### Added
- Auto-comment/uncomment code blocks with `// @debug` marker
- Auto-uncomment code blocks with `// @undebug` marker
- Support for Mocha test structures (describe, test, step, before, beforeEach)
- Automatic processing on file save
- Manual command: "Mocha Test Debug: Process Debug/Undebug Markers"

