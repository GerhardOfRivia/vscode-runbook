import * as vscode from 'vscode';
import { ShbnSerializer } from './notebookSerializer';
import { ShbnController } from './notebookController';

export function activate(context: vscode.ExtensionContext) {
    // Register the notebook serializers
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            'shbn',
            new ShbnSerializer('bash')
        )
    );
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            'psnb',
            new ShbnSerializer('pwsh')
        )
    );

    // Initialize and register the notebook controllers
    const shbnController = new ShbnController(
        'shbn-notebook-controller',
        'shbn',
        'Runbook Shell Notebook'
    );
    const psnbController = new ShbnController(
        'psnb-notebook-controller',
        'psnb',
        'Runbook PowerShell Notebook'
    );
    context.subscriptions.push(shbnController, psnbController);
}

export function deactivate() { }
