import * as path from 'path';
import * as vscode from 'vscode';
import { Note, Vault, VaultEntry } from '../model';
import { joinRelative, normalizeRelativePath, titleToFileName, isMarkdownFile } from '../pathUtils';

const EXCLUDED_PREFIXES = ['.obsidian/cache', '.trash'];
const EXCLUDED_NAMES = new Set(['.trash']);

export class VaultService {
  async resolveVault(): Promise<Vault | undefined> {
    const configured = vscode.workspace.getConfiguration('obsidianVault').get<string>('path', '').trim();
    const vaultUri = configured
      ? vscode.Uri.file(configured)
      : vscode.workspace.workspaceFolders?.[0]?.uri;

    if (!vaultUri) {
      return undefined;
    }

    return {
      path: vaultUri.fsPath,
      name: path.basename(vaultUri.fsPath)
    };
  }

  async requireVaultUri(): Promise<vscode.Uri> {
    const vault = await this.resolveVault();
    if (!vault) {
      throw new Error('Open a workspace folder or configure obsidianVault.path.');
    }
    return vscode.Uri.file(vault.path);
  }

  async listChildren(parent?: vscode.Uri): Promise<VaultEntry[]> {
    const vaultUri = await this.requireVaultUri();
    const dir = parent ?? vaultUri;
    const entries = await vscode.workspace.fs.readDirectory(dir);

    return entries
      .filter(([name, type]) => this.shouldShow(name, type))
      .map(([name, type]) => {
        const uri = vscode.Uri.joinPath(dir, name);
        return {
          uri,
          name,
          relativePath: this.relativePath(uri, vaultUri),
          type
        };
      })
      .filter((entry) => entry.type === vscode.FileType.Directory || isMarkdownFile(entry.name))
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === vscode.FileType.Directory ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
  }

  async listNotes(): Promise<Note[]> {
    const vaultUri = await this.requireVaultUri();
    const out: Note[] = [];
    await this.walkMarkdown(vaultUri, out);
    return out;
  }

  async readNote(relativePath: string): Promise<string> {
    const vaultUri = await this.requireVaultUri();
    const safePath = normalizeRelativePath(relativePath);
    this.assertAiAllowed(safePath);
    const uri = vscode.Uri.joinPath(vaultUri, ...safePath.split('/'));
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File || !isMarkdownFile(uri.path)) {
      throw new Error(`Not a markdown note: ${safePath}`);
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  }

  async search(query: string, limit = 20): Promise<Array<{ path: string; snippet: string; relevance: number }>> {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    const notes = await this.listNotes();
    const results: Array<{ path: string; snippet: string; relevance: number }> = [];

    for (const note of notes) {
      if (!this.isAiAllowed(note.path)) {
        continue;
      }
      const body = await this.readNote(note.path);
      const searchable = `${note.path}\n${note.title}\n${note.tags.join(' ')}\n${body}`.toLowerCase();
      const relevance = terms.reduce((score, term) => score + countOccurrences(searchable, term), 0);
      if (relevance > 0) {
        results.push({
          path: note.path,
          snippet: createSnippet(body, terms),
          relevance
        });
      }
    }

    return results.sort((a, b) => b.relevance - a.relevance).slice(0, limit);
  }

  async createNote(relativeFolder: string, title: string, content: string): Promise<vscode.Uri> {
    const vaultUri = await this.requireVaultUri();
    const fileName = `${titleToFileName(title)}.md`;
    const folder = normalizeRelativePath(relativeFolder);
    const uri = vscode.Uri.joinPath(vaultUri, ...joinRelative(folder, fileName).split('/'));
    await ensureDirectory(parentUri(uri));
    await this.writeNewFile(uri, content);
    return uri;
  }

  async createFolder(parent: vscode.Uri, name: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.joinPath(parent, titleToFileName(name));
    await vscode.workspace.fs.createDirectory(uri);
    return uri;
  }

  async rename(uri: vscode.Uri, newName: string): Promise<vscode.Uri> {
    const currentExt = path.extname(uri.fsPath);
    const requestedExt = path.extname(newName);
    const shouldPreserveMarkdownExt = isMarkdownFile(path.basename(uri.fsPath)) && !requestedExt && currentExt;
    const nextName = shouldPreserveMarkdownExt ? `${newName}${currentExt}` : newName;
    const target = vscode.Uri.joinPath(parentUri(uri), titleToFileName(nextName));
    await vscode.workspace.fs.rename(uri, target, { overwrite: false });
    return target;
  }

  async delete(uri: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
  }

