import * as vscode from 'vscode';
import { Project, SourceFile, Node, CallExpression, ArrowFunction, SyntaxKind } from 'ts-morph';

interface ScopeInfo {
    type: 'step' | 'before' | 'beforeEach' | 'test' | 'describe';
    startLine: number;
    endLine: number;
    level: number;
}

// Track last operation per document to prevent consecutive same operations
const lastOperationMap = new Map<string, 'debug' | 'undebug' | null>();

export function activate(context: vscode.ExtensionContext) {
    console.log('Mocha Test Debug Helper is now active');

    // Register the save handler
    const saveHandler = vscode.workspace.onWillSaveTextDocument((event) => {
        const document = event.document;

        // Only process TypeScript and JavaScript files
        if (document.languageId !== 'typescript' && document.languageId !== 'javascript') {
            return;
        }

        const text = document.getText();

        // Check for @debug or @undebug markers
        const hasDebug = text.includes('// @debug');
        const hasUndebug = text.includes('// @undebug');

        if (hasDebug || hasUndebug) {
            const edits = processDebugMarkersForSave(document);
            if (edits && edits.length > 0) {
                event.waitUntil(
                    Promise.resolve(edits)
                );
            }
        }
    });

    // Register command for manual processing
    const commandHandler = vscode.commands.registerCommand('mocha-test-debug-helper.processDebug', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const edit = processDebugMarkers(editor.document);
        if (edit) {
            vscode.workspace.applyEdit(edit);
        }
    });

    // Register command for toggling debug markers with keyboard shortcut
    const toggleMarkerHandler = vscode.commands.registerCommand('mocha-test-debug-helper.toggleDebugMarker', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const position = editor.selection.active;
        const line = editor.document.lineAt(position.line);
        const lineText = line.text.trim();

        const edit = new vscode.WorkspaceEdit();

        if (lineText === '// @debug') {
            // Replace with @undebug
            const indent = line.text.match(/^(\s*)/)?.[1] || '';
            edit.replace(editor.document.uri, line.range, `${indent}// @undebug`);
        } else if (lineText === '// @undebug') {
            // Delete the line
            const rangeToDelete = new vscode.Range(
                position.line,
                0,
                position.line + 1,
                0
            );
            edit.delete(editor.document.uri, rangeToDelete);
        } else {
            // Insert @debug at cursor position
            const indent = line.text.match(/^(\s*)/)?.[1] || '';

            if (lineText === '' || line.text.trim() === '') {
                // Empty line: replace it without creating new line
                const range = new vscode.Range(
                    new vscode.Position(position.line, 0),
                    new vscode.Position(position.line, line.text.length)
                );
                edit.replace(editor.document.uri, range, `${indent}// @debug`);

                // Move cursor to end of debug line
                vscode.workspace.applyEdit(edit).then(() => {
                    const newPosition = new vscode.Position(position.line, indent.length + 10); // Position after "// @debug"
                    editor.selection = new vscode.Selection(newPosition, newPosition);
                });
                return;
            } else {
                // Line has content: insert on new line above
                const insertPosition = new vscode.Position(position.line, 0);
                edit.insert(editor.document.uri, insertPosition, `${indent}// @debug\n`);

                // Move cursor to end of debug line
                vscode.workspace.applyEdit(edit).then(() => {
                    const newPosition = new vscode.Position(position.line, indent.length + 10); // Position after "// @debug"
                    editor.selection = new vscode.Selection(newPosition, newPosition);
                });
                return;
            }
        }

        vscode.workspace.applyEdit(edit);
    });

    context.subscriptions.push(saveHandler, commandHandler, toggleMarkerHandler);
}

function processDebugMarkersForSave(document: vscode.TextDocument): vscode.TextEdit[] | null {
    const text = document.getText();
    const lines = text.split('\n');

    // Find all @debug or @undebug markers
    const debugLines: number[] = [];
    const undebugLines: number[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '// @debug') {
            debugLines.push(i);
        } else if (line === '// @undebug') {
            undebugLines.push(i);
        }
    }

    // Check for multiple markers and show error
    if (debugLines.length > 1) {
        vscode.window.showErrorMessage(
            `Multiple @debug markers found (${debugLines.length} found). Please use only one @debug marker per file.`
        );
        return null;
    }

    if (undebugLines.length > 1) {
        vscode.window.showErrorMessage(
            `Multiple @undebug markers found (${undebugLines.length} found). Please use only one @undebug marker per file.`
        );
        return null;
    }

    // Check if both @debug and @undebug are present at the same time
    if (debugLines.length > 0 && undebugLines.length > 0) {
        vscode.window.showErrorMessage(
            `Both @debug and @undebug markers found. Please use only one marker type at a time.`
        );
        return null;
    }

    if (debugLines.length === 0 && undebugLines.length === 0) {
        return null;
    }

    const debugLine = debugLines.length > 0 ? debugLines[0] : -1;
    const undebugLine = undebugLines.length > 0 ? undebugLines[0] : -1;
    const isDebugMode = debugLine !== -1;
    const markerLine = isDebugMode ? debugLine : undebugLine;

    // Check for consecutive same operations
    const documentUri = document.uri.toString();
    const lastOperation = lastOperationMap.get(documentUri);

    if (isDebugMode) {
        if (lastOperation === 'debug') {
            vscode.window.showErrorMessage(
                `Cannot run @debug consecutively. Please run @undebug first before using @debug again.`
            );
            return null;
        }
        lastOperationMap.set(documentUri, 'debug');
        return processDebugModeForSave(document, lines, markerLine);
    } else {
        if (lastOperation === 'undebug') {
            vscode.window.showErrorMessage(
                `Cannot run @undebug consecutively. Please run @debug first before using @undebug again.`
            );
            return null;
        }
        lastOperationMap.set(documentUri, 'undebug');
        return processUndebugModeForSave(document, lines, markerLine);
    }
}

