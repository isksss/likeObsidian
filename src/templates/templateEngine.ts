import type * as vscode from 'vscode';

export class TemplateEngine {
  async loadTemplate(vaultUri: vscode.Uri, relativePath?: string): Promise<string> {
    if (!relativePath) {
      return '';
    }

    try {
      const vscodeApi = await import('vscode');
      const uri = vscodeApi.Uri.joinPath(vaultUri, ...relativePath.split('/'));
      const bytes = await vscodeApi.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return '';
    }
  }

  expand(template: string, variables: { title?: string; date?: Date } = {}): string {
    const date = variables.date ?? new Date();
    return template
      .replaceAll('{{title}}', variables.title ?? '')
      .replaceAll('{{date}}', formatDate(date, 'YYYY-MM-DD'))
      .replaceAll('{{time}}', formatDate(date, 'HH:mm'));
  }
}

export function formatDate(date: Date, format: string): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return format
    .replaceAll('YYYY', year)
    .replaceAll('MM', month)
    .replaceAll('DD', day)
    .replaceAll('HH', hours)
    .replaceAll('mm', minutes);
}
