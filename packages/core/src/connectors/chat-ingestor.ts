/**
 * Chat Export Ingestor Connector
 *
 * Ingests chat history exports from various messaging platforms.
 * Supported formats: WhatsApp, Telegram, Discord, Signal, and generic formats.
 *
 * Part of Phase 3: Massive Greg-Centric Grounding
 */

import * as fs from 'fs';
import * as path from 'path';
import { getProfilePaths } from '../paths.js';
import { audit } from '../audit.js';
import { captureEvent } from '../memory.js';

// ============================================================================
// Types
// ============================================================================

export type ChatPlatform = 'whatsapp' | 'telegram' | 'discord' | 'signal' | 'imessage' | 'generic';

export interface ChatMessage {
  id: string;
  timestamp: Date;
  sender: string;
  content: string;
  isMe: boolean;
  replyTo?: string;
  attachments?: ChatAttachment[];
  reactions?: string[];
}

export interface ChatAttachment {
  type: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'other';
  filename?: string;
  path?: string;
}

export interface ChatConversation {
  id: string;
  platform: ChatPlatform;
  title: string;
  participants: string[];
  messages: ChatMessage[];
  startDate?: Date;
  endDate?: Date;
  isGroup: boolean;
}

export interface ChatIngestionResult {
  success: boolean;
  filepath: string;
  platform: ChatPlatform;
  conversationCount?: number;
  messageCount?: number;
  memoryIds?: string[];
  error?: string;
}

export interface ChatIngestionOptions {
  /** The user's name/identifier for detecting "isMe" messages */
  myName?: string;
  /** Alternative names/phone numbers that represent the user */
  myAliases?: string[];
  /** Minimum messages per conversation to ingest */
  minMessages?: number;
  /** Group messages into conversations of this many messages */
  chunkSize?: number;
  /** Additional tags to add */
  additionalTags?: string[];
  /** Source context */
  source?: string;
  /** Include media attachment references */
  includeAttachments?: boolean;
}

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Detect the chat platform from file content.
 */
export function detectPlatform(filepath: string): ChatPlatform {
  const ext = path.extname(filepath).toLowerCase();
  const content = fs.readFileSync(filepath, 'utf-8').substring(0, 5000);

  // WhatsApp text export pattern: "DD/MM/YYYY, HH:MM - Name: message"
  // or "MM/DD/YY, HH:MM AM/PM - Name: message"
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/.test(content)) {
    return 'whatsapp';
  }

  // Try JSON formats
  if (ext === '.json') {
    try {
      const json = JSON.parse(content.length < 5000 ? content : fs.readFileSync(filepath, 'utf-8'));

      // Telegram export
      if (json.chats || (json.name && json.type === 'personal_chat') || json.messages?.[0]?.from_id) {
        return 'telegram';
      }

      // Discord export
      if (json.channel || json.guild || json.messages?.[0]?.author?.username) {
        return 'discord';
      }

      // Signal backup (simplified)
      if (json.conversations || json.messages?.[0]?.conversationId) {
        return 'signal';
      }
    } catch {
      // Not valid JSON
    }
  }

  return 'generic';
}

// ============================================================================
// WhatsApp Parser
// ============================================================================

/**
 * Parse WhatsApp text export.
 * Format: "DD/MM/YYYY, HH:MM - Sender: Message"
 */
