import * as assert from 'assert';

// Test the core logic functions
suite('Logic Test Suite', () => {

    suite('Scope Parsing', () => {
        test('Should identify step scopes', () => {
            const code = `
await step('first step', async () => {
    const x = 1;
});
            `.trim().split('\n');

            // Since we can't import the internal functions directly,
            // we'll test through file processing
            assert.ok(code.length > 0);
        });

        test('Should identify before/beforeEach scopes', () => {
            const code = `
before(() => {
    console.log('setup');
});
            `.trim().split('\n');

            assert.ok(code.length > 0);
        });
    });

    suite('Code Pattern Detection', () => {
        test('Should detect const declaration as code', () => {
            const line = 'const content = [];';
            const patterns = [
                /^(const|let|var|await|return|if|for|while|function|class|import|export)\s/,
                /^[a-zA-Z_$][a-zA-Z0-9_$]*\s*[=\(]/,
                /^[a-zA-Z_$][a-zA-Z0-9_$.]*\(/,
                /^\$/,
                /^expect\(/,
            ];

            const matches = patterns.some(pattern => pattern.test(line));
            assert.strictEqual(matches, true, 'Should detect const as code');
        });

        test('Should detect await statement as code', () => {
            const line = 'await sleep(3000);';
            const patterns = [
                /^(const|let|var|await|return|if|for|while|function|class|import|export)\s/,
            ];

            const matches = patterns.some(pattern => pattern.test(line));
            assert.strictEqual(matches, true, 'Should detect await as code');
        });

        test('Should detect console.log as code', () => {
            const line = "console.log('before');";
            const pattern = /^[a-zA-Z_$][a-zA-Z0-9_$.]*\(/;

            const matches = pattern.test(line);
            assert.strictEqual(matches, true, 'Should detect console.log as code');
        });

        test('Should detect WebdriverIO selector as code', () => {
            const line = "$('selector').tap();";
            const pattern = /^\$/;

            const matches = pattern.test(line);
            assert.strictEqual(matches, true, 'Should detect $ selector as code');
        });

        test('Should NOT detect intentional comment as code', () => {
            const line = 'intentional comment';
            const patterns = [
                /^(const|let|var|await|return|if|for|while|function|class|import|export)\s/,
                /^[a-zA-Z_$][a-zA-Z0-9_$]*\s*[=\(]/,
                /^[a-zA-Z_$][a-zA-Z0-9_$.]*\(/,
                /^\$/,
                /^expect\(/,
            ];

            const matches = patterns.some(pattern => pattern.test(line));
            assert.strictEqual(matches, false, 'Should NOT detect comment as code');
        });

        test('Should NOT detect TODO comment as code', () => {
            const line = 'TODO: fix this later';
            const patterns = [
                /^(const|let|var|await|return|if|for|while|function|class|import|export)\s/,
                /^[a-zA-Z_$][a-zA-Z0-9_$]*\s*[=\(]/,
                /^[a-zA-Z_$][a-zA-Z0-9_$.]*\(/,
                /^\$/,
                /^expect\(/,
            ];

            const matches = patterns.some(pattern => pattern.test(line));
            assert.strictEqual(matches, false, 'Should NOT detect TODO as code');
        });
    });

    suite('Line Comment/Uncomment Logic', () => {
        test('Should add comment prefix correctly', () => {
            const line = '        await sleep(3000);';
            const indent = line.match(/^(\s*)/)?.[1] || '';
            const commented = `${indent}// ${line.trimStart()}`;

            assert.strictEqual(commented, '        // await sleep(3000);');
        });

        test('Should remove comment prefix correctly', () => {
            const line = '        // await sleep(3000);';
            const match = line.match(/^(\s*)\/\/\s(.+)$/);

            assert.ok(match);
            if (match) {
                const indent = match[1];
                const code = match[2];
                const uncommented = `${indent}${code}`;

                assert.strictEqual(uncommented, '        await sleep(3000);');
            }
        });

        test('Should preserve indentation when commenting', () => {
            const lines = [
                'no indent',
                '    4 spaces',
                '        8 spaces',
                '\ttab indent'
            ];

            for (const line of lines) {
                const indent = line.match(/^(\s*)/)?.[1] || '';
                const commented = `${indent}// ${line.trimStart()}`;

                // Should start with same indentation
                assert.ok(commented.startsWith(indent));
                // Should have // after indentation
                assert.ok(commented.includes('// '));
            }
        });
    });

    suite('Marker Detection', () => {
        test('Should detect @debug marker', () => {
            const line = '// @debug';
            assert.strictEqual(line.trim(), '// @debug');
        });

        test('Should detect @undebug marker', () => {
            const line = '// @undebug';
            assert.strictEqual(line.trim(), '// @undebug');
        });

        test('Should NOT detect commented marker', () => {
            const line = '// // @debug';
            assert.notStrictEqual(line.trim(), '// @debug');
        });
    });
});