  async move(source: vscode.Uri, targetFolder: vscode.Uri): Promise<vscode.Uri> {
    const target = vscode.Uri.joinPath(targetFolder, path.basename(source.fsPath));
    await vscode.workspace.fs.rename(source, target, { overwrite: false });
    return target;
  }

  async resolveDefaultFolder(): Promise<string> {
    const configured = vscode.workspace.getConfiguration('obsidianVault').get<string>('defaultFolder', '').trim();
    if (configured) {
      return normalizeRelativePath(configured);
    }

    const vaultUri = await this.requireVaultUri();
    for (const candidate of ['Inbox', 'Notes']) {
      try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(vaultUri, candidate));
        if (stat.type === vscode.FileType.Directory) {
          return candidate;
        }
      } catch {
        // Try next fallback.
      }
    }
    return '';
  }

  relativePath(uri: vscode.Uri, vaultUri?: vscode.Uri): string {
    const base = vaultUri?.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    return normalizeRelativePath(path.relative(base, uri.fsPath));
  }

  isExcluded(relativePath: string): boolean {
    const normalized = normalizeRelativePath(relativePath);
    return EXCLUDED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  }

  isAiAllowed(relativePath: string): boolean {
    const normalized = normalizeRelativePath(relativePath);
    if (this.isExcluded(normalized) || normalized.startsWith('.env') || normalized.includes('/.env')) {
      return false;
    }

    const config = vscode.workspace.getConfiguration('obsidianVault.ai');
    const denied = config.get<string[]>('deniedFolders', ['Secrets', 'Private']).map(normalizeRelativePath);
    if (denied.some((folder) => normalized === folder || normalized.startsWith(`${folder}/`))) {
      return false;
    }

    const allowed = config.get<string[]>('allowedFolders', []).map(normalizeRelativePath).filter(Boolean);
    return allowed.length === 0 || allowed.some((folder) => normalized === folder || normalized.startsWith(`${folder}/`));
  }

  assertAiAllowed(relativePath: string): void {
    if (!this.isAiAllowed(relativePath)) {
      throw new Error(`AI access denied: ${relativePath}`);
    }
  }

  private shouldShow(name: string, type: vscode.FileType): boolean {
    if (EXCLUDED_NAMES.has(name)) {
      return false;
    }
    if (name === '.obsidian') {
      return type === vscode.FileType.Directory;
    }
    return type === vscode.FileType.Directory || isMarkdownFile(name);
  }

  private async walkMarkdown(dir: vscode.Uri, out: Note[]): Promise<void> {
    const vaultUri = await this.requireVaultUri();
    const entries = await vscode.workspace.fs.readDirectory(dir);
    for (const [name, type] of entries) {
      const uri = vscode.Uri.joinPath(dir, name);
      const relative = this.relativePath(uri, vaultUri);
      if (this.isExcluded(relative)) {
        continue;
      }
      if (type === vscode.FileType.Directory) {
        await this.walkMarkdown(uri, out);
      } else if (isMarkdownFile(name)) {
        const stat = await vscode.workspace.fs.stat(uri);
        const bytes = await vscode.workspace.fs.readFile(uri);
        const body = Buffer.from(bytes).toString('utf8');
        out.push({
          path: relative,
          title: path.basename(name, path.extname(name)),
          tags: extractTags(body),
          links: extractWikiLinks(body),
          modifiedAt: stat.mtime
        });
      }
    }
  }

  private async writeNewFile(uri: vscode.Uri, content: string): Promise<void> {
    try {
      await vscode.workspace.fs.stat(uri);
      throw new Error(`Note already exists: ${uri.fsPath}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Note already exists')) {
        throw error;
      }
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    }
  }
}

async function ensureDirectory(uri: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(uri);
}

function parentUri(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.file(path.dirname(uri.fsPath));
}

function extractTags(body: string): string[] {
  const tags = new Set<string>();
  for (const match of body.matchAll(/(^|\s)#([A-Za-z0-9_/-]+)/g)) {
    tags.add(match[2]);
  }

  const frontmatter = body.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatter) {
    for (const match of frontmatter[1].matchAll(/tags:\s*(.*)/g)) {
      match[1].split(/[\s,\[\]]+/).filter(Boolean).forEach((tag) => tags.add(tag.replace(/^#/, '')));
    }
  }

  return [...tags];
}

function extractWikiLinks(body: string): string[] {
  return [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((match) => match[1]);
}

function countOccurrences(value: string, term: string): number {
  let count = 0;
  let index = value.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = value.indexOf(term, index + term.length);
  }
  return count;
}

function createSnippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  const first = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - 80);
  const end = Math.min(body.length, first + 180);
  return body.slice(start, end).replace(/\s+/g, ' ').trim();
}
