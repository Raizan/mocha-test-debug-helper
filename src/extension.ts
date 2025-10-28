import * as vscode from 'vscode';

interface ScopeInfo {
    type: 'step' | 'before' | 'beforeEach' | 'test' | 'describe';
    startLine: number;
    endLine: number;
    level: number;
}

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

    context.subscriptions.push(saveHandler, commandHandler);
}

function processDebugMarkersForSave(document: vscode.TextDocument): vscode.TextEdit[] | null {
    const text = document.getText();
    const lines = text.split('\n');

    // Find @debug or @undebug markers
    let debugLine = -1;
    let undebugLine = -1;
    let isDebugMode = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '// @debug') {
            debugLine = i;
            isDebugMode = true;
            break;
        } else if (line === '// @undebug') {
            undebugLine = i;
            isDebugMode = false;
            break;
        }
    }

    if (debugLine === -1 && undebugLine === -1) {
        return null;
    }

    const markerLine = isDebugMode ? debugLine : undebugLine;

    if (isDebugMode) {
        return processDebugModeForSave(document, lines, markerLine);
    } else {
        return processUndebugModeForSave(document, lines, markerLine);
    }
}

function processDebugMarkers(document: vscode.TextDocument): vscode.WorkspaceEdit | null {
    const text = document.getText();
    const lines = text.split('\n');

    // Find @debug or @undebug markers
    let debugLine = -1;
    let undebugLine = -1;
    let isDebugMode = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '// @debug') {
            debugLine = i;
            isDebugMode = true;
            break;
        } else if (line === '// @undebug') {
            undebugLine = i;
            isDebugMode = false;
            break;
        }
    }

    if (debugLine === -1 && undebugLine === -1) {
        return null;
    }

    const markerLine = isDebugMode ? debugLine : undebugLine;

    if (isDebugMode) {
        return processDebugMode(document, lines, markerLine);
    } else {
        return processUndebugMode(document, lines, markerLine);
    }
}

function processDebugModeForSave(document: vscode.TextDocument, lines: string[], debugLine: number): vscode.TextEdit[] {
    const scopes = parseScopes(lines);
    const linesToComment = findLinesToComment(lines, scopes, debugLine);

    const edits: vscode.TextEdit[] = [];

    // Comment out the identified lines
    for (const lineNum of Array.from(linesToComment).sort((a, b) => a - b)) {
        const line = lines[lineNum];
        const trimmed = line.trim();

        // Skip if already commented or is the debug marker itself
        if (trimmed.startsWith('//') || lineNum === debugLine) {
            continue;
        }

        // Skip empty lines
        if (trimmed === '') {
            continue;
        }

        // Find the indentation
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';

        // Comment out the line
        const range = new vscode.Range(lineNum, 0, lineNum, line.length);
        const commentedLine = `${indent}// ${line.trimStart()}`;
        edits.push(vscode.TextEdit.replace(range, commentedLine));
    }

    return edits;
}

function processUndebugModeForSave(document: vscode.TextDocument, lines: string[], undebugLine: number): vscode.TextEdit[] {
    const scopes = parseScopes(lines);
    const linesToUncomment = findLinesToUncomment(lines, scopes, undebugLine);

    const edits: vscode.TextEdit[] = [];

    // Uncomment the identified lines (only those that match the pattern)
    for (const lineNum of Array.from(linesToUncomment).sort((a, b) => a - b)) {
        const line = lines[lineNum];

        // Only uncomment lines that have the pattern: "// <code>"
        const commentMatch = line.match(/^(\s*)\/\/\s(.+)$/);
        if (commentMatch) {
            const indent = commentMatch[1];
            const code = commentMatch[2];

            // Skip if it's a comment marker
            if (code.trim().startsWith('@')) {
                continue;
            }

            const range = new vscode.Range(lineNum, 0, lineNum, line.length);
            const uncommentedLine = `${indent}${code}`;
            edits.push(vscode.TextEdit.replace(range, uncommentedLine));
        }
    }

    return edits;
}

