#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { NodeVaultService } from './nodeVault';

export function createLikeObsidianMcpServer(vault: NodeVaultService): McpServer {
  const server = new McpServer({
    name: 'like-obsidian',
    version: '0.0.1'
  });

  server.registerTool('list_notes', {
    title: 'List Notes',
    description: 'List markdown notes in the Obsidian vault.',
    inputSchema: {
      folder: z.string().optional().describe('Optional vault-relative folder to list.')
    }
  }, async ({ folder }) => {
    const notes = await vault.listNotes(folder);
    return jsonResult(notes);
  });

  server.registerTool('read_note', {
    title: 'Read Note',
    description: 'Read one markdown note by vault-relative path.',
    inputSchema: {
      path: z.string().describe('Vault-relative markdown note path.')
    }
  }, async ({ path }) => {
    const text = await vault.readNote(path);
    return {
      content: [{ type: 'text', text }]
    };
  });

  server.registerTool('get_note_metadata', {
    title: 'Get Note Metadata',
    description: 'Read note metadata such as title, tags, wikilinks, and modified time.',
    inputSchema: {
      path: z.string().describe('Vault-relative markdown note path.')
    }
  }, async ({ path }) => {
    const metadata = await vault.getNoteMetadata(path);
    return jsonResult(metadata);
  });

  server.registerTool('search_notes', {
    title: 'Search Notes',
    description: 'Keyword-search markdown body, frontmatter, tags, wikilinks, and filenames.',
    inputSchema: {
      query: z.string().min(1).describe('Search query. Space-separated terms are all scored.'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of results.')
    }
  }, async ({ query, limit }) => {
    const results = await vault.search(query, limit);
    return jsonResult(results);
  });

  server.registerTool('create_note', {
    title: 'Create Note',
    description: 'Create a markdown note with optional content or template expansion.',
    inputSchema: {
      title: z.string().min(1).describe('Note title. It is converted to a safe markdown filename.'),
      folder: z.string().optional().describe('Vault-relative destination folder.'),
      content: z.string().optional().describe('Markdown content. Supports {{title}}, {{date}}, and {{time}}.'),
      template: z.string().optional().describe('Vault-relative markdown template path.')
    }
  }, async (input) => {
    const result = await vault.createNote(input);
    return jsonResult(result);
  });

  return server;
}

async function main(): Promise<void> {
  const vaultPath = resolveVaultPath(process.argv.slice(2));
  const vault = new NodeVaultService({
    root: vaultPath,
    allowedFolders: readCsvEnv('OBSIDIAN_VAULT_AI_ALLOWED_FOLDERS'),
    deniedFolders: readCsvEnv('OBSIDIAN_VAULT_AI_DENIED_FOLDERS')
  });

  const server = createLikeObsidianMcpServer(vault);
  await server.connect(new StdioServerTransport());
}

function resolveVaultPath(args: string[]): string {
  const vaultIndex = args.indexOf('--vault');
  const fromArg = vaultIndex >= 0 ? args[vaultIndex + 1] : undefined;
  const value = fromArg || process.env.OBSIDIAN_VAULT_PATH || process.cwd();
  return value;
}

function readCsvEnv(name: string): string[] | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function jsonResult(value: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const structuredContent = Array.isArray(value) ? { items: value } : value as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent
  };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
