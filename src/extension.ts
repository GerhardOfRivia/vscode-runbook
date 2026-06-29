import * as vscode from 'vscode';
import { RunbookSerializer } from './notebookSerializer';
import { RunbookController } from './notebookController';

export function activate(context: vscode.ExtensionContext) {
    // Register the notebook serializers
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            'shbn',
            new RunbookSerializer('bash')
        )
    );
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            'psnb',
            new RunbookSerializer('pwsh')
        )
    );

    // Initialize and register the notebook controllers
    const shbnController = new RunbookController(
        'shbn-notebook-controller',
        'shbn',
        'Shell Runbook'
    );
    const psnbController = new RunbookController(
        'psnb-notebook-controller',
        'psnb',
        'PowerShell Runbook'
    );
    context.subscriptions.push(shbnController, psnbController);
}

export function deactivate() { }
