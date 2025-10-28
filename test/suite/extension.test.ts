import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Mocha Test Debug Helper Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('narukami-dev.mocha-test-debug-helper'));
    });

    test('Should activate extension', async () => {
        const ext = vscode.extensions.getExtension('narukami-dev.mocha-test-debug-helper');
        if (ext) {
            await ext.activate();
            assert.strictEqual(ext.isActive, true);
        }
    });

    test('Should register processDebug command', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('mocha-test-debug-helper.processDebug'));
    });

    test('Should register toggleDebugMarker command', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('mocha-test-debug-helper.toggleDebugMarker'));
    });

    test('Toggle marker: Insert @debug on empty line', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: '',
            language: 'typescript'
        });
        const editor = await vscode.window.showTextDocument(document);

        // Execute toggle command
        await vscode.commands.executeCommand('mocha-test-debug-helper.toggleDebugMarker');

        // Wait for edit to apply
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check result
        const text = editor.document.getText();
        assert.strictEqual(text, '// @debug');

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('Toggle marker: Replace @debug with @undebug', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: '// @debug',
            language: 'typescript'
        });
        const editor = await vscode.window.showTextDocument(document);

        // Set cursor on the @debug line
        editor.selection = new vscode.Selection(0, 0, 0, 0);

        // Execute toggle command
        await vscode.commands.executeCommand('mocha-test-debug-helper.toggleDebugMarker');

        // Wait for edit to apply
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check result
        const text = editor.document.getText();
        assert.strictEqual(text, '// @undebug');

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('Toggle marker: Delete @undebug line', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: '// @undebug\nconst x = 1;',
            language: 'typescript'
        });
        const editor = await vscode.window.showTextDocument(document);

        // Set cursor on the @undebug line
        editor.selection = new vscode.Selection(0, 0, 0, 0);

        // Execute toggle command
        await vscode.commands.executeCommand('mocha-test-debug-helper.toggleDebugMarker');

        // Wait for edit to apply
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check result
        const text = editor.document.getText();
        assert.strictEqual(text, 'const x = 1;');

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });

    test('Toggle marker: Insert @debug on line with content', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: '        await step(() => {});',
            language: 'typescript'
        });
        const editor = await vscode.window.showTextDocument(document);

        // Set cursor on the line
        editor.selection = new vscode.Selection(0, 8, 0, 8);

        // Execute toggle command
        await vscode.commands.executeCommand('mocha-test-debug-helper.toggleDebugMarker');

        // Wait for edit to apply
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check result - should insert on new line above with same indentation
        const text = editor.document.getText();
        assert.strictEqual(text, '        // @debug\n        await step(() => {});');

        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    });
});

