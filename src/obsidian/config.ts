import * as vscode from 'vscode';
import { ObsidianDailyNotesConfig, ObsidianTemplatesConfig } from '../model';

export class ObsidianConfig {
  constructor(private readonly vaultUri: vscode.Uri) {}

  async dailyNotes(): Promise<ObsidianDailyNotesConfig> {
    const parsed = await this.readJson<Record<string, unknown>>('daily-notes.json');
    return {
      folder: readString(parsed.folder, 'Daily'),
      format: readString(parsed.format, 'YYYY-MM-DD'),
      template: readOptionalString(parsed.template)
    };
  }

  async templates(): Promise<ObsidianTemplatesConfig> {
    const parsed = await this.readJson<Record<string, unknown>>('templates.json');
    return {
      folder: readString(parsed.folder, 'Templates')
    };
  }

  private async readJson<T extends object>(fileName: string): Promise<T> {
    try {
      const uri = vscode.Uri.joinPath(this.vaultUri, '.obsidian', fileName);
      const bytes = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
    } catch {
      return {} as T;
    }
  }
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
