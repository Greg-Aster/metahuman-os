/**
 * User Guide API Handlers
 *
 * Unified handlers for serving user guide documentation.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, notFoundResponse, errorResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Cache for parsed chapters (5 minute TTL)
let chaptersCache: {
  categories: Category[];
  chapters: Chapter[];
  timestamp: number;
} | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface Chapter {
  id: string;
  title: string;
  content: string;
  number: string;
  category: string;
  path: string;
}

interface Category {
  id: string;
  name: string;
  chapters: Chapter[];
  order: number;
}

// Category display names and order
const categoryConfig: Record<string, { name: string; order: number }> = {
  root: { name: 'Main Guide', order: 0 },
  'getting-started': { name: 'Getting Started', order: 1 },
  'using-metahuman': { name: 'Using MetaHuman', order: 2 },
  'training-personalization': { name: 'Training & Personalization', order: 3 },
  'advanced-features': { name: 'Advanced Features', order: 4 },
  'configuration-admin': { name: 'Configuration & Admin', order: 5 },
  reference: { name: 'Reference', order: 6 },
  appendix: { name: 'Appendix', order: 7 },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(markdown: string): string {
  const codeSpans: string[] = [];
  const links: string[] = [];
  let html = markdown.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const marker = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return marker;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    const normalizedHref = href.trim();
    if (!/^(?:https?:\/\/|mailto:|\/|#)/i.test(normalizedHref)) {
      return label;
    }
    const marker = `\u0000LINK${links.length}\u0000`;
    links.push(`<a href="${escapeHtml(normalizedHref)}">${escapeHtml(label)}</a>`);
    return marker;
  });

  html = escapeHtml(html);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  for (let index = 0; index < links.length; index += 1) {
    html = html.replace(`\u0000LINK${index}\u0000`, links[index]);
  }
  for (let index = 0; index < codeSpans.length; index += 1) {
    html = html.replace(`\u0000CODE${index}\u0000`, codeSpans[index]);
  }

  return html;
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Convert the maintained guide's Markdown subset to safe HTML without adding a
 * second documentation pipeline or a runtime dependency.
 */
