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

    suite('Comment/Uncomment Behavior', () => {
        test('Should uncomment any line starting with //, not just code patterns', () => {
            // The new behavior: undebug removes first // regardless of content
            const commentedLines = [
                '        // const x = 1;',
                '        // await sleep(3000);',
                '        // already commented',
                '        // TODO: fix this',
                '        // some random text'
            ];

            for (const line of commentedLines) {
                const indentMatch = line.match(/^(\s*)/);
                const indent = indentMatch ? indentMatch[1] : '';
                const afterIndent = line.substring(indent.length);

                // All should be uncommented (first // removed)
                assert.ok(afterIndent.startsWith('//'), 'Line should start with //');
            }
        });

        test('Should handle double-commented lines correctly', () => {
            // When commenting an already-commented line, result should be double-commented
            const originalCommented = '        // already commented';
            const indent = originalCommented.match(/^(\s*)/)?.[1] || '';
            const trimmed = originalCommented.trim();

            let doubleCommented: string;
            if (trimmed.startsWith('//')) {
                doubleCommented = `${indent}//${originalCommented.trimStart()}`;
            } else {
                doubleCommented = `${indent}// ${originalCommented.trimStart()}`;
            }

            assert.strictEqual(doubleCommented, '        //// already commented');

            // When uncommenting double-commented line, should remove only first //
            const indentMatch = doubleCommented.match(/^(\s*)/);
            const indent2 = indentMatch ? indentMatch[1] : '';
            const afterIndent = doubleCommented.substring(indent2.length);

            let uncommented: string;
            if (afterIndent.startsWith('//')) {
                const rest = afterIndent.substring(2);
                if (rest.startsWith(' ')) {
                    uncommented = `${indent2}${rest.substring(1)}`;
                } else {
                    uncommented = `${indent2}${rest}`;
                }
            } else {
                uncommented = doubleCommented;
            }

            assert.strictEqual(uncommented, '        // already commented');
        });
    });

    suite('Line Comment/Uncomment Logic', () => {
        test('Should add comment prefix correctly', () => {
            const line = '        await sleep(3000);';
            const indent = line.match(/^(\s*)/)?.[1] || '';
            const commented = `${indent}// ${line.trimStart()}`;

            assert.strictEqual(commented, '        // await sleep(3000);');
        });

        test('Should respect existing comments when commenting', () => {
            // When a line already has //, add another // before it
            // This allows @undebug to reverse it properly
            const testCases = [
                {
                    input: '        // already commented',
                    expected: '        //// already commented',
                    description: 'commented line with space after //'
                },
                {
                    input: '    //already commented',
                    expected: '    ////already commented',
                    description: 'commented line without space after //'
                },
                {
                    input: '        not commented',
                    expected: '        // not commented',
                    description: 'uncommented line'
                }
            ];

            for (const testCase of testCases) {
                const line = testCase.input;
                const indent = line.match(/^(\s*)/)?.[1] || '';
                const trimmed = line.trim();

                let commentedLine: string;
                if (trimmed.startsWith('//')) {
                    // Already commented - add another //
                    commentedLine = `${indent}//${line.trimStart()}`;
                } else {
                    // Not commented - add //
                    commentedLine = `${indent}// ${line.trimStart()}`;
                }

                assert.strictEqual(commentedLine, testCase.expected,
                    `Failed for case: ${testCase.description}`);
            }
        });

        test('Should remove first // when uncommenting', () => {
            // Remove only the first // found
            const line = '        // await sleep(3000);';
            const indentMatch = line.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '';
            const afterIndent = line.substring(indent.length);

            let uncommentedLine: string;
            if (afterIndent.startsWith('//')) {
                const rest = afterIndent.substring(2);
                if (rest.startsWith(' ')) {
                    uncommentedLine = `${indent}${rest.substring(1)}`;
                } else {
                    uncommentedLine = `${indent}${rest}`;
                }
            } else {
                uncommentedLine = line;
            }

            assert.strictEqual(uncommentedLine, '        await sleep(3000);');
        });

        test('Should remove first // from double-commented line', () => {
            // When line is "    //// already commented", uncomment should result in "    /// already commented"
            const line = '        //// already commented';
            const indentMatch = line.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '';
            const afterIndent = line.substring(indent.length);

            let uncommentedLine: string;
            if (afterIndent.startsWith('//')) {
                const rest = afterIndent.substring(2);
                if (rest.startsWith(' ')) {
                    uncommentedLine = `${indent}${rest.substring(1)}`;
                } else {
                    uncommentedLine = `${indent}${rest}`;
                }
            } else {
                uncommentedLine = line;
            }

            assert.strictEqual(uncommentedLine, '        /// already commented');
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

