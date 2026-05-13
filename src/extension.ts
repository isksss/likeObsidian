import * as path from 'path';
import * as vscode from 'vscode';
import { registerAiCommands } from './ai/aiCommands';
import { VaultExplorer, VaultTreeItem } from './explorer/vaultExplorer';
import { FileWatchService } from './fileWatch/fileWatchService';
import { ObsidianConfig } from './obsidian/config';
import { joinRelative, normalizeRelativePath } from './pathUtils';
import { formatDate, TemplateEngine } from './templates/templateEngine';
import { VaultService } from './vault/vaultService';

export function activate(context: vscode.ExtensionContext): void {
  const vault = new VaultService();
  const explorer = new VaultExplorer(vault);
  const templates = new TemplateEngine();
  const watcher = new FileWatchService();

  context.subscriptions.push(
    vscode.window.createTreeView('likeObsidian.vaultExplorer', {
      treeDataProvider: explorer,
      dragAndDropController: explorer,
      canSelectMany: false
    }),
    watcher
  );

  const restartWatcher = async () => {
    const root = await vault.requireVaultUri().catch(() => undefined);
    watcher.start(root, () => explorer.refresh());
  };
  void restartWatcher();

  context.subscriptions.push(
    vscode.commands.registerCommand('likeObsidian.openVault', async () => {
      const folder = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Open Vault'
      });
      if (!folder?.[0]) {
        return;
      }
      await vscode.workspace.getConfiguration('obsidianVault').update('path', folder[0].fsPath, vscode.ConfigurationTarget.Workspace);
      await restartWatcher();
      explorer.refresh();
    }),
    vscode.commands.registerCommand('likeObsidian.refreshVault', () => explorer.refresh()),
    vscode.commands.registerCommand('likeObsidian.createNote', async () => {
      const uri = await createNote(vault, templates);
      if (uri) {
        explorer.refresh();
        await vscode.window.showTextDocument(uri);
      }
    }),
    vscode.commands.registerCommand('likeObsidian.newNoteInFolder', async (item?: VaultTreeItem) => {
      const folder = item?.entry.type === vscode.FileType.Directory
        ? item.entry.relativePath
        : await vault.resolveDefaultFolder();
      const uri = await createNote(vault, templates, folder);
      if (uri) {
        explorer.refresh();
        await vscode.window.showTextDocument(uri);
      }
    }),
    vscode.commands.registerCommand('likeObsidian.createDailyNote', async () => {
      const uri = await createDailyNote(vault, templates);
      if (uri) {
        explorer.refresh();
        await vscode.window.showTextDocument(uri);
      }
    }),
    vscode.commands.registerCommand('likeObsidian.newFolder', async (item?: VaultTreeItem) => {
      if (!item || item.entry.type !== vscode.FileType.Directory) {
        return;
      }
      const name = await vscode.window.showInputBox({ prompt: 'Folder name' });
      if (!name) {
        return;
      }
      await vault.createFolder(item.entry.uri, name);
      explorer.refresh();
    }),
    vscode.commands.registerCommand('likeObsidian.rename', async (item?: VaultTreeItem) => {
      if (!item) {
        return;
      }
      const name = await vscode.window.showInputBox({ prompt: 'New name', value: item.entry.name });
      if (!name || name === item.entry.name) {
        return;
      }
      await vault.rename(item.entry.uri, name);
      explorer.refresh();
    }),
    vscode.commands.registerCommand('likeObsidian.delete', async (item?: VaultTreeItem) => {
      if (!item) {
        return;
      }
      const confirmation = await vscode.window.showWarningMessage(`Delete ${item.entry.name}?`, { modal: true }, 'Delete');
      if (confirmation !== 'Delete') {
        return;
      }
      await vault.delete(item.entry.uri);
      explorer.refresh();
    }),
    vscode.commands.registerCommand('likeObsidian.revealInExplorer', async (item?: VaultTreeItem) => {
      if (item) {
        await vscode.commands.executeCommand('revealFileInOS', item.entry.uri);
      }
    })
  );

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('obsidianVault.path')) {
      void restartWatcher();
      explorer.refresh();
    }
  }));

  registerAiCommands(context, vault);
}

export function deactivate(): void {}

async function createNote(vault: VaultService, templates: TemplateEngine, initialFolder?: string): Promise<vscode.Uri | undefined> {
  const title = await vscode.window.showInputBox({ prompt: 'Note title' });
  if (!title) {
    return undefined;
  }

  const vaultUri = await vault.requireVaultUri();
  const obsidian = new ObsidianConfig(vaultUri);
  const templateConfig = await obsidian.templates();
  const template = await selectTemplate(vaultUri, templateConfig.folder);
  const raw = await templates.loadTemplate(vaultUri, template);
  const content = templates.expand(raw || `# {{title}}\n`, { title });
  const folder = initialFolder ?? await vault.resolveDefaultFolder();
  return vault.createNote(folder, title, content.endsWith('\n') ? content : `${content}\n`);
}

async function createDailyNote(vault: VaultService, templates: TemplateEngine): Promise<vscode.Uri | undefined> {
  const vaultUri = await vault.requireVaultUri();
  const obsidian = new ObsidianConfig(vaultUri);
  const daily = await obsidian.dailyNotes();
  const today = new Date();
  const relativePath = joinRelative(daily.folder, `${formatDate(today, daily.format)}.md`);
  const uri = vscode.Uri.joinPath(vaultUri, ...relativePath.split('/'));

  try {
    await vscode.workspace.fs.stat(uri);
    return uri;
  } catch {
    const raw = await templates.loadTemplate(vaultUri, daily.template);
    const title = path.basename(relativePath, '.md');
    const content = templates.expand(raw || `# ${title}\n`, { title, date: today });
    const dailyFolder = normalizeRelativePath(path.posix.dirname(relativePath));
    await vscode.workspace.fs.createDirectory(dailyFolder === '.'
      ? vaultUri
      : vscode.Uri.joinPath(vaultUri, ...dailyFolder.split('/')));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content.endsWith('\n') ? content : `${content}\n`, 'utf8'));
    return uri;
  }
}

async function selectTemplate(vaultUri: vscode.Uri, templateFolder: string): Promise<string | undefined> {
  const folder = normalizeRelativePath(templateFolder);
  if (!folder) {
    return undefined;
  }

  try {
    const templateDir = vscode.Uri.joinPath(vaultUri, ...folder.split('/'));
    const entries = await vscode.workspace.fs.readDirectory(templateDir);
    const templates = entries
      .filter(([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith('.md'))
      .map(([name]) => joinRelative(folder, name));

    if (templates.length === 0) {
      return undefined;
    }

    const picked = await vscode.window.showQuickPick(['No template', ...templates], { placeHolder: 'Template' });
    return picked && picked !== 'No template' ? picked : undefined;
  } catch {
    return undefined;
  }
}
