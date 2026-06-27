import * as vscode from 'vscode';

interface RawNotebookCell {
    cell_type: 'code' | 'markdown';
    source: string | string[];
    metadata?: any;
    execution_count?: number | null;
    outputs?: any[];
}

interface RawNotebook {
    cells: RawNotebookCell[];
    metadata?: any;
    nbformat: number;
    nbformat_minor: number;
}

export class ShbnSerializer implements vscode.NotebookSerializer {
    constructor(private defaultLanguage: string = 'bash') {}

    async deserializeNotebook(
        content: Uint8Array,
        _token: vscode.CancellationToken
    ): Promise<vscode.NotebookData> {
        let raw: RawNotebook;
        if (content.length === 0) {
            raw = {
                cells: [],
                metadata: {},
                nbformat: 4,
                nbformat_minor: 5
            };
        } else {
            const str = new TextDecoder('utf-8').decode(content);
            try {
                raw = JSON.parse(str);
            } catch (err) {
                raw = {
                    cells: [],
                    metadata: {},
                    nbformat: 4,
                    nbformat_minor: 5
                };
            }
        }

        const cells = (raw.cells || []).map(cell => {
            const kind = cell.cell_type === 'code' ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup;
            const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
            
            // Map cell language: default to defaultLanguage, but allow other shell languages if specified in metadata
            let languageId = kind === vscode.NotebookCellKind.Code ? this.defaultLanguage : 'markdown';
            if (kind === vscode.NotebookCellKind.Code) {
                if (cell.metadata?.vscode?.languageId) {
                    languageId = cell.metadata.vscode.languageId;
                } else if (cell.metadata?.language) {
                    languageId = cell.metadata.language;
                }
            }
            
            const cellData = new vscode.NotebookCellData(kind, source, languageId);
            
            // Map outputs if they exist
            if (kind === vscode.NotebookCellKind.Code && cell.outputs) {
                cellData.outputs = cell.outputs.map(out => {
                    const items: vscode.NotebookCellOutputItem[] = [];
                    
                    if (out.output_type === 'stream') {
                        const text = Array.isArray(out.text) ? out.text.join('') : (out.text || '');
                        if (out.name === 'stderr') {
                            items.push(vscode.NotebookCellOutputItem.stderr(text));
                        } else {
                            items.push(vscode.NotebookCellOutputItem.stdout(text));
                        }
                    } else if (out.output_type === 'error') {
                        items.push(vscode.NotebookCellOutputItem.error({
                            name: out.ename || 'Error',
                            message: out.evalue || '',
                            stack: Array.isArray(out.traceback) ? out.traceback.join('\n') : (out.traceback || '')
                        }));
                    } else if (out.output_type === 'execute_result' || out.output_type === 'display_data') {
                        for (const [mime, val] of Object.entries(out.data || {})) {
                            let bytes: Uint8Array;
                            if (mime.startsWith('image/')) {
                                const base64Str = Array.isArray(val) ? val.join('') : (val as string);
                                bytes = Buffer.from(base64Str, 'base64');
                            } else {
                                const textStr = Array.isArray(val) ? val.join('') : (val as string);
                                bytes = new TextEncoder().encode(textStr);
                            }
                            items.push(new vscode.NotebookCellOutputItem(bytes, mime));
                        }
                    }
                    
                    return new vscode.NotebookCellOutput(items, out.metadata);
                });
            }

            if (cell.execution_count !== undefined && cell.execution_count !== null) {
                cellData.executionSummary = { executionOrder: cell.execution_count };
            }

            cellData.metadata = cell.metadata || {};
            return cellData;
        });

        const notebookData = new vscode.NotebookData(cells);
        notebookData.metadata = raw.metadata || {};
        return notebookData;
    }

    async serializeNotebook(
        data: vscode.NotebookData,
        _token: vscode.CancellationToken
    ): Promise<Uint8Array> {
        const cells: RawNotebookCell[] = data.cells.map(cell => {
            const cell_type = cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown';
            const source = splitLines(cell.value);
            
            // Preserve/embed languageId inside cell metadata so we don't lose it
            const metadata = { ...(cell.metadata || {}) };
            if (cell.kind === vscode.NotebookCellKind.Code) {
                metadata.vscode = metadata.vscode || {};
                metadata.vscode.languageId = cell.languageId;
                metadata.language = cell.languageId;
            }
            
            const rawCell: RawNotebookCell = {
                cell_type,
                source,
                metadata
            };

            if (cell.kind === vscode.NotebookCellKind.Code) {
                rawCell.execution_count = cell.executionSummary?.executionOrder ?? null;
                rawCell.outputs = (cell.outputs || []).map(out => {
                    // Check if it's a stream
                    const stdoutItem = out.items.find(item => item.mime === 'application/vnd.code.notebook.stdout');
                    const stderrItem = out.items.find(item => item.mime === 'application/vnd.code.notebook.stderr');
                    
                    if (stdoutItem || stderrItem) {
                        const name = stderrItem ? 'stderr' : 'stdout';
                        const activeItem = stderrItem || stdoutItem;
                        const text = splitLines(new TextDecoder('utf-8').decode(activeItem!.data));
                        return {
                            output_type: 'stream',
                            name,
                            text
                        };
                    }

                    // Check if it's an error
                    const errorItem = out.items.find(item => item.mime === 'application/vnd.code.notebook.error');
                    if (errorItem) {
                        try {
                            const errVal = JSON.parse(new TextDecoder('utf-8').decode(errorItem.data));
                            return {
                                output_type: 'error',
                                ename: errVal.name || 'Error',
                                evalue: errVal.message || '',
                                traceback: errVal.stack ? errVal.stack.split('\n') : []
                            };
                        } catch {
                            return {
                                output_type: 'error',
                                ename: 'Error',
                                evalue: 'Unknown error during execution',
                                traceback: []
                            };
                        }
                    }

                    // Treat as execute_result / display_data
                    const dataObj: { [mime: string]: string | string[] } = {};
                    for (const item of out.items) {
                        if (item.mime.startsWith('image/')) {
                            const base64Str = Buffer.from(item.data).toString('base64');
                            dataObj[item.mime] = base64Str;
                        } else {
                            dataObj[item.mime] = splitLines(new TextDecoder('utf-8').decode(item.data));
                        }
                    }

                    return {
                        output_type: 'execute_result',
                        data: dataObj,
                        metadata: out.metadata || {},
                        execution_count: cell.executionSummary?.executionOrder ?? null
                    };
                });
            }

            return rawCell;
        });

        const rawNotebook: RawNotebook = {
            cells,
            metadata: data.metadata || {},
            nbformat: data.metadata?.nbformat || 4,
            nbformat_minor: data.metadata?.nbformat_minor || 5
        };

        const str = JSON.stringify(rawNotebook, null, 2);
        return new TextEncoder().encode(str);
    }
}

function splitLines(value: string): string[] {
    const lines = value.split('\n');
    return lines.map((line, index) => {
        if (index === lines.length - 1) {
            return line;
        }
        return line + '\n';
    }).filter((line, index, arr) => {
        if (index === arr.length - 1 && line === '') {
            return false;
        }
        return true;
    });
}