export function parseMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    const items = listItems.map((item) => `<li>${renderInline(item)}</li>`).join('');
    output.push(`<${listType}>${items}</${listType}>`);
    listType = null;
    listItems = [];
  };

  const flushBlocks = () => {
    flushParagraph();
    flushList();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const fence = trimmed.match(/^```([A-Za-z0-9_-]*)\s*$/);

    if (fence) {
      flushBlocks();
      const language = fence[1] || 'text';
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        code.push(lines[index]);
        index += 1;
      }
      output.push(`<pre><code class="language-${language}">${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (!trimmed) {
      flushBlocks();
      continue;
    }

    const unorderedItem = line.match(/^\s*[-*]\s+(.*)$/);
    const orderedItem = line.match(/^\s*\d+\.\s+(.*)$/);
    if (unorderedItem || orderedItem) {
      flushParagraph();
      const nextType: 'ul' | 'ol' = unorderedItem ? 'ul' : 'ol';
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((unorderedItem?.[1] || orderedItem?.[1] || '').trim());
      continue;
    }

    if (listType && /^\s{2,}\S/.test(line)) {
      listItems[listItems.length - 1] += ` ${trimmed}`;
      continue;
    }

    flushList();

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      output.push('<hr>');
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushParagraph();
      output.push(`<blockquote>${renderInline(trimmed.replace(/^>\s?/, ''))}</blockquote>`);
      continue;
    }

    const nextLine = lines[index + 1]?.trim() || '';
    if (/^\|.*\|$/.test(trimmed) && /^\|?\s*:?-{3,}/.test(nextLine)) {
      flushParagraph();
      const headers = parseTableRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && /^\|.*\|$/.test(lines[index].trim())) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      const headerHtml = headers.map((cell) => `<th>${renderInline(cell)}</th>`).join('');
      const bodyHtml = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
        .join('');
      output.push(`<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushBlocks();
  return output.join('\n');
}

/**
 * Read markdown files recursively from a directory
 */
function readMarkdownFiles(dir: string, relativeDirPath: string = ''): Chapter[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const items = fs.readdirSync(dir, { withFileTypes: true });
  const result: Chapter[] = [];

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      const newRelativePath = relativeDirPath ? path.join(relativeDirPath, item.name) : item.name;
      result.push(...readMarkdownFiles(fullPath, newRelativePath));
    } else if (item.isFile() && item.name.endsWith('.md') && item.name !== 'index.md') {
      const rawContent = fs.readFileSync(fullPath, 'utf-8');
      const parsedContent = parseMarkdown(rawContent);

      // Extract number from filename (e.g., "01-overview.md" -> "01")
      const numberMatch = item.name.match(/^(\d+)-/);
      const number = numberMatch ? numberMatch[1] : '';

      // Prefer the maintained chapter heading; fall back to the filename for
      // malformed or legacy documents.
      const filename = item.name.replace('.md', '');
      const title = rawContent.match(/^#\s+(.+)$/m)?.[1].trim()
        || filename
          .replace(/^\d+-/, '')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());

      // Determine category from directory path
      let category = 'root';
      if (relativeDirPath) {
        const parts = relativeDirPath.split(path.sep);
        category = parts[0];
      }

      const itemRelativePath = relativeDirPath ? path.join(relativeDirPath, item.name) : item.name;

      result.push({
        id: filename,
        title,
        content: parsedContent,
        number,
        category,
        path: itemRelativePath,
      });
    }
  }

  return result;
}

/**
 * Load and parse all user guide chapters
 */
function loadChapters(): { categories: Category[]; chapters: Chapter[] } {
  // Check cache
  if (chaptersCache && Date.now() - chaptersCache.timestamp < CACHE_TTL) {
    return chaptersCache;
  }

  const userGuidePath = path.join(systemPaths.root, 'docs', 'user-guide');

  // Read all chapters
  const chapters = readMarkdownFiles(userGuidePath).sort((a, b) => {
    const categoryDifference = (categoryConfig[a.category]?.order ?? 99)
      - (categoryConfig[b.category]?.order ?? 99);
    if (categoryDifference !== 0) return categoryDifference;
    if (a.number && b.number) {
      return parseInt(a.number) - parseInt(b.number);
    }
    if (a.number) return -1;
    if (b.number) return 1;
    return a.title.localeCompare(b.title);
  });

  // Group chapters by category
  const categoryMap = new Map<string, Chapter[]>();

  chapters.forEach((chapter) => {
    const categoryId = chapter.category;
    if (!categoryMap.has(categoryId)) {
      categoryMap.set(categoryId, []);
    }
    categoryMap.get(categoryId)!.push(chapter);
  });

  // Convert to sorted array of categories
  const categories = Array.from(categoryMap.entries())
    .map(([id, chapterList]) => ({
      id,
      name: categoryConfig[id]?.name || id.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
      chapters: chapterList,
      order: categoryConfig[id]?.order ?? 99,
    }))
    .sort((a, b) => a.order - b.order);

  // Update cache
  chaptersCache = { categories, chapters, timestamp: Date.now() };

  return { categories, chapters };
}

/**
 * GET /api/user-guide - List all chapters grouped by category
 *
 * Response:
 * {
 *   categories: [{ id, name, chapters: [{ id, title, number, category }], order }],
 *   totalChapters: number
 * }
 */
export async function handleListUserGuide(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { categories, chapters } = loadChapters();

    // Return without content for listing (smaller response)
    const categoriesWithoutContent = categories.map((cat) => ({
      ...cat,
      chapters: cat.chapters.map(({ content, ...rest }) => rest),
    }));

    return successResponse({
      categories: categoriesWithoutContent,
      totalChapters: chapters.length,
    });
  } catch (error) {
    console.error('[user-guide] List error:', error);
    return errorResponse((error as Error).message);
  }
}

/**
 * GET /api/user-guide/[chapterId] - Get a specific chapter's content
 *
 * Response:
 * {
 *   chapter: { id, title, content, number, category, path },
 *   prev: { id, title } | null,
 *   next: { id, title } | null
 * }
 */
export async function handleGetUserGuideChapter(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const chapterId = req.params?.id || req.query?.id;

    if (!chapterId) {
      return notFoundResponse('Chapter ID required');
    }

    const { chapters } = loadChapters();

    const chapterIndex = chapters.findIndex((c) => c.id === chapterId);

    if (chapterIndex === -1) {
      return notFoundResponse(`Chapter not found: ${chapterId}`);
    }

    const chapter = chapters[chapterIndex];
    const prev = chapterIndex > 0 ? { id: chapters[chapterIndex - 1].id, title: chapters[chapterIndex - 1].title } : null;
    const next = chapterIndex < chapters.length - 1 ? { id: chapters[chapterIndex + 1].id, title: chapters[chapterIndex + 1].title } : null;

    return successResponse({
      chapter,
      prev,
      next,
    });
  } catch (error) {
    console.error('[user-guide] Get chapter error:', error);
    return errorResponse((error as Error).message);
  }
}

/**
 * GET /api/user-guide/search?q=query - Search chapters
 *
 * Response:
 * {
 *   results: [{ id, title, category, snippet }],
 *   total: number
 * }
 */
export async function handleSearchUserGuide(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const query = req.query?.q?.toLowerCase();

    if (!query || query.length < 2) {
      return successResponse({ results: [], total: 0 });
    }

    const { chapters } = loadChapters();

    const results = chapters
      .filter((c) => {
        const searchText = `${c.title} ${c.content}`.toLowerCase();
        return searchText.includes(query);
      })
      .map((c) => {
        // Find snippet around match
        const lowerContent = c.content.toLowerCase();
        const matchIndex = lowerContent.indexOf(query);
        let snippet = '';

        if (matchIndex !== -1) {
          const start = Math.max(0, matchIndex - 50);
          const end = Math.min(c.content.length, matchIndex + query.length + 50);
          snippet = (start > 0 ? '...' : '') + c.content.slice(start, end).replace(/<[^>]+>/g, '') + (end < c.content.length ? '...' : '');
        }

        return {
          id: c.id,
          title: c.title,
          category: c.category,
          snippet,
        };
      })
      .slice(0, 20); // Limit results

    return successResponse({
      results,
      total: results.length,
    });
  } catch (error) {
    console.error('[user-guide] Search error:', error);
    return errorResponse((error as Error).message);
  }
}
