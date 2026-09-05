/**
 * Persona Interview Session Manager
 *
 * Manages CRUD operations for persona generation interview sessions.
 * Each session stores questions asked, answers received, and progress tracking.
 */

import path from 'node:path';
import { storageClient } from '../storage-client.js';
import { audit } from '../audit.js';
import { getUserContext } from '../context.js';

/**
 * Interview question with category tagging
 */
export const PERSONA_INTERVIEW_CATEGORIES = [
  'values', 'goals', 'style', 'biography', 'current_focus',
] as const;
export type PersonaCategory = typeof PERSONA_INTERVIEW_CATEGORIES[number];

export interface Question {
  id: string;
  prompt: string;
  category: PersonaCategory;
  generatedAt?: string;
}

/**
 * User answer to a question
 */
export interface Answer {
  questionId: string;
  content: string;
  capturedAt: string;
  editedAt?: string;
}

/**
 * Session status
 */
export type SessionStatus = 'active' | 'completed' | 'finalized' | 'applied' | 'aborted';

export function isCompletedPersonaSession(status: SessionStatus): boolean {
  return status === 'completed' || status === 'finalized' || status === 'applied';
}

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

export interface PersonaCoveragePolicy {
  categories: PersonaCategory[];
  sessionDefaults: {
    targetCategoryCompletionPercentage: number;
  };
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
  completedAt?: string;
  finalizedAt?: string;
  appliedAt?: string;
  appliedStrategy?: 'replace' | 'merge' | 'append';
  questions: Question[];
  answers: Answer[];
  categoryCoverage: CategoryCoverage;
  personaDraft?: unknown; // Populated after finalization
}

/**
 * Session metadata for index
 */
