import * as path from 'path';

export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function isMarkdownFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

export function titleToFileName(title: string): string {
  return title
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

export function joinRelative(...segments: string[]): string {
  return normalizeRelativePath(path.posix.join(...segments.filter(Boolean).map(normalizeRelativePath)));
}
