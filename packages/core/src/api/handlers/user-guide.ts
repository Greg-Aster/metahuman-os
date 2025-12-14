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

/**
 * Simple markdown to HTML converter
 * Uses basic regex patterns - no external dependencies
 */
function parseMarkdown(markdown: string): string {
  let html = markdown;

  // Escape HTML entities first (except in code blocks)
  // We'll handle code blocks separately

  // Headers
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');

  // Code blocks (fenced)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<pre><code class="language-${lang || 'text'}">${escaped}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Unordered lists
  html = html.replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>');

  // Ordered lists
  html = html.replace(/^\s*\d+\.\s+(.*)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> tags in <ul> or <ol>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
    return `<ul>${match}</ul>`;
  });

  // Blockquotes
  html = html.replace(/^>\s*(.*)$/gm, '<blockquote>$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');

  // Tables (basic support)
  html = html.replace(/^\|(.+)\|$/gm, (_, row) => {
    const cells = row.split('|').map((cell: string) => cell.trim());
    const cellsHtml = cells.map((cell: string) => `<td>${cell}</td>`).join('');
    return `<tr>${cellsHtml}</tr>`;
  });

  // Wrap consecutive <tr> in <table>
  html = html.replace(/(<tr>.*<\/tr>\n?)+/g, (match) => {
    // Check if first row should be header
    const rows = match.split('</tr>').filter(Boolean);
    if (rows.length > 1) {
      const headerRow = rows[0].replace(/<td>/g, '<th>').replace(/<\/td>/g, '</th>');
      const bodyRows = rows.slice(1).join('</tr>');
      return `<table><thead>${headerRow}</tr></thead><tbody>${bodyRows}</tr></tbody></table>`;
    }
    return `<table>${match}</table>`;
  });

  // Paragraphs (wrap standalone lines)
  const lines = html.split('\n');
  const processed: string[] = [];
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isBlockElement = /^<(h[1-6]|ul|ol|li|pre|blockquote|hr|table|thead|tbody|tr|th|td)/.test(trimmed);
    const isClosingBlock = /^<\/(h[1-6]|ul|ol|pre|blockquote|table|thead|tbody)>/.test(trimmed);

    if (!trimmed) {
      if (inParagraph) {
        processed.push('</p>');
        inParagraph = false;
      }
      processed.push('');
    } else if (isBlockElement || isClosingBlock) {
      if (inParagraph) {
        processed.push('</p>');
        inParagraph = false;
      }
      processed.push(line);
    } else {
      if (!inParagraph) {
        processed.push('<p>');
        inParagraph = true;
      }
      processed.push(line);
    }
  }

  if (inParagraph) {
    processed.push('</p>');
  }

  return processed.join('\n');
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

      // Extract title from filename
      const filename = item.name.replace('.md', '');
      const title = filename
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
