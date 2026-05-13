import * as path from 'path';
import * as vscode from 'vscode';
import { VaultEntry } from '../model';
import { VaultService } from '../vault/vaultService';

export class VaultTreeItem extends vscode.TreeItem {
  constructor(readonly entry: VaultEntry) {
    super(
      entry.name,
      entry.type === vscode.FileType.Directory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.resourceUri = entry.uri;
    this.contextValue = entry.type === vscode.FileType.Directory ? 'folder' : 'note';
    this.tooltip = entry.relativePath;
    if (entry.type === vscode.FileType.File) {
      this.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [entry.uri]
      };
    }
    this.iconPath = entry.type === vscode.FileType.Directory
      ? new vscode.ThemeIcon('folder')
      : new vscode.ThemeIcon('markdown');
  }
}

export class VaultExplorer implements vscode.TreeDataProvider<VaultTreeItem>, vscode.TreeDragAndDropController<VaultTreeItem> {
  readonly dropMimeTypes = ['application/vnd.code.tree.likeObsidian.vaultExplorer'];
  readonly dragMimeTypes = ['text/uri-list'];
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<VaultTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly vault: VaultService) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: VaultTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: VaultTreeItem): Promise<VaultTreeItem[]> {
    try {
      const entries = await this.vault.listChildren(element?.entry.uri);
      return entries.map((entry) => new VaultTreeItem(entry));
    } catch (error) {
      void vscode.window.showWarningMessage(error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  async handleDrag(source: readonly VaultTreeItem[], dataTransfer: vscode.DataTransfer): Promise<void> {
    const uris = source.map((item) => item.entry.uri.toString()).join('\n');
    dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uris));
  }

  async handleDrop(target: VaultTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    if (!target || target.entry.type !== vscode.FileType.Directory) {
      return;
    }

    const item = dataTransfer.get('text/uri-list');
    const value = item?.value as string | undefined;
    if (!value) {
      return;
    }

    for (const line of value.split(/\r?\n/).filter(Boolean)) {
      const source = vscode.Uri.parse(line);
      if (path.dirname(source.fsPath) !== target.entry.uri.fsPath) {
        await this.vault.move(source, target.entry.uri);
      }
    }
    this.refresh();
  }
}