export interface SessionMetadata {
  sessionId: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  finalizedAt?: string;
  appliedAt?: string;
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

export function findPendingPersonaQuestion(session: Session): Question | undefined {
  return session.questions.find(question => (
    !session.answers.some(answer => answer.questionId === question.id)
  ));
}

export function getPersonaInterviewCategoryGaps(
  session: Session,
  policy: PersonaCoveragePolicy,
): PersonaCategory[] {
  return policy.categories.filter(category => (
    session.categoryCoverage[category] < policy.sessionDefaults.targetCategoryCompletionPercentage
  ));
}

export function selectPersonaInterviewCategory(
  session: Session,
  policy: PersonaCoveragePolicy,
): PersonaCategory {
  const gaps = getPersonaInterviewCategoryGaps(session, policy);
  const selectable = gaps.length > 0 ? gaps : policy.categories;
  const selected = [...selectable].sort((left, right) => (
    session.categoryCoverage[left] - session.categoryCoverage[right]
    || policy.categories.indexOf(left) - policy.categories.indexOf(right)
  ))[0];
  if (!selected) throw new Error('Persona interview policy has no selectable category');
  return selected;
}

export function getPersonaSessionStoragePaths(interviewsDir: string, sessionId: string) {
  return {
    session: path.join(interviewsDir, `${sessionId}.json`),
    artifacts: path.join(interviewsDir, sessionId),
  };
}

function sessionRequest(username: string, sessionId: string) {
  if (!/^session-[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(sessionId)) {
    throw new Error('Invalid persona interview session ID');
  }
  return {
    username,
    category: 'config' as const,
    subcategory: 'persona',
    relativePath: `therapy/${sessionId}.json`,
  };
}

function archivedSessionRequest(username: string, sessionId: string) {
  sessionRequest(username, sessionId);
  return {
    username,
    category: 'config' as const,
    subcategory: 'persona',
    relativePath: `therapy/_archive/${sessionId}/session.json`,
  };
}

function indexRequest(username: string) {
  return {
    username,
    category: 'config' as const,
    subcategory: 'persona',
    relativePath: 'therapy/index.json',
  };
}

async function readStoredJson<T>(
  request: ReturnType<typeof sessionRequest> | ReturnType<typeof indexRequest> | ReturnType<typeof archivedSessionRequest>,
): Promise<T | null> {
  const result = await storageClient.read({ ...request, encoding: 'utf8' });
  if (!result.success) {
    if (result.error?.startsWith('File not found:')) return null;
    throw new Error(`Cannot read persona interview data: ${result.error || 'unknown error'}`);
  }
  try {
    return JSON.parse(String(result.data)) as T;
  } catch (error) {
    throw new Error(`Persona interview data is not valid JSON: ${(error as Error).message}`);
  }
}

async function writeStoredJson(
  request: ReturnType<typeof sessionRequest> | ReturnType<typeof indexRequest> | ReturnType<typeof archivedSessionRequest>,
  value: unknown,
): Promise<void> {
  const result = await storageClient.write({
    ...request,
    data: JSON.stringify(value, null, 2),
    encoding: 'utf8',
  });
  if (!result.success) {
    throw new Error(`Cannot write persona interview data: ${result.error || 'unknown error'}`);
  }
}

export function applySessionLifecycleTimestamps(session: Session, now: string): void {
  session.updatedAt = now;
  if (session.status === 'completed' && !session.completedAt) session.completedAt = now;
  if (session.status === 'finalized' && !session.finalizedAt) session.finalizedAt = now;
  if (session.status === 'applied' && !session.appliedAt) session.appliedAt = now;
}

export function resolvePersonaInterviewsPath(username: string): string {
  const result = storageClient.resolvePath({
    username,
    category: 'config',
    subcategory: 'persona',
    relativePath: 'therapy',
  });
  if (!result.success || !result.path) {
    throw new Error(`Cannot resolve persona interview storage: ${result.error || 'unknown error'}`);
  }
  return result.path;
}

/**
 * Start a new persona interview session
 */
export async function startSession(userId: string, username: string): Promise<Session> {
  const ctx = getUserContext();
  if (!ctx || ctx.userId !== userId
    || (ctx.username !== username && ctx.activeProfile !== username)) {
    throw new Error('User context mismatch');
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
  await writeStoredJson(sessionRequest(username, sessionId), session);

  // Update index
  await updateSessionIndex(username, session);

  // Audit log
  await audit({
    category: 'action',
    level: 'info',
    event: 'session_started',
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
  const session = await readStoredJson<Session>(sessionRequest(username, sessionId));
  if (!session) return null;

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
  // Verify ownership
  if (session.username !== username) {
    throw new Error('Session does not belong to this user');
  }

  // Update lifecycle timestamps at the canonical persistence boundary.
  const now = new Date().toISOString();
  applySessionLifecycleTimestamps(session, now);

  await writeStoredJson(sessionRequest(username, session.sessionId), session);

  // Update index
  await updateSessionIndex(username, session);
}

/**
 * List all sessions for a user
 */
export async function listSessions(username: string): Promise<SessionMetadata[]> {
  const index = await readStoredJson<SessionIndex>(indexRequest(username));
  return index?.sessions || [];
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
    category: 'action',
    level: 'info',
    event: 'session_aborted',
    details: {
      sessionId,
      username,
      questionCount: session.questions.length,
      answerCount: session.answers.length,
    },
  });
}

export async function removeSessionRecord(
  username: string,
  sessionId: string,
  archiveBeforeDelete: boolean,
): Promise<void> {
  const session = await loadSession(username, sessionId);
  if (!session) throw new Error('Session not found');
  if (archiveBeforeDelete) {
    await writeStoredJson(archivedSessionRequest(username, sessionId), session);
  }
  const deleted = await storageClient.delete(sessionRequest(username, sessionId));
  if (!deleted.success) {
    throw new Error(`Cannot delete persona interview session: ${deleted.error || 'unknown error'}`);
  }
  const index = await readStoredJson<SessionIndex>(indexRequest(username));
  if (!index) return;
  index.sessions = index.sessions.filter(item => item.sessionId !== sessionId);
  index.totalSessions = index.sessions.length;
  index.completedCount = index.sessions.filter(item => isCompletedPersonaSession(item.status)).length;
  index.latestSessionId = index.sessions[0]?.sessionId || null;
  await writeStoredJson(indexRequest(username), index);
}

/**
 * Add a question to a session
 */
export function applyQuestionToSession(
  session: Session,
  question: Question,
): { question: Question; created: boolean } {
  if (session.status !== 'active') {
    throw new Error('Session is not active');
  }
  if (!question.id.trim() || !question.prompt.trim() || question.prompt.length > 2_000
    || !PERSONA_INTERVIEW_CATEGORIES.includes(question.category)) {
    throw new Error('Question is invalid');
  }
  const existing = session.questions.find(item => item.id === question.id);
  if (existing) {
    if (existing.prompt.trim() !== question.prompt.trim() || existing.category !== question.category) {
      throw new Error('Question ID conflicts with an existing question');
    }
    return { question: existing, created: false };
  }
  const unanswered = findPendingPersonaQuestion(session);
  if (unanswered) return { question: unanswered, created: false };

  const storedQuestion = { ...question, id: question.id.trim(), prompt: question.prompt.trim() };
  session.questions.push(storedQuestion);
  return { question: storedQuestion, created: true };
}

export async function addQuestion(
  username: string,
  sessionId: string,
  question: Question
): Promise<Question> {
  const session = await loadSession(username, sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  const result = applyQuestionToSession(session, question);
  if (!result.created) return result.question;
  await saveSession(username, session);

  // Audit log
  await audit({
    category: 'action',
    level: 'info',
    event: 'question_asked',
    details: {
      sessionId,
      questionId: result.question.id,
      category: result.question.category,
    },
  });
  return result.question;
}

export interface PersonaAnswerLimits {
  minLength: number;
  maxLength: number;
}

function validatedAnswerContent(content: string, limits: PersonaAnswerLimits): string {
  const normalized = content.trim();
  if (!Number.isInteger(limits.minLength) || !Number.isInteger(limits.maxLength)
    || limits.minLength < 1 || limits.maxLength < limits.minLength) {
    throw new Error('Persona answer limits are invalid');
  }
  if (normalized.length < limits.minLength || normalized.length > limits.maxLength) {
    throw new Error(`Answer must be between ${limits.minLength} and ${limits.maxLength} characters`);
  }
  return normalized;
}

export function applyAnswerToSession(
  session: Session,
  questionId: string,
  content: string,
  limits: PersonaAnswerLimits,
  now: string,
): { answer: Answer; created: boolean } {
  if (!session.questions.some(question => question.id === questionId)) {
    throw new Error('Question not found in session');
  }
  const normalized = validatedAnswerContent(content, limits);
  const existing = session.answers.find(answer => answer.questionId === questionId);
  if (existing) {
    if (existing.content.trim() === normalized) return { answer: existing, created: false };
    throw new Error('An answer has already been recorded for this question');
  }
  if (session.status !== 'active') throw new Error('Session is not active');
  const answer: Answer = { questionId, content: normalized, capturedAt: now };
  session.answers.push(answer);
  updateCategoryCoverage(session);
  return { answer, created: true };
}

/**
 * Record an answer to a question
 */
export async function recordAnswer(
  username: string,
  sessionId: string,
  questionId: string,
  content: string,
  limits: PersonaAnswerLimits,
): Promise<Answer> {
  const session = await loadSession(username, sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  const question = session.questions.find((q) => q.id === questionId);
  const result = applyAnswerToSession(session, questionId, content, limits, new Date().toISOString());
  if (!result.created) return result.answer;
  await saveSession(username, session);

  // Audit log
  await audit({
    category: 'action',
    level: 'info',
    event: 'answer_recorded',
    details: {
      sessionId,
      questionId,
      category: question!.category,
      answerLength: result.answer.content.length,
    },
  });
  return result.answer;
}

export async function updateAnswer(
  username: string,
  sessionId: string,
  questionId: string,
  content: string,
  limits: PersonaAnswerLimits,
): Promise<Answer> {
  const session = await loadSession(username, sessionId);
  if (!session) throw new Error('Session not found');
  if (session.status !== 'active' && session.status !== 'completed') {
    throw new Error('Session answers can no longer be edited');
  }
  const answer = session.answers.find(item => item.questionId === questionId);
  if (!answer) throw new Error('Answer not found');
  const normalized = validatedAnswerContent(content, limits);
  if (answer.content === normalized) return answer;
  answer.content = normalized;
  answer.editedAt = new Date().toISOString();
  await saveSession(username, session);
  await audit({
    category: 'action',
    level: 'info',
    event: 'answer_updated',
    details: { sessionId, questionId, answerLength: normalized.length },
  });
  return answer;
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
  let index = await readStoredJson<SessionIndex>(indexRequest(username));
  if (!index) {
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
    completedAt: session.completedAt,
    finalizedAt: session.finalizedAt,
    appliedAt: session.appliedAt,
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
  index.completedCount = index.sessions.filter((session) => isCompletedPersonaSession(session.status)).length;

  // Sort by createdAt descending (newest first)
  index.sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  await writeStoredJson(indexRequest(username), index);
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
    completedSessions: sessions.filter((session) => isCompletedPersonaSession(session.status)).length,
    abortedSessions: sessions.filter((s) => s.status === 'aborted').length,
  };
}