function parseWhatsAppExport(content: string, options: ChatIngestionOptions): ChatConversation {
  const messages: ChatMessage[] = [];
  const participants = new Set<string>();

  // Match various WhatsApp date formats
  const messagePattern = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\s*-\s*([^:]+):\s*(.*)$/gm;

  // Also handle continuation lines (messages spanning multiple lines)
  const lines = content.split('\n');
  let currentMessage: { date: string; time: string; sender: string; content: string } | null = null;

  for (const line of lines) {
    const match = line.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)\s*-\s*([^:]+):\s*(.*)$/);

    if (match) {
      // Save previous message
      if (currentMessage) {
        const timestamp = parseWhatsAppDate(currentMessage.date, currentMessage.time);
        const isMe = isMyMessage(currentMessage.sender, options);
        participants.add(currentMessage.sender);

        messages.push({
          id: `wa-${timestamp.getTime()}-${messages.length}`,
          timestamp,
          sender: currentMessage.sender,
          content: currentMessage.content,
          isMe,
          attachments: detectWhatsAppAttachments(currentMessage.content),
        });
      }

      currentMessage = {
        date: match[1],
        time: match[2],
        sender: match[3].trim(),
        content: match[4],
      };
    } else if (currentMessage && line.trim()) {
      // Continuation of previous message
      currentMessage.content += '\n' + line;
    }
  }

  // Don't forget last message
  if (currentMessage) {
    const timestamp = parseWhatsAppDate(currentMessage.date, currentMessage.time);
    const isMe = isMyMessage(currentMessage.sender, options);
    participants.add(currentMessage.sender);

    messages.push({
      id: `wa-${timestamp.getTime()}-${messages.length}`,
      timestamp,
      sender: currentMessage.sender,
      content: currentMessage.content,
      isMe,
      attachments: detectWhatsAppAttachments(currentMessage.content),
    });
  }

  // Determine conversation title from participants
  const participantList = Array.from(participants);
  const otherParticipants = participantList.filter((p) => !isMyMessage(p, options));
  const title = otherParticipants.length > 0 ? otherParticipants.join(', ') : 'WhatsApp Chat';

  return {
    id: `whatsapp-${Date.now()}`,
    platform: 'whatsapp',
    title,
    participants: participantList,
    messages,
    startDate: messages.length > 0 ? messages[0].timestamp : undefined,
    endDate: messages.length > 0 ? messages[messages.length - 1].timestamp : undefined,
    isGroup: participantList.length > 2,
  };
}

function parseWhatsAppDate(dateStr: string, timeStr: string): Date {
  // Handle different date formats
  const dateParts = dateStr.split('/');
  let day: number, month: number, year: number;

  if (dateParts[0].length === 4) {
    // YYYY/MM/DD format
    year = parseInt(dateParts[0]);
    month = parseInt(dateParts[1]) - 1;
    day = parseInt(dateParts[2]);
  } else if (parseInt(dateParts[0]) > 12) {
    // DD/MM/YYYY format (day > 12)
    day = parseInt(dateParts[0]);
    month = parseInt(dateParts[1]) - 1;
    year = parseInt(dateParts[2]);
  } else {
    // Could be MM/DD/YYYY or DD/MM/YYYY - assume DD/MM/YYYY for non-US
    day = parseInt(dateParts[0]);
    month = parseInt(dateParts[1]) - 1;
    year = parseInt(dateParts[2]);
  }

  // Handle 2-digit years
  if (year < 100) {
    year += 2000;
  }

  // Parse time
  let hours = 0,
    minutes = 0;
  const timeParts = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (timeParts) {
    hours = parseInt(timeParts[1]);
    minutes = parseInt(timeParts[2]);

    if (timeParts[4]) {
      // AM/PM format
      if (timeParts[4].toUpperCase() === 'PM' && hours !== 12) {
        hours += 12;
      } else if (timeParts[4].toUpperCase() === 'AM' && hours === 12) {
        hours = 0;
      }
    }
  }

  return new Date(year, month, day, hours, minutes);
}

function detectWhatsAppAttachments(content: string): ChatAttachment[] | undefined {
  const attachments: ChatAttachment[] = [];

  // WhatsApp marks attachments like "<attached: image.jpg>" or "image omitted"
  if (content.includes('<attached:') || content.includes('omitted')) {
    if (content.includes('image') || content.includes('.jpg') || content.includes('.png')) {
      attachments.push({ type: 'image' });
    } else if (content.includes('video') || content.includes('.mp4')) {
      attachments.push({ type: 'video' });
    } else if (content.includes('audio') || content.includes('.opus') || content.includes('.m4a')) {
      attachments.push({ type: 'audio' });
    } else if (content.includes('sticker')) {
      attachments.push({ type: 'sticker' });
    } else if (content.includes('document') || content.includes('.pdf')) {
      attachments.push({ type: 'document' });
    }
  }

  return attachments.length > 0 ? attachments : undefined;
}

// ============================================================================
// Telegram Parser
// ============================================================================

interface TelegramMessage {
  id: number;
  type: string;
  date: string;
  from?: string;
  from_id?: string;
  text?: string | Array<{ type: string; text: string }>;
  reply_to_message_id?: number;
  photo?: string;
  file?: string;
  media_type?: string;
}

interface TelegramExport {
  name?: string;
  type?: string;
  messages?: TelegramMessage[];
  chats?: { list: Array<{ name: string; messages: TelegramMessage[] }> };
}

