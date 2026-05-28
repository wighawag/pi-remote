import * as vscode from 'vscode';
import { exec } from 'child_process';

export class GitShowDocumentProvider implements vscode.TextDocumentContentProvider {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const relativePath = uri.path; // URI is structured as wherever-git-show:path/to/file
    return new Promise((resolve) => {
      exec(`git show HEAD:"${relativePath}"`, { cwd: this.workspaceRoot }, (err, stdout) => {
        if (err) {
          // Fall back to empty string if file is untracked/new
          resolve('');
        } else {
          resolve(stdout);
        }
      });
    });
  }
}