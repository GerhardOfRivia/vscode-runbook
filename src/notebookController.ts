import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';

export class ShbnController {
    readonly controllerId = 'shbn-notebook-controller';
    readonly notebookType = 'shbn';
    readonly label = 'Runbook Shell Notebook';
    readonly controller: vscode.NotebookController;
    private _executionOrder = 0;

    constructor() {
        this.controller = vscode.notebooks.createNotebookController(
            this.controllerId,
            this.notebookType,
            this.label
        );
        this.controller.supportedLanguages = ['bash', 'zsh', 'fish', 'sh', 'shellscript'];
        this.controller.supportsExecutionOrder = true;
        this.controller.executeHandler = this._execute.bind(this);
    }

    private async _execute(
        cells: vscode.NotebookCell[],
        _notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
    ): Promise<void> {
        for (const cell of cells) {
            await this._executeCell(cell);
        }
    }

    private async _executeCell(cell: vscode.NotebookCell): Promise<void> {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this._executionOrder;
        execution.start(Date.now());

        const code = cell.document.getText();
        const cwd = path.dirname(cell.document.uri.fsPath);

        // Determine shell executable based on the cell's languageId
        let shellExe = 'bash';
        const lang = cell.document.languageId;
        if (lang === 'zsh') {
            shellExe = 'zsh';
        } else if (lang === 'fish') {
            shellExe = 'fish';
        } else if (lang === 'sh') {
            shellExe = 'sh';
        }

        let stdoutAccumulator = '';
        let stderrAccumulator = '';
        let processKilled = false;

        const updateOutput = async () => {
            const outputs: vscode.NotebookCellOutput[] = [];
            if (stdoutAccumulator) {
                outputs.push(new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.stdout(stdoutAccumulator)
                ]));
            }
            if (stderrAccumulator) {
                outputs.push(new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.stderr(stderrAccumulator)
                ]));
            }
            await execution.replaceOutput(outputs);
        };

        try {
            const child = spawn(shellExe, ['-c', code], {
                cwd,
                env: process.env
            });

            execution.token.onCancellationRequested(() => {
                processKilled = true;
                child.kill('SIGINT');
            });

            child.stdout.on('data', async (data) => {
                stdoutAccumulator += data.toString();
                await updateOutput();
            });

            child.stderr.on('data', async (data) => {
                stderrAccumulator += data.toString();
                await updateOutput();
            });

            const exitResult = await new Promise<number | null | Error>((resolve) => {
                child.on('close', (code) => {
                    resolve(code);
                });
                child.on('error', (err) => {
                    resolve(err);
                });
            });

            if (processKilled) {
                execution.end(false, Date.now());
                return;
            }

            if (exitResult instanceof Error) {
                const isNotFound = (exitResult as any).code === 'ENOENT';
                const message = isNotFound
                    ? `Error: Shell executable '${shellExe}' was not found. Please ensure it is installed and in your PATH.`
                    : `Error spawning process: ${exitResult.message}`;

                await execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.error({
                            name: 'SpawnError',
                            message,
                            stack: exitResult.stack || ''
                        })
                    ])
                ]);
                execution.end(false, Date.now());
                return;
            }

            if (exitResult !== 0) {
                const outputs: vscode.NotebookCellOutput[] = [];
                if (stdoutAccumulator) {
                    outputs.push(new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stdout(stdoutAccumulator)
                    ]));
                }
                if (stderrAccumulator) {
                    outputs.push(new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stderr(stderrAccumulator)
                    ]));
                }
                outputs.push(new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error({
                        name: 'ExitCodeError',
                        message: `Process exited with code ${exitResult}`,
                        stack: ''
                    })
                ]));
                await execution.replaceOutput(outputs);
                execution.end(false, Date.now());
            } else {
                execution.end(true, Date.now());
            }

        } catch (err: any) {
            await execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error({
                        name: 'ExecutionError',
                        message: err.message || 'Unknown error occurred during execution',
                        stack: err.stack || ''
                    })
                ])
            ]);
            execution.end(false, Date.now());
        }
    }

    dispose() {
        this.controller.dispose();
    }
}
