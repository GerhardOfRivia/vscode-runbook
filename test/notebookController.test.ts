import * as assert from 'assert';
import * as vscode from 'vscode';
import { ShbnController } from '../src/notebookController';
import { clearControllers, createdControllers } from './vscodeMock';

const child_process = require('child_process');

describe('ShbnController', () => {
    let controller: ShbnController;
    const originalSpawn = child_process.spawn;

    beforeEach(() => {
        clearControllers();
        controller = new ShbnController();
    });

    afterEach(() => {
        child_process.spawn = originalSpawn;
        controller.dispose();
    });

    it('should initialize with correct properties', () => {
        assert.strictEqual(createdControllers.length, 1);
        const mockCtrl = createdControllers[0];
        assert.strictEqual(mockCtrl.id, 'shbn-notebook-controller');
        assert.strictEqual(mockCtrl.viewType, 'shbn');
        assert.strictEqual(mockCtrl.label, 'Runbook Shell Notebook');
        assert.deepStrictEqual(mockCtrl.supportedLanguages, ['bash', 'zsh', 'fish', 'sh', 'shellscript']);
        assert.strictEqual(mockCtrl.supportsExecutionOrder, true);
        assert.ok(mockCtrl.executeHandler);
    });

    it('should successfully run a command that outputs stdout', async () => {
        const mockCtrl = createdControllers[0];
        const cell = {
            document: {
                getText: () => 'echo "hello-world"',
                languageId: 'sh',
                uri: {
                    fsPath: __filename,
                    scheme: 'file'
                }
            },
            kind: vscode.NotebookCellKind.Code,
            outputs: [] as any[],
            metadata: {}
        };

        // Call the execute handler
        await mockCtrl.executeHandler([cell], {}, mockCtrl);

        // Verify execution results
        assert.strictEqual(mockCtrl.activeExecutions.length, 1);
        const execution = mockCtrl.activeExecutions[0];
        
        assert.strictEqual(execution.success, true);
        assert.strictEqual(execution.executionOrder, 1);
        assert.ok(execution.startedAt);
        assert.ok(execution.endedAt);

        // Verify outputs
        assert.strictEqual(execution.outputs.length, 1);
        const output = execution.outputs[0];
        assert.strictEqual(output.items.length, 1);
        assert.strictEqual(output.items[0].mime, 'application/vnd.code.notebook.stdout');
        const text = new TextDecoder().decode(output.items[0].data);
        assert.strictEqual(text, 'hello-world\n');
    });

    it('should successfully run a command that outputs stderr', async () => {
        const mockCtrl = createdControllers[0];
        const cell = {
            document: {
                getText: () => 'echo "an error" >&2',
                languageId: 'sh',
                uri: {
                    fsPath: __filename,
                    scheme: 'file'
                }
            },
            kind: vscode.NotebookCellKind.Code,
            outputs: [] as any[],
            metadata: {}
        };

        await mockCtrl.executeHandler([cell], {}, mockCtrl);

        const execution = mockCtrl.activeExecutions[0];
        assert.strictEqual(execution.success, true);
        assert.strictEqual(execution.outputs.length, 1);
        const output = execution.outputs[0];
        assert.strictEqual(output.items.length, 1);
        assert.strictEqual(output.items[0].mime, 'application/vnd.code.notebook.stderr');
        const text = new TextDecoder().decode(output.items[0].data);
        assert.strictEqual(text, 'an error\n');
    });

    it('should handle a command exiting with a non-zero exit code', async () => {
        const mockCtrl = createdControllers[0];
        const cell = {
            document: {
                getText: () => 'exit 42',
                languageId: 'sh',
                uri: {
                    fsPath: __filename,
                    scheme: 'file'
                }
            },
            kind: vscode.NotebookCellKind.Code,
            outputs: [] as any[],
            metadata: {}
        };

        await mockCtrl.executeHandler([cell], {}, mockCtrl);

        const execution = mockCtrl.activeExecutions[0];
        assert.strictEqual(execution.success, false);
        
        // Output should include the ExitCodeError
        const errorOutput = execution.outputs.find((out: any) => 
            out.items.some((i: any) => i.mime === 'application/vnd.code.notebook.error')
        );
        assert.ok(errorOutput);
        const errItem = errorOutput.items.find((i: any) => i.mime === 'application/vnd.code.notebook.error');
        const errObj = JSON.parse(new TextDecoder().decode(errItem.data));
        assert.strictEqual(errObj.name, 'ExitCodeError');
        assert.strictEqual(errObj.message, 'Process exited with code 42');
    });

    it('should handle process spawning errors (ENOENT)', async () => {
        const mockCtrl = createdControllers[0];
        const cell = {
            document: {
                getText: () => 'echo "will fail"',
                languageId: 'sh',
                uri: {
                    fsPath: __filename,
                    scheme: 'file'
                }
            },
            kind: vscode.NotebookCellKind.Code,
            outputs: [] as any[],
            metadata: {}
        };

        // Stub child_process.spawn to emit an error
        child_process.spawn = () => {
            const mockChild = new (require('events').EventEmitter)();
            mockChild.stdout = new (require('events').EventEmitter)();
            mockChild.stderr = new (require('events').EventEmitter)();
            mockChild.kill = () => {};
            
            // Emit error asynchronously
            process.nextTick(() => {
                const err = new Error('spawn ENOENT');
                (err as any).code = 'ENOENT';
                mockChild.emit('error', err);
            });
            return mockChild;
        };

        await mockCtrl.executeHandler([cell], {}, mockCtrl);

        const execution = mockCtrl.activeExecutions[0];
        assert.strictEqual(execution.success, false);

        assert.strictEqual(execution.outputs.length, 1);
        const errItem = execution.outputs[0].items[0];
        assert.strictEqual(errItem.mime, 'application/vnd.code.notebook.error');
        const errObj = JSON.parse(new TextDecoder().decode(errItem.data));
        assert.strictEqual(errObj.name, 'SpawnError');
        assert.ok(errObj.message.includes('not found'));
    });

    it('should support execution cancellation', async () => {
        const mockCtrl = createdControllers[0];
        const cell = {
            document: {
                getText: () => 'sleep 10',
                languageId: 'sh',
                uri: {
                    fsPath: __filename,
                    scheme: 'file'
                }
            },
            kind: vscode.NotebookCellKind.Code,
            outputs: [] as any[],
            metadata: {}
        };

        // Stub child_process.spawn to mock a slow process
        let sigintSent = false;
        child_process.spawn = () => {
            const mockChild = new (require('events').EventEmitter)();
            mockChild.stdout = new (require('events').EventEmitter)();
            mockChild.stderr = new (require('events').EventEmitter)();
            mockChild.kill = (signal: string) => {
                if (signal === 'SIGINT') {
                    sigintSent = true;
                    process.nextTick(() => {
                        mockChild.emit('close', null);
                    });
                }
            };
            return mockChild;
        };

        // Start execution, cancel immediately in next tick
        const promise = mockCtrl.executeHandler([cell], {}, mockCtrl);
        
        process.nextTick(() => {
            const execution = mockCtrl.activeExecutions[0];
            execution.token.cancel();
        });

        await promise;

        const execution = mockCtrl.activeExecutions[0];
        assert.strictEqual(execution.success, false);
        assert.strictEqual(sigintSent, true);
    });
});