function processDebugMarkers(document: vscode.TextDocument): vscode.WorkspaceEdit | null {
    const text = document.getText();
    const lines = text.split('\n');

    // Find all @debug or @undebug markers
    const debugLines: number[] = [];
    const undebugLines: number[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '// @debug') {
            debugLines.push(i);
        } else if (line === '// @undebug') {
            undebugLines.push(i);
        }
    }

    // Check for multiple markers and show error
    if (debugLines.length > 1) {
        vscode.window.showErrorMessage(
            `Multiple @debug markers found (${debugLines.length} found). Please use only one @debug marker per file.`
        );
        return null;
    }

    if (undebugLines.length > 1) {
        vscode.window.showErrorMessage(
            `Multiple @undebug markers found (${undebugLines.length} found). Please use only one @undebug marker per file.`
        );
        return null;
    }

    // Check if both @debug and @undebug are present at the same time
    if (debugLines.length > 0 && undebugLines.length > 0) {
        vscode.window.showErrorMessage(
            `Both @debug and @undebug markers found. Please use only one marker type at a time.`
        );
        return null;
    }

    if (debugLines.length === 0 && undebugLines.length === 0) {
        return null;
    }

    const debugLine = debugLines.length > 0 ? debugLines[0] : -1;
    const undebugLine = undebugLines.length > 0 ? undebugLines[0] : -1;
    const isDebugMode = debugLine !== -1;
    const markerLine = isDebugMode ? debugLine : undebugLine;

    // Check for consecutive same operations
    const documentUri = document.uri.toString();
    const lastOperation = lastOperationMap.get(documentUri);

    if (isDebugMode) {
        if (lastOperation === 'debug') {
            vscode.window.showErrorMessage(
                `Cannot run @debug consecutively. Please run @undebug first before using @debug again.`
            );
            return null;
        }
        lastOperationMap.set(documentUri, 'debug');
        return processDebugMode(document, lines, markerLine);
    } else {
        if (lastOperation === 'undebug') {
            vscode.window.showErrorMessage(
                `Cannot run @undebug consecutively. Please run @debug first before using @undebug again.`
            );
            return null;
        }
        lastOperationMap.set(documentUri, 'undebug');
        return processUndebugMode(document, lines, markerLine);
    }
}

function processDebugModeForSave(document: vscode.TextDocument, lines: string[], debugLine: number): vscode.TextEdit[] {
    const scopes = parseScopes(lines);

    // Ensure debug marker is inside a describe or test callback
    const describeScope = scopes.find(s =>
        s.type === 'describe' && s.startLine < debugLine && s.endLine > debugLine
    );
    const testScope = scopes.find(s =>
        s.type === 'test' && s.startLine < debugLine && s.endLine > debugLine
    );

    if (!describeScope && !testScope) {
        return [];
    }

    const linesToComment = findLinesToComment(lines, scopes, debugLine);

    const edits: vscode.TextEdit[] = [];

    // Comment out the identified lines
    for (const lineNum of Array.from(linesToComment).sort((a, b) => a - b)) {
        const line = lines[lineNum];
        const trimmed = line.trim();

        // Skip if is the debug marker itself
        if (lineNum === debugLine) {
            continue;
        }

        // Skip empty lines
        if (trimmed === '') {
            continue;
        }

        // Find the indentation
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        const afterIndent = line.substring(indent.length);

        // Prevent over-commenting: if line already starts with //// or more, skip it
        // This means it was already processed by a previous @debug save
        if (afterIndent.startsWith('////')) {
            continue;
        }

        // Always add // before the first character (after indentation)
        // If line already starts with //, add // before it (no space): "// await" -> "//// await"
        // If line doesn't start with //, add //  before it (with space): "await" -> "// await"
        let commentedLine: string;
        if (afterIndent.startsWith('//')) {
            // Already has //, add another // before it (no space between the two //)
            commentedLine = `${indent}//${afterIndent}`;
        } else {
            // No //, add //  before it (with space)
            commentedLine = `${indent}// ${afterIndent}`;
        }

        const range = new vscode.Range(lineNum, 0, lineNum, line.length);
        edits.push(vscode.TextEdit.replace(range, commentedLine));
    }

    return edits;
}

