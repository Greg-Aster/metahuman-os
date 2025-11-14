/**
 * Persona Interview Session Manager
 *
 * Manages CRUD operations for persona generation interview sessions.
 * Each session stores questions asked, answers received, and progress tracking.
 */

import fs from 'node:fs';
import path from 'node:path';
import { tryResolveProfilePath } from '../paths.js';
import { audit } from '../audit.js';
import { getUserContext } from '../context.js';

/**
 * Interview question with category tagging
 */
export interface Question {
  id: string;
  prompt: string;
  category: 'values' | 'goals' | 'style' | 'biography' | 'current_focus';
  generatedAt?: string;
}

/**
 * User answer to a question
 */
export interface Answer {
  questionId: string;
  content: string;
  capturedAt: string;
}

/**
 * Session status
 */
export type SessionStatus = 'active' | 'completed' | 'aborted';

/**
 * Category coverage tracking
 */
export interface CategoryCoverage {
  values: number;       // 0-100
  goals: number;        // 0-100
  style: number;        // 0-100
  biography: number;    // 0-100
  current_focus: number; // 0-100
}

/**
 * Interview session
 */
export interface Session {
  sessionId: string;
  userId: string;
  username: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  questions: Question[];
  answers: Answer[];
  categoryCoverage: CategoryCoverage;
  personaDraft?: any; // Populated after finalization
}

/**
 * Session metadata for index
 */
export interface SessionMetadata {
  sessionId: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
  answerCount: number;
}

/**
 * Session index
 */
export interface SessionIndex {
  latestSessionId: string | null;
  totalSessions: number;
  completedCount: number;
  sessions: SessionMetadata[];
}

/**
 * Start a new persona interview session
 */
export async function startSession(userId: string, username: string): Promise<Session> {
  const ctx = getUserContext();
  if (!ctx || ctx.userId !== userId) {
    throw new Error('User context mismatch');
  }

  // Resolve interviews directory path
  const interviewsPathResult = tryResolveProfilePath('personaInterviews');
  if (!interviewsPathResult.ok) {
    throw new Error('Cannot resolve interviews path for user');
  }

  const interviewsDir = interviewsPathResult.path;

  // Create interviews directory if it doesn't exist
  if (!fs.existsSync(interviewsDir)) {
    fs.mkdirSync(interviewsDir, { recursive: true });
  }

  // Generate session ID
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const now = new Date().toISOString();

  // Create session object
  const session: Session = {
    sessionId,
    userId,
    username,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    questions: [],
    answers: [],
    categoryCoverage: {
      values: 0,
      goals: 0,
      style: 0,
      biography: 0,
      current_focus: 0,
    },
  };

  // Save session file
  const sessionPath = path.join(interviewsDir, `${sessionId}.json`);
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');

  // Update index
  await updateSessionIndex(username, session);

  // Audit log
  await audit({
    category: 'persona_generation',
    level: 'info',
    action: 'session_started',
    details: {
      sessionId,
      userId,
      username,
    },
  });

  return session;
}

/**
 * Load an existing session by ID
 */
export async function loadSession(username: string, sessionId: string): Promise<Session | null> {
  const interviewsPathResult = tryResolveProfilePath('personaInterviews');
  if (!interviewsPathResult.ok) {
    return null;
  }

  const sessionPath = path.join(interviewsPathResult.path, `${sessionId}.json`);

  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  const session: Session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));

  // Verify ownership
  if (session.username !== username) {
    throw new Error('Session does not belong to this user');
  }

  return session;
}

/**
 * Save updated session
 */
export async function saveSession(username: string, session: Session): Promise<void> {
  const interviewsPathResult = tryResolveProfilePath('personaInterviews');
  if (!interviewsPathResult.ok) {
    throw new Error('Cannot resolve interviews path');
  }

  // Verify ownership
  if (session.username !== username) {
    throw new Error('Session does not belong to this user');
  }

  const sessionPath = path.join(interviewsPathResult.path, `${session.sessionId}.json`);

  // Update timestamp
  session.updatedAt = new Date().toISOString();

  // Save
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8');

  // Update index
  await updateSessionIndex(username, session);
}

/**
 * List all sessions for a user
 */
export async function listSessions(username: string): Promise<SessionMetadata[]> {
  const indexPathResult = tryResolveProfilePath('personaInterviewsIndex');
  if (!indexPathResult.ok) {
    return [];
  }

  if (!fs.existsSync(indexPathResult.path)) {
    return [];
  }

  const index: SessionIndex = JSON.parse(fs.readFileSync(indexPathResult.path, 'utf-8'));
  return index.sessions;
}