function parseTelegramExport(content: string, options: ChatIngestionOptions): ChatConversation[] {
  const data: TelegramExport = JSON.parse(content);
  const conversations: ChatConversation[] = [];

  // Handle direct export format
  if (data.messages) {
    conversations.push(parseTelegramChat(data.name || 'Telegram Chat', data.messages, options));
  }

  // Handle full export format
  if (data.chats?.list) {
    for (const chat of data.chats.list) {
      if (chat.messages && chat.messages.length > 0) {
        conversations.push(parseTelegramChat(chat.name, chat.messages, options));
      }
    }
  }

  return conversations;
}

function parseTelegramChat(
  name: string,
  messages: TelegramMessage[],
  options: ChatIngestionOptions
): ChatConversation {
  const participants = new Set<string>();
  const parsedMessages: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.type !== 'message' || !msg.text) continue;

    const sender = msg.from || 'Unknown';
    participants.add(sender);

    // Handle text as string or array
    let content: string;
    if (typeof msg.text === 'string') {
      content = msg.text;
    } else if (Array.isArray(msg.text)) {
      content = msg.text.map((t) => (typeof t === 'string' ? t : t.text || '')).join('');
    } else {
      continue;
    }

    const attachments: ChatAttachment[] = [];
    if (msg.photo) attachments.push({ type: 'image', path: msg.photo });
    if (msg.file) {
      const type = msg.media_type === 'video_file' ? 'video' : msg.media_type === 'audio_file' ? 'audio' : 'document';
      attachments.push({ type, path: msg.file });
    }

    parsedMessages.push({
      id: `tg-${msg.id}`,
      timestamp: new Date(msg.date),
      sender,
      content,
      isMe: isMyMessage(sender, options),
      replyTo: msg.reply_to_message_id ? `tg-${msg.reply_to_message_id}` : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  }

  return {
    id: `telegram-${Date.now()}-${name.replace(/\s+/g, '-')}`,
    platform: 'telegram',
    title: name,
    participants: Array.from(participants),
    messages: parsedMessages,
    startDate: parsedMessages.length > 0 ? parsedMessages[0].timestamp : undefined,
    endDate: parsedMessages.length > 0 ? parsedMessages[parsedMessages.length - 1].timestamp : undefined,
    isGroup: participants.size > 2,
  };
}

// ============================================================================
// Discord Parser
// ============================================================================

interface DiscordMessage {
  id: string;
  timestamp: string;
  content: string;
  author: { id: string; username: string; discriminator?: string };
  attachments?: Array<{ filename: string; url: string }>;
  reactions?: Array<{ emoji: { name: string }; count: number }>;
  referenced_message?: { id: string };
}

interface DiscordExport {
  channel?: { id: string; name: string };
  guild?: { id: string; name: string };
  messages?: DiscordMessage[];
}

function parseDiscordExport(content: string, options: ChatIngestionOptions): ChatConversation {
  const data: DiscordExport = JSON.parse(content);
  const messages: ChatMessage[] = [];
  const participants = new Set<string>();

  const channelName = data.channel?.name || 'Discord Channel';
  const guildName = data.guild?.name;

  for (const msg of data.messages || []) {
    const sender = msg.author.username;
    participants.add(sender);

    const attachments: ChatAttachment[] = (msg.attachments || []).map((a) => ({
      type: a.filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)
        ? 'image'
        : a.filename.match(/\.(mp4|webm|mov)$/i)
          ? 'video'
          : 'document',
      filename: a.filename,
      path: a.url,
    }));

    const reactions = msg.reactions?.map((r) => `${r.emoji.name}:${r.count}`);

    messages.push({
      id: `dc-${msg.id}`,
      timestamp: new Date(msg.timestamp),
      sender,
      content: msg.content,
      isMe: isMyMessage(sender, options),
      replyTo: msg.referenced_message ? `dc-${msg.referenced_message.id}` : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      reactions: reactions?.length ? reactions : undefined,
    });
  }

  return {
    id: `discord-${data.channel?.id || Date.now()}`,
    platform: 'discord',
    title: guildName ? `${guildName} / ${channelName}` : channelName,
    participants: Array.from(participants),
    messages,
    startDate: messages.length > 0 ? messages[0].timestamp : undefined,
    endDate: messages.length > 0 ? messages[messages.length - 1].timestamp : undefined,
    isGroup: true, // Discord is always group-like
  };
}

