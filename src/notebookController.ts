import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';

export class ShbnController {
    readonly controller: vscode.NotebookController;
    private _executionOrder = 0;
    private _sudoPassword?: string;

    constructor(
        readonly controllerId: string = 'shbn-notebook-controller',
        readonly notebookType: string = 'shbn',
        readonly label: string = 'Runbook Shell Notebook'
    ) {
        this.controller = vscode.notebooks.createNotebookController(
            this.controllerId,
            this.notebookType,
            this.label
        );
        this.controller.supportedLanguages = ['bash', 'zsh', 'fish', 'sh', 'shellscript', 'powershell', 'pwsh'];
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

    private _hasSudo(code: string): boolean {
        const lines = code.split('\n');
        const sudoRegex = /\bsudo\b/;
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === '' || trimmed.startsWith('#')) {
                continue;
            }
            if (sudoRegex.test(trimmed)) {
                return true;
            }
        }
        return false;
    }

    private _cleanStderr(stderr: string): string {
        const lines = stderr.split('\n');
        const clean = lines.filter(line => !line.includes('[sudo] password for'));
        return clean.join('\n');
    }

    private async _executeCell(cell: vscode.NotebookCell): Promise<void> {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this._executionOrder;
        execution.start(Date.now());

        const code = cell.document.getText();
        const cwd = path.dirname(cell.document.uri.fsPath);

        // Determine shell executable based on the cell's languageId
        let shellExe = 'bash';
        let isPowerShell = false;
        const lang = cell.document.languageId;
        if (lang === 'zsh') {
            shellExe = 'zsh';
        } else if (lang === 'fish') {
            shellExe = 'fish';
        } else if (lang === 'sh') {
            shellExe = 'sh';
        } else if (lang === 'powershell') {
            shellExe = 'powershell';
            isPowerShell = true;
        } else if (lang === 'pwsh') {
            shellExe = 'pwsh';
            isPowerShell = true;
        }

        let password = this._sudoPassword;
        if (this._hasSudo(code) && !isPowerShell) {
            if (password === undefined) {
                const input = await vscode.window.showInputBox({
                    prompt: 'This cell contains sudo commands. Please enter sudo password:',
                    password: true,
                    ignoreFocusOut: true
                });
                if (input === undefined) {
                    // User cancelled the prompt, cancel execution
                    execution.end(false, Date.now());
                    return;
                }
                password = input;
                this._sudoPassword = password;
            }
        }

        let wrappedCode = code;
        if (password && !isPowerShell) {
            if (lang === 'fish') {
                wrappedCode = `function sudo; command sudo -S $argv; end; ${code}`;
            } else {
                wrappedCode = `sudo() { command sudo -S "$@"; }; ${code}`;
            }
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
            const spawnArgs = isPowerShell
                ? ['-NoProfile', '-NonInteractive', '-Command', wrappedCode]
                : ['-c', wrappedCode];

            const child = spawn(shellExe, spawnArgs, {
                cwd,
                env: process.env
            });

            execution.token.onCancellationRequested(() => {
                processKilled = true;
                child.kill('SIGINT');
            });

            if (password && !isPowerShell && child.stdin) {
                child.stdin.write(password + '\n');
                child.stdin.end();
            }

            child.stdout.on('data', async (data) => {
                stdoutAccumulator += data.toString();
                await updateOutput();
            });

            child.stderr.on('data', async (data) => {
                let errStr = data.toString();
                if (password && !isPowerShell) {
                    errStr = this._cleanStderr(errStr);
                }
                if (errStr) {
                    stderrAccumulator += errStr;
                    await updateOutput();
                }
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