function processUndebugModeForSave(document: vscode.TextDocument, lines: string[], undebugLine: number): vscode.TextEdit[] {
    const scopes = parseScopes(lines);

    // Ensure undebug marker is inside a describe or test callback
    const describeScope = scopes.find(s =>
        s.type === 'describe' && s.startLine < undebugLine && s.endLine > undebugLine
    );
    const testScope = scopes.find(s =>
        s.type === 'test' && s.startLine < undebugLine && s.endLine > undebugLine
    );

    if (!describeScope && !testScope) {
        return [];
    }

    const linesToUncomment = findLinesToUncomment(lines, scopes, undebugLine);

    const edits: vscode.TextEdit[] = [];

    // Uncomment the identified lines by removing the first // found
    for (const lineNum of Array.from(linesToUncomment).sort((a, b) => a - b)) {
        const line = lines[lineNum];
        const trimmed = line.trim();

        // Skip if it's the undebug marker itself
        if (lineNum === undebugLine) {
            continue;
        }

        // Skip if line doesn't start with //
        if (!trimmed.startsWith('//')) {
            continue;
        }

        // Skip if it's a comment marker (@debug or @undebug)
        if (trimmed === '// @debug' || trimmed === '// @undebug') {
            continue;
        }

        // Find the indentation
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        const afterIndent = line.substring(indent.length);

        // Prevent over-uncommenting: only uncomment lines that were commented by our extension
        // Lines commented by our extension will have pattern: "// " (comment + space) or "////" (double-commented)
        // We should NOT uncomment lines that have "///" (triple-commented) as they were originally commented
        // Original comments might be "//comment" without space, which we should preserve
        if (!afterIndent.startsWith('// ') && !afterIndent.startsWith('////')) {
            // This is an original comment that wasn't processed by our extension, skip it
            // Also skip "///" which means it was originally "//" and we added one more, so after one undebug it's "///"
            // We should not uncomment it further
            continue;
        }

        // Remove the first // found (strictly only the first)
        // If line is "    // await something()", result should be "    await something()"
        // If line is "    //// await something()", result should be "    /// await something()"
        // But if line is "    /// await something()", we should NOT uncomment it (it was originally "//")
        let uncommentedLine: string;

        if (afterIndent.startsWith('////')) {
            // Double-commented by our extension: remove one // to get back to ///
            // But wait, if it was originally "//", then "////" should become "///" and stop there
            // Actually, "////" means it was originally "//" and we added "//", so undebug should make it "///"
            // But "///" should not be uncommented further
            const rest = afterIndent.substring(2); // Remove first //
            uncommentedLine = `${indent}${rest}`; // Result: "/// await something()"
        } else if (afterIndent.startsWith('// ')) {
            // Single-commented by our extension: remove // to get back to original
            const rest = afterIndent.substring(2); // Remove "//"
            if (rest.startsWith(' ')) {
                uncommentedLine = `${indent}${rest.substring(1)}`; // Remove the space too
            } else {
                uncommentedLine = `${indent}${rest}`;
            }
        } else {
            // Shouldn't happen, but keep as is
            uncommentedLine = line;
        }

        const range = new vscode.Range(lineNum, 0, lineNum, line.length);
        edits.push(vscode.TextEdit.replace(range, uncommentedLine));
    }

    return edits;
}

function processDebugMode(document: vscode.TextDocument, lines: string[], debugLine: number): vscode.WorkspaceEdit | null {
    const scopes = parseScopes(lines);

    // Ensure debug marker is inside a describe or test callback
    const describeScope = scopes.find(s =>
        s.type === 'describe' && s.startLine < debugLine && s.endLine > debugLine
    );
    const testScope = scopes.find(s =>
        s.type === 'test' && s.startLine < debugLine && s.endLine > debugLine
    );

    if (!describeScope && !testScope) {
        return null;
    }

    const linesToComment = findLinesToComment(lines, scopes, debugLine);

    if (linesToComment.size === 0) {
        return null;
    }

    const edit = new vscode.WorkspaceEdit();

    // Comment out the identified lines
    for (const lineNum of Array.from(linesToComment).sort((a, b) => a - b)) {
        const line = lines[lineNum];
        const trimmed = line.trim();

        // Skip if is the debug marker itself
        if (lineNum === debugLine) {
            continue;
        }

        // Skip empty lines
        if (trimmed === '') {
            continue;
        }

        // Find the indentation
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        const afterIndent = line.substring(indent.length);

        // Prevent over-commenting: if line already starts with //// or more, skip it
        // This means it was already processed by a previous @debug save
        if (afterIndent.startsWith('////')) {
            continue;
        }

        // Always add // before the first character (after indentation)
        // If line already starts with //, add // before it (no space): "// await" -> "//// await"
        // If line doesn't start with //, add //  before it (with space): "await" -> "// await"
        let commentedLine: string;
        if (afterIndent.startsWith('//')) {
            // Already has //, add another // before it (no space between the two //)
            commentedLine = `${indent}//${afterIndent}`;
        } else {
            // No //, add //  before it (with space)
            commentedLine = `${indent}// ${afterIndent}`;
        }

        const range = new vscode.Range(lineNum, 0, lineNum, line.length);
        edit.replace(document.uri, range, commentedLine);
    }

    return edit;
}