// ============================================================================
// Generic Parser
// ============================================================================

interface GenericMessage {
  timestamp?: string;
  date?: string;
  time?: string;
  sender?: string;
  from?: string;
  author?: string;
  content?: string;
  text?: string;
  message?: string;
}

function parseGenericExport(content: string, filepath: string, options: ChatIngestionOptions): ChatConversation {
  const ext = path.extname(filepath).toLowerCase();
  const messages: ChatMessage[] = [];
  const participants = new Set<string>();

  if (ext === '.json') {
    try {
      const data = JSON.parse(content);
      const msgArray: GenericMessage[] = Array.isArray(data) ? data : data.messages || data.data || [];

      for (let i = 0; i < msgArray.length; i++) {
        const msg = msgArray[i];
        const sender = msg.sender || msg.from || msg.author || 'Unknown';
        const text = msg.content || msg.text || msg.message || '';
        const timestamp = new Date(msg.timestamp || msg.date || Date.now());

        participants.add(sender);

        messages.push({
          id: `gen-${i}`,
          timestamp,
          sender,
          content: text,
          isMe: isMyMessage(sender, options),
        });
      }
    } catch {
      // Fall through to text parsing
    }
  }

  // If no messages parsed, try line-by-line text parsing
  if (messages.length === 0) {
    const lines = content.split('\n').filter((l) => l.trim());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Try to detect patterns like "Name: message" or "[timestamp] Name: message"
      const match = line.match(/^(?:\[([^\]]+)\]\s*)?([^:]+):\s*(.+)$/);
      if (match) {
        const timestamp = match[1] ? new Date(match[1]) : new Date();
        const sender = match[2].trim();
        const content = match[3];

        participants.add(sender);

        messages.push({
          id: `gen-${i}`,
          timestamp: isNaN(timestamp.getTime()) ? new Date() : timestamp,
          sender,
          content,
          isMe: isMyMessage(sender, options),
        });
      }
    }
  }

  const filename = path.basename(filepath, ext);

  return {
    id: `generic-${Date.now()}`,
    platform: 'generic',
    title: filename,
    participants: Array.from(participants),
    messages,
    startDate: messages.length > 0 ? messages[0].timestamp : undefined,
    endDate: messages.length > 0 ? messages[messages.length - 1].timestamp : undefined,
    isGroup: participants.size > 2,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function isMyMessage(sender: string, options: ChatIngestionOptions): boolean {
  const myName = options.myName?.toLowerCase();
  const aliases = options.myAliases?.map((a) => a.toLowerCase()) || [];
  const senderLower = sender.toLowerCase();

  if (myName && senderLower.includes(myName)) return true;
  if (aliases.some((alias) => senderLower.includes(alias))) return true;

  // Common patterns for "self" in exports
  if (['you', 'me', 'self'].includes(senderLower)) return true;

  return false;
}

// ============================================================================
// Main Parsing Function
// ============================================================================

/**
 * Parse a chat export file and return conversations.
 */
export async function parseChatExport(
  filepath: string,
  options: ChatIngestionOptions = {}
): Promise<ChatConversation[]> {
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }

  const content = fs.readFileSync(filepath, 'utf-8');
  const platform = detectPlatform(filepath);

  switch (platform) {
    case 'whatsapp':
      return [parseWhatsAppExport(content, options)];

    case 'telegram':
      return parseTelegramExport(content, options);

    case 'discord':
      return [parseDiscordExport(content, options)];

    default:
      return [parseGenericExport(content, filepath, options)];
  }
}

// ============================================================================
// Memory Integration
// ============================================================================

/**
 * Format a conversation chunk as memory content.
 */
