/**
 * Document Ingestor Connector
 *
 * Ingests documents (PDF, DOCX, TXT, MD) into the memory system.
 * Extracts text content and basic metadata.
 *
 * Part of Phase 3: Massive Greg-Centric Grounding
 */

import * as fs from 'fs';
import * as path from 'path';
import * as mammothModule from 'mammoth';
import { getProfilePaths } from '../paths.js';
import { audit } from '../audit.js';
import { captureEvent } from '../memory.js';

// Handle ESM/CJS compatibility
const mammoth = (mammothModule as any).default || mammothModule;

// ============================================================================
// Types
// ============================================================================

export interface DocumentMetadata {
  // File info
  filename: string;
  filepath: string;
  fileSize: number;
  mimeType: string;
  extension: string;

  // Document info
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creationDate?: string;
  modificationDate?: string;

  // Content stats
  pageCount?: number;
  wordCount?: number;
  characterCount?: number;

  // Extraction info
  extractedAt: string;
  extractionMethod: 'pdf-parse' | 'mammoth' | 'plaintext';
}

export interface DocumentIngestionResult {
  success: boolean;
  filepath: string;
  memoryId?: string;
  metadata?: DocumentMetadata;
  contentPreview?: string;
  error?: string;
}

export interface DocumentIngestionOptions {
  /** Copy document to profile's media directory */
  copyToProfile?: boolean;
  /** Maximum content length to store (characters) */
  maxContentLength?: number;
  /** Additional tags to add */
  additionalTags?: string[];
  /** Source context (e.g., "manual upload", "email attachment") */
  source?: string;
  /** Extract and store full content (default: true) */
  storeFullContent?: boolean;
}

// ============================================================================
// MIME Type Detection
// ============================================================================

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
};

const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown'];

function getMimeType(ext: string): string {
  return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';
}

function isSupported(ext: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(ext.toLowerCase());
}

// ============================================================================
// Text Extraction
// ============================================================================

/**
 * Extract text from a PDF file.
 */
async function extractPdfText(filepath: string): Promise<{
  text: string;
  metadata: Partial<DocumentMetadata>;
}> {
  const buffer = fs.readFileSync(filepath);
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });

  try {
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();
    const info = infoResult.info;
    const keywords = typeof info?.Keywords === 'string'
      ? info.Keywords.split(',').map((keyword: string) => keyword.trim()).filter(Boolean)
      : undefined;

    return {
      text: textResult.text,
      metadata: {
        pageCount: textResult.total,
        title: info?.Title,
        author: info?.Author,
        subject: info?.Subject,
        keywords,
        creationDate: info?.CreationDate,
        modificationDate: info?.ModDate,
        extractionMethod: 'pdf-parse',
      },
    };
  } finally {
    await parser.destroy();
  }
}

/**
 * Extract text from a DOCX file.
 */
async function extractDocxText(filepath: string): Promise<{
  text: string;
  metadata: Partial<DocumentMetadata>;
}> {
  const result = await mammoth.extractRawText({ path: filepath });

  return {
    text: result.value,
    metadata: {
      extractionMethod: 'mammoth',
    },
  };
}

/**
 * Extract text from a plain text or markdown file.
 */
async function extractPlainText(filepath: string): Promise<{
  text: string;
  metadata: Partial<DocumentMetadata>;
}> {
  const text = fs.readFileSync(filepath, 'utf-8');

  return {
    text,
    metadata: {
      extractionMethod: 'plaintext',
    },
  };
}

/**
 * Count words in text.
 */
function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

// ============================================================================
// Main Extraction
// ============================================================================

/**
 * Extract text and metadata from a document.
 */