function processDebugMode(document: vscode.TextDocument, lines: string[], debugLine: number): vscode.WorkspaceEdit | null {
    const scopes = parseScopes(lines);
    const linesToComment = findLinesToComment(lines, scopes, debugLine);

    if (linesToComment.size === 0) {
        return null;
    }

    const edit = new vscode.WorkspaceEdit();

    // Comment out the identified lines
    for (const lineNum of Array.from(linesToComment).sort((a, b) => a - b)) {
        const line = lines[lineNum];
        const trimmed = line.trim();

        // Skip if already commented or is the debug marker itself
        if (trimmed.startsWith('//') || lineNum === debugLine) {
            continue;
        }

        // Skip empty lines
        if (trimmed === '') {
            continue;
        }

        // Find the indentation
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';

        // Comment out the line
        const range = new vscode.Range(lineNum, 0, lineNum, line.length);
        const commentedLine = `${indent}// ${line.trimStart()}`;
        edit.replace(document.uri, range, commentedLine);
    }

    return edit;
}

function processUndebugMode(document: vscode.TextDocument, lines: string[], undebugLine: number): vscode.WorkspaceEdit | null {
    const scopes = parseScopes(lines);
    const linesToUncomment = findLinesToUncomment(lines, scopes, undebugLine);

    if (linesToUncomment.size === 0) {
        return null;
    }

    const edit = new vscode.WorkspaceEdit();

    // Uncomment the identified lines (only those that match the pattern)
    for (const lineNum of Array.from(linesToUncomment).sort((a, b) => a - b)) {
        const line = lines[lineNum];
        const trimmed = line.trim();

        // Only uncomment lines that have the pattern: "// <code>"
        // This preserves intentional comments
        const commentMatch = line.match(/^(\s*)\/\/\s(.+)$/);
        if (commentMatch) {
            const indent = commentMatch[1];
            const code = commentMatch[2];

            // Skip if it's a comment marker
            if (code.trim().startsWith('@')) {
                continue;
            }

            const range = new vscode.Range(lineNum, 0, lineNum, line.length);
            const uncommentedLine = `${indent}${code}`;
            edit.replace(document.uri, range, uncommentedLine);
        }
    }

    return edit;
}

