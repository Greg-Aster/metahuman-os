import type { APIRoute } from 'astro';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { tryResolveProfilePath } from '@metahuman/core/paths';
import { audit } from '@metahuman/core';

/**
 * Conversation Buffer API
 *
 * Manages server-side chat history with rolling window and mode isolation.
 *
 * GET    /api/conversation-buffer?mode={conversation|inner} - Fetch messages
 * POST   /api/conversation-buffer                           - Append message
 * DELETE /api/conversation-buffer?mode={conversation|inner} - Clear buffer
 */

type Mode = 'conversation' | 'inner';
type MessageRole = 'user' | 'assistant' | 'system' | 'reflection' | 'dream' | 'reasoning';

interface Message {
  role: MessageRole;
  content: string;
  timestamp: number;
  meta?: Record<string, any>;
}

interface ConversationBuffer {
  mode: Mode;
  messages: Message[];
  lastUpdated: string;
  messageLimit: number;
}

const DEFAULT_MESSAGE_LIMIT = 50;
const MIN_MESSAGE_LIMIT = 10;
const MAX_MESSAGE_LIMIT = 100;

function getBufferPath(mode: Mode): string | null {
  const result = tryResolveProfilePath('state');
  if (!result.ok) return null;

  return `${result.path}/conversation-buffer-${mode}.json`;
}

function loadBuffer(mode: Mode): ConversationBuffer | null {
  const bufferPath = getBufferPath(mode);
  if (!bufferPath || !existsSync(bufferPath)) {
    return null;
  }

  try {
    const raw = readFileSync(bufferPath, 'utf-8');
    const data = JSON.parse(raw);

    // Validate structure
    if (!Array.isArray(data.messages)) {
      console.warn(`[conversation-buffer] Invalid buffer structure for ${mode}, resetting`);
      return null;
    }

    return {
      mode,
      messages: data.messages || [],
      lastUpdated: data.lastUpdated || new Date().toISOString(),
      messageLimit: data.messageLimit || DEFAULT_MESSAGE_LIMIT,
    };
  } catch (error) {
    console.error(`[conversation-buffer] Failed to load ${mode} buffer:`, error);
    return null;
  }
}

function saveBuffer(buffer: ConversationBuffer): boolean {
  const bufferPath = getBufferPath(buffer.mode);
  if (!bufferPath) return false;

  try {
    const data = {
      mode: buffer.mode,
      messages: buffer.messages,
      lastUpdated: new Date().toISOString(),
      messageLimit: buffer.messageLimit,
    };

    writeFileSync(bufferPath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error(`[conversation-buffer] Failed to save ${buffer.mode} buffer:`, error);
    return false;
  }
}

function pruneBuffer(buffer: ConversationBuffer): void {
  if (buffer.messages.length <= buffer.messageLimit) return;

  // Keep only the most recent messages
  const excess = buffer.messages.length - buffer.messageLimit;
  buffer.messages = buffer.messages.slice(excess);

  audit({
    level: 'info',
    category: 'system',
    event: 'conversation_buffer_pruned',
    details: { mode: buffer.mode, removedCount: excess, remaining: buffer.messages.length },
    actor: 'system',
  });
}

function deleteBuffer(mode: Mode): boolean {
  const bufferPath = getBufferPath(mode);
  if (!bufferPath) return false;

  try {
    if (existsSync(bufferPath)) {
      unlinkSync(bufferPath);
    }
    return true;
  } catch (error) {
    console.error(`[conversation-buffer] Failed to delete ${mode} buffer:`, error);
    return false;
  }
}

// GET: Fetch conversation buffer
const getHandler: APIRoute = async ({ cookies, request }) => {
  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') || 'conversation') as Mode;

  if (mode !== 'conversation' && mode !== 'inner') {
    return new Response(
      JSON.stringify({ error: 'Invalid mode. Must be "conversation" or "inner"' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const buffer = loadBuffer(mode);

  if (!buffer) {
    // Return empty buffer structure
    return new Response(
      JSON.stringify({
        mode,
        messages: [],
        lastUpdated: new Date().toISOString(),
        messageLimit: DEFAULT_MESSAGE_LIMIT,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify(buffer), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// POST: Append message to buffer
const postHandler: APIRoute = async ({ cookies, request }) => {
  const body = await request.json();
  const { mode, message } = body;

  if (!mode || (mode !== 'conversation' && mode !== 'inner')) {
    return new Response(
      JSON.stringify({ error: 'Invalid or missing mode' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!message || !message.role || !message.content) {
    return new Response(
      JSON.stringify({ error: 'Invalid message structure. Required: role, content' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Load or create buffer
  let buffer = loadBuffer(mode);
  if (!buffer) {
    buffer = {
      mode,
      messages: [],
      lastUpdated: new Date().toISOString(),
      messageLimit: DEFAULT_MESSAGE_LIMIT,
    };
  }

  // Add timestamp if not present
  const newMessage: Message = {
    ...message,
    timestamp: message.timestamp || Date.now(),
  };

  buffer.messages.push(newMessage);

  // Auto-prune if over limit
  pruneBuffer(buffer);

  // Save buffer
  const saved = saveBuffer(buffer);

  if (!saved) {
    return new Response(
      JSON.stringify({ error: 'Failed to save buffer' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, messageCount: buffer.messages.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

// DELETE: Clear conversation buffer
const deleteHandler: APIRoute = async ({ cookies, request }) => {
  const url = new URL(request.url);
  const mode = (url.searchParams.get('mode') || 'conversation') as Mode;

  if (mode !== 'conversation' && mode !== 'inner') {
    return new Response(
      JSON.stringify({ error: 'Invalid mode. Must be "conversation" or "inner"' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const deleted = deleteBuffer(mode);

  audit({
    level: 'info',
    category: 'action',
    event: 'conversation_buffer_cleared',
    details: { mode },
    actor: 'user',
  });

  return new Response(
    JSON.stringify({ success: deleted, mode }),
    { status: deleted ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
  );
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
export const GET = getHandler;
export const POST = postHandler;
export const DELETE = deleteHandler;
