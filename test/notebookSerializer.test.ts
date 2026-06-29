import * as assert from 'assert';
import * as vscode from 'vscode';
import { RunbookSerializer } from '../src/notebookSerializer';
import { TextEncoder, TextDecoder } from 'util';

describe('RunbookSerializer', () => {
    let serializer: RunbookSerializer;

    beforeEach(() => {
        serializer = new RunbookSerializer();
    });

    describe('deserializeNotebook', () => {
        it('should return an empty notebook when content is empty', async () => {
            const result = await serializer.deserializeNotebook(new Uint8Array(), {} as any);
            assert.deepStrictEqual(result.cells, []);
            assert.deepStrictEqual(result.metadata, {});
        });

        it('should return an empty notebook when JSON is invalid', async () => {
            const badJSON = new TextEncoder().encode('{ invalid json');
            const result = await serializer.deserializeNotebook(badJSON, {} as any);
            assert.deepStrictEqual(result.cells, []);
            assert.deepStrictEqual(result.metadata, {});
        });

        it('should correctly deserialize code and markdown cells', async () => {
            const rawNotebook = {
                cells: [
                    {
                        cell_type: 'markdown',
                        source: '# Markdown Title\nSome description.'
                    },
                    {
                        cell_type: 'code',
                        source: ['echo "hello"\n', 'echo "world"'],
                        metadata: {
                            vscode: {
                                languageId: 'zsh'
                            }
                        },
                        execution_count: 5
                    }
                ],
                metadata: {
                    customNotebookMeta: 'value'
                },
                nbformat: 4,
                nbformat_minor: 5
            };

            const data = new TextEncoder().encode(JSON.stringify(rawNotebook));
            const result = await serializer.deserializeNotebook(data, {} as any);

            assert.strictEqual(result.cells.length, 2);
            assert.deepStrictEqual(result.metadata, { customNotebookMeta: 'value' });

            const mdCell = result.cells[0];
            assert.strictEqual(mdCell.kind, vscode.NotebookCellKind.Markup);
            assert.strictEqual(mdCell.value, '# Markdown Title\nSome description.');
            assert.strictEqual(mdCell.languageId, 'markdown');

            const codeCell = result.cells[1];
            assert.strictEqual(codeCell.kind, vscode.NotebookCellKind.Code);
            assert.strictEqual(codeCell.value, 'echo "hello"\necho "world"');
            assert.strictEqual(codeCell.languageId, 'zsh');
            assert.deepStrictEqual(codeCell.executionSummary, { executionOrder: 5 });
        });

        it('should map cell outputs correctly during deserialization', async () => {
            const rawNotebook = {
                cells: [
                    {
                        cell_type: 'code',
                        source: 'echo "hi"',
                        outputs: [
                            {
                                output_type: 'stream',
                                name: 'stdout',
                                text: ['line1\n', 'line2']
                            },
                            {
                                output_type: 'stream',
                                name: 'stderr',
                                text: 'error line'
                            },
                            {
                                output_type: 'error',
                                ename: 'CustomError',
                                evalue: 'Something went wrong',
                                traceback: ['trace 1', 'trace 2']
                            },
                            {
                                output_type: 'execute_result',
                                data: {
                                    'text/plain': 'plain output',
                                    'image/png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
                                }
                            }
                        ]
                    }
                ],
                nbformat: 4,
                nbformat_minor: 5
            };

            const data = new TextEncoder().encode(JSON.stringify(rawNotebook));
            const result = await serializer.deserializeNotebook(data, {} as any);

            const cell = result.cells[0];
            assert.ok(cell.outputs);
            assert.strictEqual(cell.outputs.length, 4);

            // Stream stdout
            const out1 = cell.outputs[0];
            assert.strictEqual(out1.items.length, 1);
            assert.strictEqual(out1.items[0].mime, 'application/vnd.code.notebook.stdout');
            assert.strictEqual(new TextDecoder().decode(out1.items[0].data), 'line1\nline2');

            // Stream stderr
            const out2 = cell.outputs[1];
            assert.strictEqual(out2.items.length, 1);
            assert.strictEqual(out2.items[0].mime, 'application/vnd.code.notebook.stderr');
            assert.strictEqual(new TextDecoder().decode(out2.items[0].data), 'error line');

            // Error
            const out3 = cell.outputs[2];
            assert.strictEqual(out3.items.length, 1);
            assert.strictEqual(out3.items[0].mime, 'application/vnd.code.notebook.error');
            const errObj = JSON.parse(new TextDecoder().decode(out3.items[0].data));
            assert.strictEqual(errObj.name, 'CustomError');
            assert.strictEqual(errObj.message, 'Something went wrong');
            assert.strictEqual(errObj.stack, 'trace 1\ntrace 2');

            // execute_result (text/plain & image/png)
            const out4 = cell.outputs[3];
            assert.strictEqual(out4.items.length, 2);

            const plainItem = out4.items.find(i => i.mime === 'text/plain');
            assert.ok(plainItem);
            assert.strictEqual(new TextDecoder().decode(plainItem.data), 'plain output');

            const pngItem = out4.items.find(i => i.mime === 'image/png');
            assert.ok(pngItem);
            assert.strictEqual(Buffer.from(pngItem.data).toString('base64'), 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
        });
    });

    describe('serializeNotebook', () => {
        it('should serialize notebook structure and outputs back to JSON format', async () => {
            const cells = [
                new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, '# Header', 'markdown'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'echo "test"', 'bash')
            ];
            cells[1].executionSummary = { executionOrder: 42 };
            cells[1].outputs = [
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.stdout('stdout content\n')
                ]),
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.stderr('stderr content')
                ]),
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error({
                        name: 'MyError',
                        message: 'Custom message',
                        stack: 'stack trace line 1\nstack trace line 2'
                    })
                ]),
                new vscode.NotebookCellOutput([
                    new vscode.NotebookCellOutputItem(new TextEncoder().encode('some-text'), 'text/plain'),
                    new vscode.NotebookCellOutputItem(Buffer.from('base64image', 'utf-8'), 'image/png')
                ])
            ];

            const docData = new vscode.NotebookData(cells);
            docData.metadata = { originalNotebookMeta: 'ok' };

            const serializedBytes = await serializer.serializeNotebook(docData, {} as any);
            const decodedStr = new TextDecoder().decode(serializedBytes);
            const raw = JSON.parse(decodedStr);

            assert.strictEqual(raw.nbformat, 4);
            assert.strictEqual(raw.nbformat_minor, 5);
            assert.strictEqual(raw.metadata.originalNotebookMeta, 'ok');
            assert.strictEqual(raw.cells.length, 2);

            // Markdown cell
            const rawCell1 = raw.cells[0];
            assert.strictEqual(rawCell1.cell_type, 'markdown');
            assert.deepStrictEqual(rawCell1.source, ['# Header']);

            // Code cell
            const rawCell2 = raw.cells[1];
            assert.strictEqual(rawCell2.cell_type, 'code');
            assert.deepStrictEqual(rawCell2.source, ['echo "test"']);
            assert.strictEqual(rawCell2.execution_count, 42);
            assert.strictEqual(rawCell2.metadata.vscode.languageId, 'bash');

            const outs = rawCell2.outputs;
            assert.strictEqual(outs.length, 4);

            // Stream stdout
            assert.strictEqual(outs[0].output_type, 'stream');
            assert.strictEqual(outs[0].name, 'stdout');
            assert.deepStrictEqual(outs[0].text, ['stdout content\n']);

            // Stream stderr
            assert.strictEqual(outs[1].output_type, 'stream');
            assert.strictEqual(outs[1].name, 'stderr');
            assert.deepStrictEqual(outs[1].text, ['stderr content']);

            // Error
            assert.strictEqual(outs[2].output_type, 'error');
            assert.strictEqual(outs[2].ename, 'MyError');
            assert.strictEqual(outs[2].evalue, 'Custom message');
            assert.deepStrictEqual(outs[2].traceback, ['stack trace line 1', 'stack trace line 2']);

            // execute_result
            assert.strictEqual(outs[3].output_type, 'execute_result');
            assert.deepStrictEqual(outs[3].data['text/plain'], ['some-text']);
            assert.strictEqual(outs[3].data['image/png'], Buffer.from('base64image').toString('base64'));
        });
    });
});