function parseScopes(lines: string[]): ScopeInfo[] {
    const scopes: ScopeInfo[] = [];
    const stack: { type: string; startLine: number; startLevel: number }[] = [];
    let currentLevel = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const originalLine = lines[i];

        // Detect scope starts before updating level
        if (line.startsWith('await step(') || line.includes('await step(')) {
            stack.push({ type: 'step', startLine: i, startLevel: currentLevel });
        } else if (line.startsWith('before(') || line.match(/^\s*before\(/)) {
            stack.push({ type: 'before', startLine: i, startLevel: currentLevel });
        } else if (line.startsWith('beforeEach(') || line.match(/^\s*beforeEach\(/)) {
            stack.push({ type: 'beforeEach', startLine: i, startLevel: currentLevel });
        } else if (line.startsWith('test(') || line.match(/^\s*test\(/)) {
            stack.push({ type: 'test', startLine: i, startLevel: currentLevel });
        } else if (line.startsWith('describe(') || line.match(/^\s*describe\(/)) {
            stack.push({ type: 'describe', startLine: i, startLevel: currentLevel });
        }

        // Count opening and closing braces
        const openBraces = (originalLine.match(/\{/g) || []).length;
        const closeBraces = (originalLine.match(/\}/g) || []).length;

        // Update level based on braces
        currentLevel += openBraces - closeBraces;

        // Check if any scopes are closing at this level
        // We close scopes when we return to their starting level after being deeper
        while (stack.length > 0 && currentLevel <= stack[stack.length - 1].startLevel) {
            const scope = stack.pop()!;
            scopes.push({
                type: scope.type as any,
                startLine: scope.startLine,
                endLine: i,
                level: scope.startLevel
            });
        }
    }

    // Close any remaining scopes
    while (stack.length > 0) {
        const scope = stack.pop()!;
        scopes.push({
            type: scope.type as any,
            startLine: scope.startLine,
            endLine: lines.length - 1,
            level: scope.startLevel
        });
    }

    return scopes;
}

function findLinesToComment(lines: string[], scopes: ScopeInfo[], debugLine: number): Set<number> {
    const linesToComment = new Set<number>();

    // Find the scope containing the debug line
    let currentScope = scopes.find(s =>
        s.type === 'step' && s.startLine < debugLine && s.endLine > debugLine
    );

    // If debug marker is not inside a step, it might be before the first step at test level
    // In this case, find the next step after the debug line
    const testScope = scopes.find(s =>
        s.type === 'test' && s.startLine < debugLine && s.endLine > debugLine
    );

    if (!currentScope && testScope) {
        // Find the next step after the debug line
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

    if (!currentScope) {
        return linesToComment;
    }

    // 1. Comment out statements before debug line in current step
    // Only if debug line is actually inside the current step
    if (debugLine > currentScope.startLine && debugLine < currentScope.endLine) {
        for (let i = currentScope.startLine + 1; i < debugLine; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('//') && !line.match(/^(await\s+)?step\(/)) {
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
                if (line && !line.startsWith('//') && !line.includes('await step(')) {
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
                if (line && !line.startsWith('//') && !line.match(/^(await\s+)?step\(/)) {
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
                        if (line && !line.startsWith('//') && !line.match(/^(await\s+)?step\(/)) {
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
            if (line && !line.startsWith('//') && !line.match(/^(before|beforeEach)\(/)) {
                linesToComment.add(i);
            }
        }
    }

    return linesToComment;
}

function findLinesToUncomment(lines: string[], scopes: ScopeInfo[], undebugLine: number): Set<number> {
    const linesToUncomment = new Set<number>();

    // Find the scope containing the undebug line
    let currentScope = scopes.find(s =>
        s.type === 'step' && s.startLine < undebugLine && s.endLine > undebugLine
    );

    // If undebug marker is not inside a step, it might be before the first step at test level
    // In this case, find the next step after the undebug line
    const testScope = scopes.find(s =>
        s.type === 'test' && s.startLine < undebugLine && s.endLine > undebugLine
    );

    if (!currentScope && testScope) {
        // Find the next step after the undebug line
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

    if (!currentScope) {
        return linesToUncomment;
    }

    // Helper function to check if a commented line looks like code (not an intentional comment)
    const looksLikeCode = (code: string): boolean => {
        const trimmed = code.trim();
        // Check for code patterns
        const codePatterns = [
            /^(const|let|var|await|return|if|for|while|function|class|import|export)\s/,
            /^[a-zA-Z_$][a-zA-Z0-9_$]*\s*[=\(]/,  // Variable assignment or function call
            /^[a-zA-Z_$][a-zA-Z0-9_$.]*\(/,       // Method calls: console.log(), obj.method()
            /^\$/,  // jQuery/WebdriverIO selectors
            /^expect\(/,  // Test assertions
        ];

        return codePatterns.some(pattern => pattern.test(trimmed));
    };

    // 1. Uncomment statements before undebug line in current step
    // Only if undebug line is actually inside the current step
    if (undebugLine > currentScope.startLine && undebugLine < currentScope.endLine) {
        for (let i = currentScope.startLine + 1; i < undebugLine; i++) {
            const line = lines[i].trim();
            if (line.startsWith('//') && !line.startsWith('// @')) {
                const code = line.substring(2).trim();
                if (looksLikeCode(code)) {
                    linesToUncomment.add(i);
                }
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
                if (line.startsWith('//') && !line.startsWith('// @')) {
                    const code = line.substring(2).trim();
                    if (looksLikeCode(code)) {
                        linesToUncomment.add(i);
                    }
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
                if (line.startsWith('//') && !line.startsWith('// @')) {
                    const code = line.substring(2).trim();
                    if (looksLikeCode(code)) {
                        linesToUncomment.add(i);
                    }
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
                        if (line.startsWith('//') && !line.startsWith('// @')) {
                            const code = line.substring(2).trim();
                            if (looksLikeCode(code)) {
                                linesToUncomment.add(i);
                            }
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
            if (line.startsWith('//') && !line.startsWith('// @')) {
                const code = line.substring(2).trim();
                if (looksLikeCode(code)) {
                    linesToUncomment.add(i);
                }
            }
        }
    }

    return linesToUncomment;
}

export function deactivate() { }