function processUndebugMode(document: vscode.TextDocument, lines: string[], undebugLine: number): vscode.WorkspaceEdit | null {
    const scopes = parseScopes(lines);

    // Ensure undebug marker is inside a describe or test callback
    const describeScope = scopes.find(s =>
        s.type === 'describe' && s.startLine < undebugLine && s.endLine > undebugLine
    );
    const testScope = scopes.find(s =>
        s.type === 'test' && s.startLine < undebugLine && s.endLine > undebugLine
    );

    if (!describeScope && !testScope) {
        return null;
    }

    const linesToUncomment = findLinesToUncomment(lines, scopes, undebugLine);

    if (linesToUncomment.size === 0) {
        return null;
    }

    const edit = new vscode.WorkspaceEdit();

    // Uncomment the identified lines by removing the first // found
    for (const lineNum of Array.from(linesToUncomment).sort((a, b) => a - b)) {
        const line = lines[lineNum];
        const trimmed = line.trim();

        // Skip if it's the undebug marker itself
        if (lineNum === undebugLine) {
            continue;
        }

        // Skip if line doesn't start with //
        if (!trimmed.startsWith('//')) {
            continue;
        }

        // Skip if it's a comment marker (@debug or @undebug)
        if (trimmed === '// @debug' || trimmed === '// @undebug') {
            continue;
        }

        // Find the indentation
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        const afterIndent = line.substring(indent.length);

        // Prevent over-uncommenting: only uncomment lines that were commented by our extension
        // Lines commented by our extension will have pattern: "// " (comment + space) or "////" (double-commented)
        // We should NOT uncomment lines that have "///" (triple-commented) as they were originally commented
        // Original comments might be "//comment" without space, which we should preserve
        if (!afterIndent.startsWith('// ') && !afterIndent.startsWith('////')) {
            // This is an original comment that wasn't processed by our extension, skip it
            // Also skip "///" which means it was originally "//" and we added one more, so after one undebug it's "///"
            // We should not uncomment it further
            continue;
        }

        // Remove the first // found (strictly only the first)
        // If line is "    // await something()", result should be "    await something()"
        // If line is "    //// await something()", result should be "    /// await something()"
        // But if line is "    /// await something()", we should NOT uncomment it (it was originally "//")
        let uncommentedLine: string;

        if (afterIndent.startsWith('////')) {
            // Double-commented by our extension: remove one // to get back to ///
            // But wait, if it was originally "//", then "////" should become "///" and stop there
            // Actually, "////" means it was originally "//" and we added "//", so undebug should make it "///"
            // But "///" should not be uncommented further
            const rest = afterIndent.substring(2); // Remove first //
            uncommentedLine = `${indent}${rest}`; // Result: "/// await something()"
        } else if (afterIndent.startsWith('// ')) {
            // Single-commented by our extension: remove // to get back to original
            const rest = afterIndent.substring(2); // Remove "//"
            if (rest.startsWith(' ')) {
                uncommentedLine = `${indent}${rest.substring(1)}`; // Remove the space too
            } else {
                uncommentedLine = `${indent}${rest}`;
            }
        } else {
            // Shouldn't happen, but keep as is
            uncommentedLine = line;
        }

        const range = new vscode.Range(lineNum, 0, lineNum, line.length);
        edit.replace(document.uri, range, uncommentedLine);
    }

    return edit;
}

/**
 * Convert a character position to a line number (0-based) using ts-morph's source file
 */
function getLineNumberFromPosition(sourceFile: SourceFile, position: number): number {
    // Use the compiler API to get line and character
    const lineAndChar = sourceFile.getLineAndColumnAtPos(position);
    // ts-morph returns 1-based line numbers, convert to 0-based
    return lineAndChar.line - 1;
}

/**
 * Get the name of a call expression (e.g., "step", "describe", "test")
 * Also checks if it's wrapped in an await expression
 */
function getCallExpressionName(node: CallExpression): { name: string | null; isAwait: boolean } {
    const expression = node.getExpression();
    let isAwait = false;

    // Check if parent is await: await step(...)
    const parent = node.getParent();
    if (Node.isAwaitExpression(parent)) {
        isAwait = true;
    }

    // Handle direct calls: step(...), describe(...)
    if (Node.isIdentifier(expression)) {
        return { name: expression.getText(), isAwait };
    }

    // Handle property access: obj.step(...)
    if (Node.isPropertyAccessExpression(expression)) {
        return { name: expression.getName(), isAwait };
    }

    return { name: null, isAwait: false };
}

/**
 * Find the arrow function callback in a call expression
 * Usually the last argument, but we'll check all arguments
 */
function findArrowFunctionCallback(callExpr: CallExpression): ArrowFunction | null {
    const args = callExpr.getArguments();

    // Check arguments in reverse order (last argument is usually the callback)
    for (let i = args.length - 1; i >= 0; i--) {
        const arg = args[i];
        if (Node.isArrowFunction(arg)) {
            return arg;
        }
    }

    return null;
}

