import { TextEncoder } from 'util';

export enum NotebookCellKind {
    Markup = 1,
    Code = 2
}

export class NotebookData {
    cells: NotebookCellData[];
    metadata: any;
    constructor(cells: NotebookCellData[]) {
        this.cells = cells;
        this.metadata = {};
    }
}

export class NotebookCellData {
    kind: NotebookCellKind;
    value: string;
    languageId: string;
    metadata?: any;
    outputs?: NotebookCellOutput[];
    executionSummary?: { executionOrder: number };

    constructor(kind: NotebookCellKind, value: string, languageId: string) {
        this.kind = kind;
        this.value = value;
        this.languageId = languageId;
    }
}

export class NotebookCellOutputItem {
    data: Uint8Array;
    mime: string;

    constructor(data: Uint8Array, mime: string) {
        this.data = data;
        this.mime = mime;
    }

    static stdout(value: string): NotebookCellOutputItem {
        return new NotebookCellOutputItem(new TextEncoder().encode(value), 'application/vnd.code.notebook.stdout');
    }

    static stderr(value: string): NotebookCellOutputItem {
        return new NotebookCellOutputItem(new TextEncoder().encode(value), 'application/vnd.code.notebook.stderr');
    }

    static error(value: { name: string; message: string; stack?: string }): NotebookCellOutputItem {
        return new NotebookCellOutputItem(new TextEncoder().encode(JSON.stringify(value)), 'application/vnd.code.notebook.error');
    }
}

export class NotebookCellOutput {
    items: NotebookCellOutputItem[];
    metadata?: any;

    constructor(items: NotebookCellOutputItem[], metadata?: any) {
        this.items = items;
        this.metadata = metadata;
    }
}

// Controller mocking tracking
export const createdControllers: any[] = [];
export function clearControllers() {
    createdControllers.length = 0;
}

export function createNotebookController(id: string, viewType: string, label: string) {
    const controller = {
        id,
        viewType,
        label,
        supportedLanguages: [] as string[],
        supportsExecutionOrder: false,
        executeHandler: undefined as any,
        createNotebookCellExecution: (cell: any) => {
            const execution = {
                cell,
                executionOrder: undefined as number | undefined,
                startedAt: undefined as number | undefined,
                endedAt: undefined as number | undefined,
                success: undefined as boolean | undefined,
                outputs: [] as any[],
                token: {
                    isCancellationRequested: false,
                    _cancellationHandlers: [] as Function[],
                    onCancellationRequested(handler: Function) {
                        this._cancellationHandlers.push(handler);
                        return { dispose() {} };
                    },
                    cancel() {
                        this.isCancellationRequested = true;
                        this._cancellationHandlers.forEach(h => h());
                    }
                },
                start(time: number) {
                    this.startedAt = time;
                },
                replaceOutput(outputs: any[]) {
                    this.outputs = outputs;
                    return Promise.resolve();
                },
                end(success: boolean, time: number) {
                    this.success = success;
                    this.endedAt = time;
                }
            };
            controller.activeExecutions.push(execution);
            return execution;
        },
        dispose() {
            this.disposed = true;
        },
        disposed: false,
        activeExecutions: [] as any[]
    };
    createdControllers.push(controller);
    return controller;
}

export const notebooks = {
    createNotebookController
};

// Workspace mocking tracking
export const registeredSerializers = new Map<string, any>();
export function clearWorkspace() {
    registeredSerializers.clear();
}

export const workspace = {
    registerNotebookSerializer(viewType: string, serializer: any) {
        registeredSerializers.set(viewType, serializer);
        return { dispose() {} };
    }
};

// Window mocking tracking
export let mockShowInputBox: ((options?: any) => Promise<string | undefined>) | undefined = undefined;
export function setMockShowInputBox(fn: typeof mockShowInputBox) {
    mockShowInputBox = fn;
}

export const window = {
    showInputBox: async (options?: any) => {
        if (mockShowInputBox) {
            return mockShowInputBox(options);
        }
        return undefined;
    }
};

