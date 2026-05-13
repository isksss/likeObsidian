import * as vscode from 'vscode';
import { VaultService } from '../vault/vaultService';

export function registerAiCommands(context: vscode.ExtensionContext, vault: VaultService): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('obsidianVault.listNotes', async () => {
      const notes = await vault.listNotes();
      return notes.filter((note) => vault.isAiAllowed(note.path));
    }),
    vscode.commands.registerCommand('obsidianVault.readNote', async (relativePath?: string) => {
      const path = relativePath ?? await vscode.window.showInputBox({ prompt: 'Note path' });
      if (!path) {
        return undefined;
      }
      return vault.readNote(path);
    }),
    vscode.commands.registerCommand('obsidianVault.search', async (query?: string, limit?: number) => {
      const value = query ?? await vscode.window.showInputBox({ prompt: 'Search vault notes' });
      if (!value) {
        return [];
      }
      return vault.search(value, limit);
    })
  );
}
