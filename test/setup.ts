import Module from 'module';
import * as vscodeMock from './vscodeMock';

// Override the module loader so that import/require 'vscode' returns our mock
const originalLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
    if (request === 'vscode') {
        return vscodeMock;
    }
    return originalLoad.apply(this, arguments);
};
