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
});

