import * as fs from 'fs/promises';
import * as path from 'path';
import { Note } from '../model';
import { formatDate } from '../templates/templateEngine';
import { isMarkdownFile, joinRelative, normalizeRelativePath, titleToFileName } from '../pathUtils';

export type SearchResult = {
  path: string;
  snippet: string;
  relevance: number;
};

export type NodeVaultOptions = {
  root: string;
  allowedFolders?: string[];
  deniedFolders?: string[];
};

const EXCLUDED_PREFIXES = ['.obsidian/cache', '.trash'];
const DEFAULT_DENIED_FOLDERS = ['Secrets', 'Private'];

export class NodeVaultService {
  readonly root: string;
  private readonly allowedFolders: string[];
  private readonly deniedFolders: string[];

  constructor(options: NodeVaultOptions) {
    this.root = path.resolve(options.root);
    this.allowedFolders = (options.allowedFolders ?? []).map(normalizeRelativePath).filter(Boolean);
    this.deniedFolders = (options.deniedFolders ?? DEFAULT_DENIED_FOLDERS).map(normalizeRelativePath).filter(Boolean);
  }

  async listNotes(folder = ''): Promise<Note[]> {
    const relativeFolder = normalizeRelativePath(folder);
    if (relativeFolder) {
      this.assertAllowed(relativeFolder);
    }

    const start = this.resolveInsideVault(relativeFolder);
    const notes: Note[] = [];
    await this.walkMarkdown(start, notes);
    return notes.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readNote(relativePath: string): Promise<string> {
    const safePath = normalizeRelativePath(relativePath);
    this.assertAllowed(safePath);
    if (!isMarkdownFile(safePath)) {
      throw new Error(`Not a markdown note: ${safePath}`);
    }
    return fs.readFile(this.resolveInsideVault(safePath), 'utf8');
  }

  async getNoteMetadata(relativePath: string): Promise<Note> {
    const safePath = normalizeRelativePath(relativePath);
    this.assertAllowed(safePath);
    const absolute = this.resolveInsideVault(safePath);
    const body = await fs.readFile(absolute, 'utf8');
    const stat = await fs.stat(absolute);
    return toNote(safePath, body, stat.mtimeMs);
  }

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
      return [];
    }

    const results: SearchResult[] = [];
    for (const note of await this.listNotes()) {
      const body = await this.readNote(note.path);
      const searchable = `${note.path}\n${note.title}\n${note.tags.join(' ')}\n${note.links.join(' ')}\n${body}`.toLowerCase();
      const relevance = terms.reduce((score, term) => score + countOccurrences(searchable, term), 0);
      if (relevance > 0) {
        results.push({
          path: note.path,
          snippet: createSnippet(body, terms),
          relevance
        });
      }
    }

    return results.sort((a, b) => b.relevance - a.relevance).slice(0, Math.max(1, limit));
  }

  async createNote(input: {
    title: string;
    folder?: string;
    content?: string;
    template?: string;
  }): Promise<{ path: string; created: boolean }> {
    const title = input.title.trim();
    if (!title) {
      throw new Error('title is required.');
    }

    const folder = normalizeRelativePath(input.folder ?? '');
    const relativePath = joinRelative(folder, `${titleToFileName(title)}.md`);
    this.assertAllowed(relativePath);
    const absolute = this.resolveInsideVault(relativePath);

    await fs.mkdir(path.dirname(absolute), { recursive: true });

    try {
      await fs.stat(absolute);
      return { path: relativePath, created: false };
    } catch {
      const body = await this.expandCreateContent(input, title);
      await fs.writeFile(absolute, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
      return { path: relativePath, created: true };
    }
  }

  isAllowed(relativePath: string): boolean {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized || normalized === '.') {
      return true;
    }
    if (this.isExcluded(normalized) || normalized.startsWith('.env') || normalized.includes('/.env')) {
      return false;
    }
    if (this.deniedFolders.some((folder) => isPathInFolder(normalized, folder))) {
      return false;
    }
    return this.allowedFolders.length === 0 || this.allowedFolders.some((folder) => isPathInFolder(normalized, folder));
  }

  assertAllowed(relativePath: string): void {
    if (!this.isAllowed(relativePath)) {
      throw new Error(`MCP access denied: ${normalizeRelativePath(relativePath)}`);
    }
  }

  private async walkMarkdown(dir: string, out: Note[]): Promise<void> {
    let entries: Array<import('fs').Dirent>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = this.relativePath(absolute);
      if (this.isExcluded(relative) || !this.isAllowed(relative)) {
        continue;
      }
      if (entry.isDirectory()) {
        await this.walkMarkdown(absolute, out);
      } else if (entry.isFile() && isMarkdownFile(entry.name)) {
        const body = await fs.readFile(absolute, 'utf8');
        const stat = await fs.stat(absolute);
        out.push(toNote(relative, body, stat.mtimeMs));
      }
    }
  }

  private resolveInsideVault(relativePath: string): string {
    const normalized = normalizeRelativePath(relativePath);
    const resolved = path.resolve(this.root, normalized);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new Error(`Path escapes vault: ${relativePath}`);
    }
    return resolved;
  }

  private relativePath(absolutePath: string): string {
    return normalizeRelativePath(path.relative(this.root, absolutePath));
  }

  private isExcluded(relativePath: string): boolean {
    const normalized = normalizeRelativePath(relativePath);
    return EXCLUDED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
  }

  private async expandCreateContent(input: { content?: string; template?: string }, title: string): Promise<string> {
    const template = input.template ? await this.readNote(input.template) : undefined;
    const source = input.content ?? template ?? '# {{title}}\n';
    return source
      .replaceAll('{{title}}', title)
      .replaceAll('{{date}}', formatDate(new Date(), 'YYYY-MM-DD'))
      .replaceAll('{{time}}', formatDate(new Date(), 'HH:mm'));
  }
}

function toNote(relativePath: string, body: string, modifiedAt: number): Note {
  return {
    path: relativePath,
    title: path.basename(relativePath, path.extname(relativePath)),
    tags: extractTags(body),
    links: extractWikiLinks(body),
    modifiedAt
  };
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

  return [...tags].sort();
}

function extractWikiLinks(body: string): string[] {
  return [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map((match) => match[1]).sort();
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

function isPathInFolder(relativePath: string, folder: string): boolean {
  const normalizedFolder = normalizeRelativePath(folder);
  return relativePath === normalizedFolder || relativePath.startsWith(`${normalizedFolder}/`);
}
