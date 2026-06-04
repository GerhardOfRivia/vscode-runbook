import * as vscode from 'vscode';
import { ShbnSerializer } from './notebookSerializer';
import { ShbnController } from './notebookController';

export function activate(context: vscode.ExtensionContext) {
    // Register the notebook serializer
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            'shbn',
            new ShbnSerializer()
        )
    );

    // Initialize and register the notebook controller
    const controller = new ShbnController();
    context.subscriptions.push(controller);
}

export function deactivate() {}
