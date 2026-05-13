import { describe, expect, it } from 'vitest';
import { formatDate, TemplateEngine } from '../src/templates/templateEngine';

describe('TemplateEngine', () => {
  it('expands MVP variables', () => {
    const engine = new TemplateEngine();
    const date = new Date(2026, 4, 13, 9, 8);

    expect(engine.expand('# {{title}} {{date}} {{time}}', { title: 'Daily', date }))
      .toBe('# Daily 2026-05-13 09:08');
  });

  it('formats supported Obsidian daily note patterns', () => {
    const date = new Date(2026, 4, 13, 9, 8);

    expect(formatDate(date, 'YYYY-MM-DD')).toBe('2026-05-13');
    expect(formatDate(date, 'YYYY_MM_DD')).toBe('2026_05_13');
    expect(formatDate(date, 'YYYY/MM/YYYY-MM-DD')).toBe('2026/05/2026-05-13');
  });
});
