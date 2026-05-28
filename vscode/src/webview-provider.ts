import * as vscode from 'vscode';
import * as path from 'path';

export class WhereverWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'wherever.chatView';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceRoot: string
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'openFile': {
          try {
            const fullPath = path.resolve(this.workspaceRoot, message.filePath);
            const uri = vscode.Uri.file(fullPath);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to open file: ${err.message}`);
          }
          break;
        }
        case 'openDiff': {
          try {
            const fullPath = path.resolve(this.workspaceRoot, message.filePath);
            const relativePath = path.relative(this.workspaceRoot, fullPath);

            const originalUri = vscode.Uri.parse(`wherever-git-show:${relativePath}`);
            const modifiedUri = vscode.Uri.file(fullPath);

            await vscode.commands.executeCommand(
              'vscode.diff',
              originalUri,
              modifiedUri,
              `${path.basename(fullPath)} (HEAD ↔ Edited)`
            );
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to open diff: ${err.message}`);
          }
          break;
        }
      }
    });
  }

  public postMessage(message: any): void {
    this._view?.webview.postMessage(message);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js')
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css')
    );

    const config = vscode.workspace.getConfiguration('wherever');
    const host = config.get<string>('host') || 'localhost';
    const port = config.get<number>('port') || 31416;
    const token = config.get<string>('token') || '';
    const secure = config.get<boolean>('secure') ?? false;

    const webviewConfig = {
      host,
      port,
      token,
      secure,
      workspaceRoot: this.workspaceRoot
    };

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-eval'; connect-src ws://127.0.0.1:* ws://localhost:* wss://127.0.0.1:* wss://localhost:* http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*; img-src ${webview.cspSource} data:;">
        <link rel="stylesheet" href="${cssUri}">
        <style>
          body {
            padding: 10px;
            background-color: var(--vscode-sideBar-background);
            color: var(--vscode-sideBar-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            margin: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          #app {
            display: flex;
            flex-direction: column;
            flex: 1;
            height: 100%;
            overflow: hidden;
          }
        </style>
      </head>
      <body>
        <div id="app"></div>
        <script>
          window.WHEREVER_VSCODE_CONFIG = ${JSON.stringify(webviewConfig)};
        </script>
        <script src="${jsUri}"></script>
      </body>
      </html>
    `;
  }
}