import * as vscode from 'vscode';

export class FileWatchService implements vscode.Disposable {
  private watcher?: vscode.FileSystemWatcher;
  private timeout?: NodeJS.Timeout;

  start(root: vscode.Uri | undefined, onChange: () => void): void {
    this.dispose();
    const pattern = root
      ? new vscode.RelativePattern(root.fsPath, '**/*.{md,markdown}')
      : '**/*.{md,markdown}';
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const refresh = () => {
      if (this.timeout) {
        clearTimeout(this.timeout);
      }
      this.timeout = setTimeout(onChange, 150);
    };
    this.watcher.onDidCreate(refresh);
    this.watcher.onDidChange(refresh);
    this.watcher.onDidDelete(refresh);
  }

  dispose(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    this.watcher?.dispose();
    this.watcher = undefined;
  }
}