function formatConversationAsContent(
  conversation: ChatConversation,
  messages: ChatMessage[],
  chunkIndex: number,
  totalChunks: number
): string {
  const parts: string[] = [];

  parts.push(`Chat: ${conversation.title} (${conversation.platform})`);
  parts.push(`Participants: ${conversation.participants.join(', ')}`);

  if (messages.length > 0) {
    const start = messages[0].timestamp.toISOString().split('T')[0];
    const end = messages[messages.length - 1].timestamp.toISOString().split('T')[0];
    parts.push(`Date range: ${start} to ${end}`);
  }

  if (totalChunks > 1) {
    parts.push(`Part ${chunkIndex + 1} of ${totalChunks}`);
  }

  parts.push('');
  parts.push('--- Conversation ---');

  for (const msg of messages) {
    const time = msg.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const date = msg.timestamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const prefix = msg.isMe ? '→' : '←';

    parts.push(`[${date} ${time}] ${prefix} ${msg.sender}: ${msg.content}`);

    if (msg.attachments) {
      for (const att of msg.attachments) {
        parts.push(`  📎 [${att.type}${att.filename ? `: ${att.filename}` : ''}]`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * Generate tags from a conversation.
 */
function generateConversationTags(conversation: ChatConversation): string[] {
  const tags: string[] = ['chat', 'conversation', conversation.platform];

  if (conversation.isGroup) {
    tags.push('group-chat');
  } else {
    tags.push('direct-message');
  }

  // Add participant tags (sanitized)
  for (const participant of conversation.participants.slice(0, 5)) {
    const sanitized = participant.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 30);
    if (sanitized.length > 2) {
      tags.push(`contact:${sanitized}`);
    }
  }

  return [...new Set(tags)];
}

/**
 * Ingest a single chat export file.
 */
export async function ingestChatExport(
  filepath: string,
  username: string,
  options: ChatIngestionOptions = {}
): Promise<ChatIngestionResult> {
  const profilePaths = getProfilePaths(username);

  try {
    const conversations = await parseChatExport(filepath, options);
    const platform = detectPlatform(filepath);
    const memoryIds: string[] = [];
    let totalMessages = 0;

    const chunkSize = options.chunkSize || 50;
    const minMessages = options.minMessages || 1;

    for (const conversation of conversations) {
      if (conversation.messages.length < minMessages) continue;

      totalMessages += conversation.messages.length;

      // Chunk messages for manageable memory entries
      const chunks: ChatMessage[][] = [];
      for (let i = 0; i < conversation.messages.length; i += chunkSize) {
        chunks.push(conversation.messages.slice(i, i + chunkSize));
      }

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const content = formatConversationAsContent(conversation, chunk, i, chunks.length);
        const tags = [
          ...generateConversationTags(conversation),
          ...(options.additionalTags || []),
        ];

        const eventId = captureEvent(content, {
          type: 'observation',
          tags,
          metadata: {
            chat: {
              platform: conversation.platform,
              conversationId: conversation.id,
              title: conversation.title,
              participants: conversation.participants,
              messageCount: chunk.length,
              chunkIndex: i,
              totalChunks: chunks.length,
              startDate: chunk[0]?.timestamp.toISOString(),
              endDate: chunk[chunk.length - 1]?.timestamp.toISOString(),
            },
            consent: true,
            provenance: 'chat-export',
            source: options.source || `chat:${platform}`,
          },
        });

        memoryIds.push(eventId);
      }
    }

    audit({
      category: 'data_change',
      level: 'info',
      event: 'chat_export_ingested',
      actor: 'chat-ingestor',
      details: {
        filepath,
        platform,
        conversationCount: conversations.length,
        messageCount: totalMessages,
        memoryCount: memoryIds.length,
        username,
      },
    });

    return {
      success: true,
      filepath,
      platform,
      conversationCount: conversations.length,
      messageCount: totalMessages,
      memoryIds,
    };
  } catch (error) {
    audit({
      category: 'system',
      level: 'error',
      event: 'chat_ingestion_failed',
      actor: 'chat-ingestor',
      details: {
        filepath,
        error: (error as Error).message,
      },
    });

    return {
      success: false,
      filepath,
      platform: 'generic',
      error: (error as Error).message,
    };
  }
}

/**
 * Ingest multiple chat exports from a directory.
 */
export async function ingestChatsFromDirectory(
  directory: string,
  username: string,
  options: ChatIngestionOptions & { recursive?: boolean } = {}
): Promise<{
  total: number;
  successful: number;
  failed: number;
  results: ChatIngestionResult[];
}> {
  const results: ChatIngestionResult[] = [];
  const supportedExtensions = ['.txt', '.json'];

  function scanDirectory(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && options.recursive) {
        files.push(...scanDirectory(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (supportedExtensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  const chatFiles = scanDirectory(directory);

  for (const filepath of chatFiles) {
    const result = await ingestChatExport(filepath, username, options);
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

export const chatIngestor = {
  detectPlatform,
  parseChatExport,
  ingestChatExport,
  ingestChatsFromDirectory,
};
