import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeVaultService } from '../src/mcp/nodeVault';

describe('NodeVaultService', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'like-obsidian-test-'));
    await fs.mkdir(path.join(root, 'Daily'), { recursive: true });
    await fs.mkdir(path.join(root, 'Projects'), { recursive: true });
    await fs.mkdir(path.join(root, 'Templates'), { recursive: true });
    await fs.mkdir(path.join(root, 'Secrets'), { recursive: true });
    await fs.mkdir(path.join(root, '.obsidian', 'cache'), { recursive: true });

    await fs.writeFile(path.join(root, 'Daily', '2026-05-13.md'), [
      '---',
      'tags: [daily, react]',
      '---',
      '# Daily',
      'React Query memo with [[Auth Design]].'
    ].join('\n'));
    await fs.writeFile(path.join(root, 'Projects', 'Auth.md'), '# Auth\n認証設計 #security');
    await fs.writeFile(path.join(root, 'Templates', 'daily.md'), '# {{title}}\n{{date}} {{time}}');
    await fs.writeFile(path.join(root, 'Secrets', 'token.md'), 'secret');
    await fs.writeFile(path.join(root, '.obsidian', 'cache', 'ignored.md'), 'ignored');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('lists markdown notes with metadata and excludes denied/cache paths', async () => {
    const vault = new NodeVaultService({ root });

    const notes = await vault.listNotes();

    expect(notes.map((note) => note.path)).toEqual([
      'Daily/2026-05-13.md',
      'Projects/Auth.md',
      'Templates/daily.md'
    ]);
    expect(notes[0].tags).toContain('daily');
    expect(notes[0].links).toEqual(['Auth Design']);
  });

  it('searches body, tags, links, and filenames', async () => {
    const vault = new NodeVaultService({ root });

    const results = await vault.search('React Auth', 5);

    expect(results[0].path).toBe('Daily/2026-05-13.md');
    expect(results[0].snippet).toContain('React Query');
  });

  it('enforces allowed and denied folders', async () => {
    const vault = new NodeVaultService({
      root,
      allowedFolders: ['Daily'],
      deniedFolders: ['Secrets']
    });

    await expect(vault.readNote('Daily/2026-05-13.md')).resolves.toContain('React Query');
    await expect(vault.readNote('Projects/Auth.md')).rejects.toThrow('MCP access denied');
    await expect(vault.readNote('Secrets/token.md')).rejects.toThrow('MCP access denied');
  });

  it('creates notes with template variables without overwriting existing files', async () => {
    const vault = new NodeVaultService({ root, allowedFolders: ['Daily', 'Templates'] });

    const first = await vault.createNote({
      title: 'Review Result',
      folder: 'Daily',
      template: 'Templates/daily.md'
    });
    const second = await vault.createNote({
      title: 'Review Result',
      folder: 'Daily',
      content: 'should not overwrite'
    });

    expect(first).toEqual({ path: 'Daily/Review Result.md', created: true });
    expect(second).toEqual({ path: 'Daily/Review Result.md', created: false });
    await expect(vault.readNote('Daily/Review Result.md')).resolves.toContain('# Review Result');
  });

  it('rejects path traversal', async () => {
    const vault = new NodeVaultService({ root });

    await expect(vault.readNote('../outside.md')).rejects.toThrow('Path escapes vault');
  });
});
