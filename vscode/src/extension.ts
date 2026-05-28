import * as vscode from 'vscode';
import { GitShowDocumentProvider } from './git-provider.js';
import { WhereverWebviewProvider } from './webview-provider.js';

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Wherever Extension');
  outputChannel.appendLine('Wherever Companion VS Code Extension activating...');

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('Wherever Companion requires an open workspace to run.');
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  outputChannel.appendLine(`Bound to workspace: ${workspaceRoot}`);

  // Register Git Show HEAD provider for side-by-side diffs
  const gitShowProvider = new GitShowDocumentProvider(workspaceRoot);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('wherever-git-show', gitShowProvider)
  );

  // Initialize Webview Sidebar Provider
  const webviewProvider = new WhereverWebviewProvider(context.extensionUri, workspaceRoot);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WhereverWebviewProvider.viewType, webviewProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('wherever.reconnect', () => {
      // Re-trigger/reload the webview by calling its resolve method again (if supported)
      // Or we can post a message to tell the client to reconnect
      webviewProvider.postMessage({ type: 'reconnect' });
      vscode.window.showInformationMessage('Requested Wherever Sidebar Chat to reconnect.');
    })
  );

  outputChannel.appendLine('Wherever Companion Extension activated successfully!');
}

export function deactivate() {}