function parseScopes(lines: string[]): ScopeInfo[] {
    const scopes: ScopeInfo[] = [];
    const sourceText = lines.join('\n');

    // Handle empty or invalid source
    if (!sourceText.trim()) {
        return scopes;
    }

    try {
        // Create a ts-morph project and parse the source
        const project = new Project({
            useInMemoryFileSystem: true,
            compilerOptions: {
                allowJs: true,
                checkJs: false,
            }
        });

        // Determine file extension based on content (try TypeScript first, fallback to JS)
        const sourceFile = project.createSourceFile('temp.ts', sourceText, { overwrite: true });

        // Visit all call expressions in the AST
        sourceFile.forEachDescendant((node) => {
            if (!Node.isCallExpression(node)) {
                return;
            }

            const { name: callName, isAwait } = getCallExpressionName(node);
            if (!callName) {
                return;
            }

            // For step, only accept if it's await step(...)
            if (callName === 'step' && !isAwait) {
                return;
            }

            // Check if this is one of our target functions
            let scopeType: ScopeInfo['type'] | null = null;
            if (callName === 'step') {
                scopeType = 'step';
            } else if (callName === 'describe') {
                scopeType = 'describe';
            } else if (callName === 'test') {
                scopeType = 'test';
            } else if (callName === 'before') {
                scopeType = 'before';
            } else if (callName === 'beforeEach') {
                scopeType = 'beforeEach';
            }

            if (!scopeType) {
                return;
            }

            // Find the arrow function callback
            const arrowFunction = findArrowFunctionCallback(node);
            if (!arrowFunction) {
                return;
            }

            // Get the body of the arrow function
            const body = arrowFunction.getBody();
            if (!body || !Node.isBlock(body)) {
                // Skip if body is not a block (e.g., single expression arrow function)
                return;
            }

            // Calculate start and end positions
            // Start: line where the call expression starts (for compatibility with existing code)
            // End: line where the arrow function body ends (closing brace)
            const callStartPos = node.getStart();
            const bodyStartPos = body.getStart(); // Opening brace of body
            const bodyEndPos = body.getEnd(); // Closing brace of body

            // Convert positions to line numbers (0-based)
            const startLine = getLineNumberFromPosition(sourceFile, callStartPos);
            const endLine = getLineNumberFromPosition(sourceFile, bodyEndPos);

            // Calculate nesting level by counting how many scopes contain this one
            let level = 0;
            for (const existingScope of scopes) {
                if (existingScope.startLine < startLine && existingScope.endLine > endLine) {
                    level++;
                }
            }

            // Add this scope
            scopes.push({
                type: scopeType,
                startLine: startLine,
                endLine: endLine,
                level: level
            });
        });

        // Sort scopes by startLine to maintain order
        scopes.sort((a, b) => a.startLine - b.startLine);

    } catch (error) {
        // If parsing fails (e.g., syntax errors), fall back to empty scopes
        // This prevents the extension from breaking on invalid code
        console.warn('Failed to parse scopes with ts-morph:', error);
        return scopes;
    }

    return scopes;
}

/**
 * Check if a line is a closing brace/parenthesis for step, describe, test, before, or beforeEach blocks.
 * Uses the scope information to accurately identify closing lines, avoiding false positives from nested structures.
 */
function isClosingBraceLine(lineNumber: number, scopes: ScopeInfo[]): boolean {
    // Check if this line number is the endLine of any step, describe, test, before, or beforeEach scope
    return scopes.some(scope =>
        (scope.type === 'step' ||
            scope.type === 'describe' ||
            scope.type === 'test' ||
            scope.type === 'before' ||
            scope.type === 'beforeEach') &&
        scope.endLine === lineNumber
    );
}