export async function extractDocumentContent(filepath: string): Promise<{
  text: string;
  metadata: DocumentMetadata;
}> {
  const stats = fs.statSync(filepath);
  const filename = path.basename(filepath);
  const ext = path.extname(filepath).toLowerCase();

  if (!isSupported(ext)) {
    throw new Error(`Unsupported file type: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }

  // Extract text based on file type
  let extraction: { text: string; metadata: Partial<DocumentMetadata> };

  switch (ext) {
    case '.pdf':
      extraction = await extractPdfText(filepath);
      break;
    case '.docx':
      extraction = await extractDocxText(filepath);
      break;
    case '.txt':
    case '.md':
    case '.markdown':
      extraction = await extractPlainText(filepath);
      break;
    default:
      throw new Error(`No extraction method for: ${ext}`);
  }

  const metadata: DocumentMetadata = {
    filename,
    filepath,
    fileSize: stats.size,
    mimeType: getMimeType(ext),
    extension: ext,
    extractedAt: new Date().toISOString(),
    wordCount: countWords(extraction.text),
    characterCount: extraction.text.length,
    ...extraction.metadata,
  };

  return {
    text: extraction.text,
    metadata,
  };
}

// ============================================================================
// Memory Integration
// ============================================================================

/**
 * Generate tags from document metadata.
 */
function generateTagsFromMetadata(metadata: DocumentMetadata): string[] {
  const tags: string[] = ['document', metadata.extension.replace('.', '')];

  if (metadata.author) {
    tags.push(`author:${metadata.author.toLowerCase().replace(/\s+/g, '-')}`);
  }

  if (metadata.keywords) {
    tags.push(...metadata.keywords.map((k) => k.toLowerCase()));
  }

  // File size category
  if (metadata.fileSize > 10 * 1024 * 1024) {
    tags.push('large-file');
  } else if (metadata.fileSize > 1024 * 1024) {
    tags.push('medium-file');
  }

  // Content length category
  if (metadata.wordCount && metadata.wordCount > 5000) {
    tags.push('long-document');
  } else if (metadata.wordCount && metadata.wordCount > 1000) {
    tags.push('medium-document');
  }

  return [...new Set(tags)];
}

/**
 * Generate content description for the memory.
 */
function generateContentFromDocument(
  text: string,
  metadata: DocumentMetadata,
  options?: DocumentIngestionOptions
): string {
  const parts: string[] = [];

  parts.push(`Document: ${metadata.filename}`);

  if (metadata.title && metadata.title !== metadata.filename) {
    parts.push(`Title: ${metadata.title}`);
  }

  if (metadata.author) {
    parts.push(`Author: ${metadata.author}`);
  }

  if (metadata.pageCount) {
    parts.push(`Pages: ${metadata.pageCount}`);
  }

  if (metadata.wordCount) {
    parts.push(`Words: ${metadata.wordCount}`);
  }

  if (options?.source) {
    parts.push(`Source: ${options.source}`);
  }

  parts.push(''); // Empty line before content

  // Include content (optionally truncated)
  const maxLength = options?.maxContentLength ?? 50000;
  const storeContent = options?.storeFullContent ?? true;

  if (storeContent) {
    if (text.length > maxLength) {
      parts.push(`Content (first ${maxLength} characters):`);
      parts.push(text.substring(0, maxLength) + '...[truncated]');
    } else {
      parts.push('Content:');
      parts.push(text);
    }
  } else {
    // Just store a preview
    const preview = text.substring(0, 500);
    parts.push(`Preview: ${preview}${text.length > 500 ? '...' : ''}`);
  }

  return parts.join('\n');
}

/**
 * Ingest a single document into the memory system.
 */
export async function ingestDocument(
  filepath: string,
  username: string,
  options?: DocumentIngestionOptions
): Promise<DocumentIngestionResult> {
  const profilePaths = getProfilePaths(username);

  try {
    // Check file exists
    if (!fs.existsSync(filepath)) {
      return {
        success: false,
        filepath,
        error: `File not found: ${filepath}`,
      };
    }

    // Extract content
    const { text, metadata } = await extractDocumentContent(filepath);

    // Copy to profile media directory if requested
    let storedPath = filepath;
    if (options?.copyToProfile) {
      const mediaDir = path.join(profilePaths.root, 'media', 'documents');
      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }

      const destFilename = `${Date.now()}-${metadata.filename}`;
      storedPath = path.join(mediaDir, destFilename);
      fs.copyFileSync(filepath, storedPath);
    }

    // Generate content and tags
    const content = generateContentFromDocument(text, metadata, options);
    const tags = [
      ...generateTagsFromMetadata(metadata),
      ...(options?.additionalTags || []),
    ];

    // Create memory event
    const eventId = captureEvent({
      type: 'observation',
      content,
      tags,
      source: options?.source || 'document-ingestor',
      metadata: {
        document: {
          filepath: storedPath,
          ...metadata,
        },
        consent: true,
        provenance: 'local-file',
      },
    });

    // Audit the ingestion
    audit({
      category: 'data_change',
      level: 'info',
      event: 'document_ingested',
      actor: 'document-ingestor',
      details: {
        filepath,
        storedPath,
        username,
        eventId,
        extension: metadata.extension,
        wordCount: metadata.wordCount,
        pageCount: metadata.pageCount,
      },
    });

    return {
      success: true,
      filepath,
      memoryId: eventId,
      metadata,
      contentPreview: text.substring(0, 200),
    };
  } catch (error) {
    audit({
      category: 'system',
      level: 'error',
      event: 'document_ingestion_failed',
      actor: 'document-ingestor',
      details: {
        filepath,
        error: (error as Error).message,
      },
    });

    return {
      success: false,
      filepath,
      error: (error as Error).message,
    };
  }
}

/**
 * Ingest multiple documents from a directory.
 */
export async function ingestDocumentsFromDirectory(
  directory: string,
  username: string,
  options?: DocumentIngestionOptions & { recursive?: boolean }
): Promise<{
  total: number;
  successful: number;
  failed: number;
  results: DocumentIngestionResult[];
}> {
  const results: DocumentIngestionResult[] = [];

  function scanDirectory(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && options?.recursive) {
        files.push(...scanDirectory(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (isSupported(ext)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  const documentFiles = scanDirectory(directory);

  for (const filepath of documentFiles) {
    const result = await ingestDocument(filepath, username, options);
    results.push(result);
  }

  return {
    total: results.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

// ============================================================================
// Export
// ============================================================================

export const documentIngestor = {
  extractDocumentContent,
  ingestDocument,
  ingestDocumentsFromDirectory,
  isSupported,
  SUPPORTED_EXTENSIONS,
};
