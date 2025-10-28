# Changelog

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