function findLinesToComment(lines: string[], scopes: ScopeInfo[], debugLine: number): Set<number> {
    const linesToComment = new Set<number>();

    // Check if debug marker is inside a before or beforeEach block
    const beforeScope = scopes.find(s =>
        (s.type === 'before' || s.type === 'beforeEach') && s.startLine < debugLine && s.endLine >= debugLine
    );

    // Find the scope containing the debug line
    let currentScope = scopes.find(s =>
        s.type === 'step' && s.startLine < debugLine && s.endLine >= debugLine
    );

    // If debug marker is not inside a step, it might be after the last step or before the first step at test level
    // In this case, find the previous step before the debug line, or the next step after
    const testScope = scopes.find(s =>
        s.type === 'test' && s.startLine < debugLine && s.endLine > debugLine
    );

    if (!currentScope && testScope) {
        // First try to find the previous step (most common case - debug after last step)
        const previousStep = scopes
            .filter(s =>
                s.type === 'step' &&
                s.startLine < debugLine &&
                s.startLine > testScope.startLine &&
                s.endLine < testScope.endLine
            )
            .sort((a, b) => b.startLine - a.startLine)[0]; // Get the last step before debug line

        if (previousStep) {
            // Treat the previous step as the current scope for commenting purposes
            currentScope = previousStep;
        } else {
            // If no previous step, find the next step after the debug line
            const nextStep = scopes.find(s =>
                s.type === 'step' &&
                s.startLine > debugLine &&
                s.startLine > testScope.startLine &&
                s.endLine < testScope.endLine
            );

            if (nextStep) {
                // Treat the next step as the current scope for commenting purposes
                currentScope = nextStep;
            }
        }
    }

    // If debug is inside a before/beforeEach block, handle it specially
    if (beforeScope) {
        // Comment out statements before debug line in the before/beforeEach block
        if (debugLine > beforeScope.startLine) {
            const endLine = Math.min(debugLine, beforeScope.endLine);
            for (let i = beforeScope.startLine + 1; i < endLine; i++) {
                const line = lines[i].trim();
                // Include already-commented lines (they'll get another // added)
                // Skip only markers, declarations, and closing braces
                if (line && !line.match(/^\/\/\s*@(debug|undebug)$/) && !line.match(/^(before|beforeEach)\(/) && !isClosingBraceLine(i, scopes)) {
                    linesToComment.add(i);
                }
            }
        }

        // Comment out all statements in other before/beforeEach blocks
        const allBeforeScopes = scopes.filter(s =>
            (s.type === 'before' || s.type === 'beforeEach') && s.startLine < beforeScope.startLine
        );
        for (const scope of allBeforeScopes) {
            for (let i = scope.startLine + 1; i < scope.endLine; i++) {
                const line = lines[i].trim();
                // Include already-commented lines (they'll get another // added)
                // Skip only markers, declarations, and closing braces
                if (line && !line.match(/^\/\/\s*@(debug|undebug)$/) && !line.match(/^(before|beforeEach)\(/) && !isClosingBraceLine(i, scopes)) {
                    linesToComment.add(i);
                }
            }
        }

        // Comment out all steps and test-level code
        if (testScope) {
            const allStepsInTest = scopes.filter(s =>
                s.type === 'step' &&
                s.startLine > testScope.startLine &&
                s.endLine < testScope.endLine
            );

            for (const step of allStepsInTest) {
                for (let i = step.startLine + 1; i < step.endLine; i++) {
                    const line = lines[i].trim();
                    if (line && !line.startsWith('//') && !line.includes('await step(') && !isClosingBraceLine(i, scopes)) {
                        linesToComment.add(i);
                    }
                }
            }

            // Comment out test-level code
            let testBodyStart = testScope.startLine + 1;
            for (let i = testScope.startLine; i < testScope.endLine; i++) {
                const line = lines[i];
                if (line.includes('async () =>') || line.includes('async()=>')) {
                    if (line.includes('{')) {
                        testBodyStart = i + 1;
                        break;
                    } else {
                        for (let j = i + 1; j < testScope.endLine; j++) {
                            if (lines[j].includes('{')) {
                                testBodyStart = j + 1;
                                break;
                            }
                        }
                        break;
                    }
                }
            }

            if (allStepsInTest.length > 0) {
                const firstStep = allStepsInTest[0];
                for (let i = testBodyStart; i < firstStep.startLine; i++) {
                    const line = lines[i].trim();
                    if (line && !line.startsWith('//') && !line.match(/^(await\s+)?step\(/)) {
                        linesToComment.add(i);
                    }
                }
            } else {
                // No steps, comment all test-level code
                for (let i = testBodyStart; i < testScope.endLine; i++) {
                    const line = lines[i].trim();
                    // Include already-commented lines (they'll get another // added)
                    // Skip only markers, step declarations, and closing braces
                    if (line && !line.match(/^\/\/\s*@(debug|undebug)$/) && !line.match(/^(await\s+)?step\(/) && !isClosingBraceLine(i, scopes)) {
                        linesToComment.add(i);
                    }
                }
            }
        }

        return linesToComment;
    }

    if (!currentScope) {
        return linesToComment;
    }

    // 1. Comment out statements before debug line in current step
    // Handle both cases: debug line inside step OR debug line after step ends
    if (debugLine > currentScope.startLine) {
        // Comment all lines in the step up to (but not including) the debug line
        // If debug line is after step ends, comment all lines in the step
        const endLine = Math.min(debugLine, currentScope.endLine);
        for (let i = currentScope.startLine + 1; i < endLine; i++) {
            const line = lines[i].trim();
            // Include already-commented lines (they'll get another // added)
            // Skip only markers, step declarations, and closing braces
            if (line && !line.match(/^\/\/\s*@(debug|undebug)$/) && !line.match(/^(await\s+)?step\(/) && !isClosingBraceLine(i, scopes)) {
                linesToComment.add(i);
            }
        }
    }

    // 2. Find all previous step scopes and test-level code at the same level
    if (testScope) {
        const stepScopes = scopes.filter(s =>
            s.type === 'step' &&
            s.startLine > testScope.startLine &&
            s.endLine < testScope.endLine &&
            s.startLine < currentScope.startLine
        ).sort((a, b) => a.startLine - b.startLine);

        // Comment out all statements in previous steps
        for (const step of stepScopes) {
            for (let i = step.startLine + 1; i < step.endLine; i++) {
                const line = lines[i].trim();
                // Include already-commented lines (they'll get another // added)
                // Skip only markers, step declarations, and closing braces
                if (line && !line.match(/^\/\/\s*@(debug|undebug)$/) && !line.includes('await step(') && !isClosingBraceLine(i, scopes)) {
                    linesToComment.add(i);
                }
            }
        }

        // Comment out statements at test level (between/before steps)
        // This includes code before the first step and code between steps
        const allStepsInTest = scopes.filter(s =>
            s.type === 'step' &&
            s.startLine > testScope.startLine &&
            s.endLine < testScope.endLine
        ).sort((a, b) => a.startLine - b.startLine);

        if (allStepsInTest.length > 0) {
            // Find where the test body actually starts (after 'async () => {')
            let testBodyStart = testScope.startLine + 1;
            for (let i = testScope.startLine; i < testScope.endLine; i++) {
                const line = lines[i];
                if (line.includes('async () =>') || line.includes('async()=>')) {
                    // Find the opening brace after this
                    if (line.includes('{')) {
                        testBodyStart = i + 1;
                        break;
                    } else {
                        // Brace might be on next line
                        for (let j = i + 1; j < testScope.endLine; j++) {
                            if (lines[j].includes('{')) {
                                testBodyStart = j + 1;
                                break;
                            }
                        }
                        break;
                    }
                }
            }

            // Code before the first step (but after test body start)
            const firstStep = allStepsInTest[0];
            for (let i = testBodyStart; i < firstStep.startLine; i++) {
                const line = lines[i].trim();
                // Include already-commented lines (they'll get another // added)
                // Skip only markers, step declarations, and closing braces
                if (line && !line.match(/^\/\/\s*@(debug|undebug)$/) && !line.match(/^(await\s+)?step\(/) && !isClosingBraceLine(i, scopes)) {
                    linesToComment.add(i);
                }
            }

            // Code between steps (before current step)
            for (let stepIdx = 0; stepIdx < allStepsInTest.length - 1; stepIdx++) {
                const thisStep = allStepsInTest[stepIdx];
                const nextStep = allStepsInTest[stepIdx + 1];

                // Only process if nextStep is at or before current scope
                if (nextStep.startLine <= currentScope.startLine) {
                    for (let i = thisStep.endLine + 1; i < nextStep.startLine; i++) {
                        const line = lines[i].trim();
                        // Include already-commented lines (they'll get another // added)
                        // Skip only markers, step declarations, and closing braces
                        if (line && !line.match(/^\/\/\s*@(debug|undebug)$/) && !line.match(/^(await\s+)?step\(/) && !isClosingBraceLine(i, scopes)) {
                            linesToComment.add(i);
                        }
                    }
                }
            }
        }
    }

    // 3. Comment out statements in before and beforeEach blocks
    const beforeScopes = scopes.filter(s => s.type === 'before' || s.type === 'beforeEach');

    for (const scope of beforeScopes) {
        for (let i = scope.startLine + 1; i < scope.endLine; i++) {
            const line = lines[i].trim();
            // Include already-commented lines (they'll get another // added)
            // Skip only markers, declarations, and closing braces
            if (line && !line.match(/^\/\/\s*@(debug|undebug)$/) && !line.match(/^(before|beforeEach)\(/) && !isClosingBraceLine(i, scopes)) {
                linesToComment.add(i);
            }
        }
    }

    return linesToComment;
}

function findLinesToUncomment(lines: string[], scopes: ScopeInfo[], undebugLine: number): Set<number> {
    const linesToUncomment = new Set<number>();

    // Check if undebug marker is inside a before or beforeEach block
    const beforeScope = scopes.find(s =>
        (s.type === 'before' || s.type === 'beforeEach') && s.startLine < undebugLine && s.endLine >= undebugLine
    );

    // Find the scope containing the undebug line
    let currentScope = scopes.find(s =>
        s.type === 'step' && s.startLine < undebugLine && s.endLine >= undebugLine
    );

    // If undebug marker is not inside a step, it might be after the last step or before the first step at test level
    // In this case, find the previous step before the undebug line, or the next step after
    const testScope = scopes.find(s =>
        s.type === 'test' && s.startLine < undebugLine && s.endLine > undebugLine
    );

    if (!currentScope && testScope) {
        // First try to find the previous step (most common case - undebug after last step)
        const previousStep = scopes
            .filter(s =>
                s.type === 'step' &&
                s.startLine < undebugLine &&
                s.startLine > testScope.startLine &&
                s.endLine < testScope.endLine
            )
            .sort((a, b) => b.startLine - a.startLine)[0]; // Get the last step before undebug line

        if (previousStep) {
            // Treat the previous step as the current scope for uncommenting purposes
            currentScope = previousStep;
        } else {
            // If no previous step, find the next step after the undebug line
            const nextStep = scopes.find(s =>
                s.type === 'step' &&
                s.startLine > undebugLine &&
                s.startLine > testScope.startLine &&
                s.endLine < testScope.endLine
            );

            if (nextStep) {
                // Treat the next step as the current scope for uncommenting purposes
                currentScope = nextStep;
            }
        }
    }

    // If undebug is inside a before/beforeEach block, handle it specially
    if (beforeScope) {
        // Uncomment statements before undebug line in the before/beforeEach block
        if (undebugLine > beforeScope.startLine) {
            const endLine = Math.min(undebugLine, beforeScope.endLine);
            for (let i = beforeScope.startLine + 1; i < endLine; i++) {
                const line = lines[i].trim();
                if (line.startsWith('//') && !line.startsWith('// @') && !isClosingBraceLine(i, scopes)) {
                    linesToUncomment.add(i);
                }
            }
        }

        // Uncomment all statements in other before/beforeEach blocks
        const allBeforeScopes = scopes.filter(s =>
            (s.type === 'before' || s.type === 'beforeEach') && s.startLine < beforeScope.startLine
        );
        for (const scope of allBeforeScopes) {
            for (let i = scope.startLine + 1; i < scope.endLine; i++) {
                const line = lines[i].trim();
                if (line.startsWith('//') && !line.startsWith('// @') && !isClosingBraceLine(i, scopes)) {
                    linesToUncomment.add(i);
                }
            }
        }

        // Uncomment all steps and test-level code
        if (testScope) {
            const allStepsInTest = scopes.filter(s =>
                s.type === 'step' &&
                s.startLine > testScope.startLine &&
                s.endLine < testScope.endLine
            );

            for (const step of allStepsInTest) {
                for (let i = step.startLine + 1; i < step.endLine; i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('//') && !line.startsWith('// @') && !isClosingBraceLine(i, scopes)) {
                        linesToUncomment.add(i);
                    }
                }
            }

            // Uncomment test-level code
            let testBodyStart = testScope.startLine + 1;
            for (let i = testScope.startLine; i < testScope.endLine; i++) {
                const line = lines[i];
                if (line.includes('async () =>') || line.includes('async()=>')) {
                    if (line.includes('{')) {
                        testBodyStart = i + 1;
                        break;
                    } else {
                        for (let j = i + 1; j < testScope.endLine; j++) {
                            if (lines[j].includes('{')) {
                                testBodyStart = j + 1;
                                break;
                            }
                        }
                        break;
                    }
                }
            }

            if (allStepsInTest.length > 0) {
                const firstStep = allStepsInTest[0];
                for (let i = testBodyStart; i < firstStep.startLine; i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('//') && !line.startsWith('// @') && !isClosingBraceLine(i, scopes)) {
                        linesToUncomment.add(i);
                    }
                }
            } else {
                // No steps, uncomment all test-level code
                for (let i = testBodyStart; i < testScope.endLine; i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('//') && !line.startsWith('// @') && !isClosingBraceLine(i, scopes)) {
                        linesToUncomment.add(i);
                    }
                }
            }
        }

        return linesToUncomment;
    }

    if (!currentScope) {
        return linesToUncomment;
    }

    // 1. Uncomment statements before undebug line in current step
    // Handle both cases: undebug line inside step OR undebug line after step ends
    // Simply uncomment all lines that start with // (except markers)
    if (undebugLine > currentScope.startLine) {
        // Uncomment all lines in the step up to (but not including) the undebug line
        // If undebug line is after step ends, uncomment all lines in the step
        const endLine = Math.min(undebugLine, currentScope.endLine);
        for (let i = currentScope.startLine + 1; i < endLine; i++) {
            const line = lines[i].trim();
            if (line.startsWith('//') && !line.startsWith('// @') && !isClosingBraceLine(i, scopes)) {
                linesToUncomment.add(i);
            }
        }
    }

    // 2. Find all previous step scopes and test-level code at the same level
    if (testScope) {
        const stepScopes = scopes.filter(s =>
            s.type === 'step' &&
            s.startLine > testScope.startLine &&
            s.endLine < testScope.endLine &&
            s.startLine < currentScope.startLine
        ).sort((a, b) => a.startLine - b.startLine);

        // Uncomment all statements in previous steps
        for (const step of stepScopes) {
            for (let i = step.startLine + 1; i < step.endLine; i++) {
                const line = lines[i].trim();
                if (line.startsWith('//') && !line.startsWith('// @') && !isClosingBraceLine(i, scopes)) {
                    linesToUncomment.add(i);
                }
            }
        }

        // Uncomment statements at test level (between/before steps)
        const allStepsInTest = scopes.filter(s =>
            s.type === 'step' &&
            s.startLine > testScope.startLine &&
            s.endLine < testScope.endLine
        ).sort((a, b) => a.startLine - b.startLine);

        if (allStepsInTest.length > 0) {
            // Find where the test body actually starts (after 'async () => {')
            let testBodyStart = testScope.startLine + 1;
            for (let i = testScope.startLine; i < testScope.endLine; i++) {
                const line = lines[i];
                if (line.includes('async () =>') || line.includes('async()=>')) {
                    // Find the opening brace after this
                    if (line.includes('{')) {
                        testBodyStart = i + 1;
                        break;
                    } else {
                        // Brace might be on next line
                        for (let j = i + 1; j < testScope.endLine; j++) {
                            if (lines[j].includes('{')) {
                                testBodyStart = j + 1;
                                break;
                            }
                        }
                        break;
                    }
                }
            }

            // Code before the first step (but after test body start)
            const firstStep = allStepsInTest[0];
            for (let i = testBodyStart; i < firstStep.startLine; i++) {
                const line = lines[i].trim();
                if (line.startsWith('//') && !line.startsWith('// @') && !isClosingBraceLine(i, scopes)) {
                    linesToUncomment.add(i);
                }
            }

            // Code between steps (before current step)
            for (let stepIdx = 0; stepIdx < allStepsInTest.length - 1; stepIdx++) {
                const thisStep = allStepsInTest[stepIdx];
                const nextStep = allStepsInTest[stepIdx + 1];

                // Only process if nextStep is at or before current scope
                if (nextStep.startLine <= currentScope.startLine) {
                    for (let i = thisStep.endLine + 1; i < nextStep.startLine; i++) {
                        const line = lines[i].trim();
                        if (line.startsWith('//') && !line.startsWith('// @') && !isClosingBraceLine(i, scopes)) {
                            linesToUncomment.add(i);
                        }
                    }
                }
            }
        }
    }

    // 3. Uncomment statements in before and beforeEach blocks
    const beforeScopes = scopes.filter(s => s.type === 'before' || s.type === 'beforeEach');

    for (const scope of beforeScopes) {
        for (let i = scope.startLine + 1; i < scope.endLine; i++) {
            const line = lines[i].trim();
            if (line.startsWith('//') && !line.startsWith('// @') && !isClosingBraceLine(i, scopes)) {
                linesToUncomment.add(i);
            }
        }
    }

    return linesToUncomment;
}

export function deactivate() { }