/**
 * Discard (abort) a session
 */
export async function discardSession(username: string, sessionId: string): Promise<void> {
  const session = await loadSession(username, sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  // Mark as aborted
  session.status = 'aborted';
  await saveSession(username, session);

  // Audit log
  await audit({
    category: 'persona_generation',
    level: 'info',
    action: 'session_aborted',
    details: {
      sessionId,
      username,
      questionCount: session.questions.length,
      answerCount: session.answers.length,
    },
  });
}

/**
 * Add a question to a session
 */
export async function addQuestion(
  username: string,
  sessionId: string,
  question: Question
): Promise<void> {
  const session = await loadSession(username, sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  if (session.status !== 'active') {
    throw new Error('Session is not active');
  }

  session.questions.push(question);
  await saveSession(username, session);

  // Audit log
  await audit({
    category: 'persona_generation',
    level: 'info',
    action: 'question_asked',
    details: {
      sessionId,
      questionId: question.id,
      category: question.category,
    },
  });
}

/**
 * Record an answer to a question
 */
export async function recordAnswer(
  username: string,
  sessionId: string,
  questionId: string,
  content: string
): Promise<void> {
  const session = await loadSession(username, sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  if (session.status !== 'active') {
    throw new Error('Session is not active');
  }

  // Verify question exists
  const question = session.questions.find((q) => q.id === questionId);
  if (!question) {
    throw new Error('Question not found in session');
  }

  // Add answer
  const answer: Answer = {
    questionId,
    content,
    capturedAt: new Date().toISOString(),
  };

  session.answers.push(answer);

  // Update category coverage
  updateCategoryCoverage(session);

  await saveSession(username, session);

  // Audit log
  await audit({
    category: 'persona_generation',
    level: 'info',
    action: 'answer_recorded',
    details: {
      sessionId,
      questionId,
      category: question.category,
      answerLength: content.length,
    },
  });
}

/**
 * Update category coverage based on answers
 */
function updateCategoryCoverage(session: Session): void {
  const categoryCounts: Record<string, number> = {
    values: 0,
    goals: 0,
    style: 0,
    biography: 0,
    current_focus: 0,
  };

  // Count answered questions per category
  for (const answer of session.answers) {
    const question = session.questions.find((q) => q.id === answer.questionId);
    if (question) {
      categoryCounts[question.category]++;
    }
  }

  // Calculate coverage percentage (2 answers = 100%, 1 answer = 50%)
  for (const category of Object.keys(categoryCounts)) {
    const count = categoryCounts[category];
    session.categoryCoverage[category as keyof CategoryCoverage] = Math.min(100, count * 50);
  }
}

/**
 * Update session index
 */
async function updateSessionIndex(username: string, session: Session): Promise<void> {
  const indexPathResult = tryResolveProfilePath('personaInterviewsIndex');
  if (!indexPathResult.ok) {
    throw new Error('Cannot resolve index path');
  }

  const indexPath = indexPathResult.path;
  const indexDir = path.dirname(indexPath);

  // Create directory if needed
  if (!fs.existsSync(indexDir)) {
    fs.mkdirSync(indexDir, { recursive: true });
  }

  // Load existing index or create new
  let index: SessionIndex;
  if (fs.existsSync(indexPath)) {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  } else {
    index = {
      latestSessionId: null,
      totalSessions: 0,
      completedCount: 0,
      sessions: [],
    };
  }

  // Find existing session metadata or create new
  const existingIndex = index.sessions.findIndex((s) => s.sessionId === session.sessionId);
  const metadata: SessionMetadata = {
    sessionId: session.sessionId,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    questionCount: session.questions.length,
    answerCount: session.answers.length,
  };

  if (existingIndex >= 0) {
    // Update existing
    index.sessions[existingIndex] = metadata;
  } else {
    // Add new
    index.sessions.push(metadata);
    index.totalSessions++;
  }

  // Update counters
  index.latestSessionId = session.sessionId;
  index.completedCount = index.sessions.filter((s) => s.status === 'completed').length;

  // Sort by createdAt descending (newest first)
  index.sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Save index
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * Get session statistics
 */
export async function getSessionStats(username: string): Promise<{
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  abortedSessions: number;
}> {
  const sessions = await listSessions(username);

  return {
    totalSessions: sessions.length,
    activeSessions: sessions.filter((s) => s.status === 'active').length,
    completedSessions: sessions.filter((s) => s.status === 'completed').length,
    abortedSessions: sessions.filter((s) => s.status === 'aborted').length,
  };
}
