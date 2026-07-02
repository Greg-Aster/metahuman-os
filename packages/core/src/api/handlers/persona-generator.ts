import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { storageClient } from '../../storage-client.js';
import { systemPaths } from '../../path-builder.js';
import { audit } from '../../audit.js';
import { captureEvent } from '../../memory.js';
import {
  startSession,
  addQuestion,
  loadSession,
  listSessions,
  recordAnswer,
  saveSession,
  discardSession,
  type Question,
  type Session,
} from '../../persona/session-manager.js';
import {
  generateNextQuestion,
  getCompletionStatus,
} from '../../persona/question-generator.js';
import {
  extractPersonaFromSession,
  extractPersonaFromTranscript,
  type ChatMessage,
} from '../../persona/extractor.js';
import {
  loadExistingPersona,
  mergePersonaDraft,
  savePersona,
  generateDiffText,
  type MergeStrategy,
} from '../../persona/merger.js';
import fs from 'node:fs';
import path from 'node:path';

type PersonaGeneratorSession = Omit<Session, 'status'> & {
  status: Session['status'] | 'finalized' | 'applied';
  finalizedAt?: string;
  appliedAt?: string;
  appliedStrategy?: MergeStrategy;
};

const DEFAULT_PERSONA = {
  version: '1.0.0',
  identity: {
    name: '',
    pronouns: [],
    age: null,
    location: '',
    occupation: '',
    background: '',
  },
  personality: {
    traits: {
      openness: 50,
      conscientiousness: 50,
      extraversion: 50,
      agreeableness: 50,
      neuroticism: 50,
    },
    communication_style: {
      formality: 'balanced',
      verbosity: 'moderate',
      humor: 'occasional',
      directness: 'balanced',
      emotional_expression: 'moderate',
    },
    cognitive_patterns: {
      decision_making: 'balanced',
      problem_solving: 'systematic',
      learning_style: 'visual',
      attention_to_detail: 'moderate',
    },
  },
  values: {
    core_values: [],
    ethical_principles: [],
    priorities: [],
  },
  goals: {
    short_term: [],
    long_term: [],
    aspirations: [],
  },
  interests: {
    hobbies: [],
    topics_of_interest: [],
    skills: [],
  },
  context: {
    daily_routine: '',
    current_projects: [],
    relationships: [],
    challenges: [],
  },
  metadata: {
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    sources: ['system_default'],
    confidence: 0,
  },
};

function json(data: unknown, status = 200): UnifiedResponse {
  return { status, data };
}

function error(error: string, status = 500, details?: string): UnifiedResponse {
  return {
    status,
    data: details ? { error, details } : { error },
  };
}

function requireAuthenticated(req: UnifiedRequest): UnifiedResponse | null {
  if (!req.user.isAuthenticated) {
    return error('Authentication required', 401);
  }
  return null;
}

function resolvePersonaPath(relativePath: string): string | null {
  const pathResult = storageClient.resolvePath({
    category: 'config',
    subcategory: 'persona',
    relativePath,
  });

  return pathResult.success && pathResult.path ? pathResult.path : null;
}

function loadBaselineQuestions(): Question[] {
  const configPath = path.join(systemPaths.root, 'etc', 'persona-generator.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return config.baselineQuestions.map((q: any) => ({
    id: q.id,
    prompt: q.prompt,
    category: q.category,
    generatedAt: new Date().toISOString(),
  }));
}

async function loadOwnedSession(
  username: string,
  userId: string,
  sessionId: string
): Promise<{ session?: PersonaGeneratorSession; response?: UnifiedResponse }> {
  const session = await loadSession(username, sessionId);
  if (!session) {
    return { response: error('Session not found', 404) };
  }

  if (session.userId !== userId) {
    return { response: error('Access denied - session belongs to another user', 403) };
  }

  return { session: session as PersonaGeneratorSession };
}

export async function handlePersonaGeneratorStart(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireAuthenticated(req);
    if (authError) return authError;

    if (!resolvePersonaPath('therapy')) {
      return error('Write access denied', 403);
    }

    const session = await startSession(req.user.userId, req.user.username);
    const baselineQuestions = loadBaselineQuestions();
    if (baselineQuestions.length === 0) {
      return error('No baseline questions configured', 500);
    }

    const firstQuestion = baselineQuestions[0];
    await addQuestion(req.user.username, session.sessionId, firstQuestion);

    return json({
      success: true,
      sessionId: session.sessionId,
      question: firstQuestion,
      progress: session.categoryCoverage,
    });
  } catch (err) {
    console.error('[persona/generator/start] Error:', err);
    return error(err instanceof Error ? err.message : 'Failed to start session');
  }
}

export async function handlePersonaGeneratorLoad(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireAuthenticated(req);
    if (authError) return authError;

    if (!resolvePersonaPath('therapy')) {
      return error('Access denied', 403);
    }

    const sessionId = req.query?.sessionId;
    if (!sessionId) {
      const sessions = await listSessions(req.user.username);
      return json({ success: true, sessions });
    }

    const { session, response } = await loadOwnedSession(req.user.username, req.user.userId, sessionId);
    if (response) return response;

    return json({ success: true, session });
  } catch (err) {
    console.error('[persona/generator/load] Error:', err);
    return error(err instanceof Error ? err.message : 'Failed to load session');
  }
}

export async function handlePersonaGeneratorAnswer(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireAuthenticated(req);
    if (authError) return authError;

    if (!resolvePersonaPath('therapy')) {
      return error('Write access denied', 403);
    }

    const { sessionId, questionId, answer: answerContent } = req.body ?? {};
    if (!sessionId || !questionId || !answerContent) {
      return error('sessionId, questionId, and answer are required', 400);
    }

    const { session, response } = await loadOwnedSession(req.user.username, req.user.userId, sessionId);
    if (response) return response;

    if (session!.status !== 'active') {
      return error('Session is not active', 400);
    }

    await recordAnswer(req.user.username, sessionId, questionId, answerContent);

    const updatedSession = await loadSession(req.user.username, sessionId) as PersonaGeneratorSession | null;
    if (!updatedSession) {
      throw new Error('Failed to reload session after recording answer');
    }

    const status = getCompletionStatus(updatedSession as Session);
    let nextQuestion = null;
    let reasoning = null;

    if (!status.isComplete) {
      try {
        const result = await generateNextQuestion(updatedSession as Session);
        if (result) {
          await addQuestion(req.user.username, sessionId, result.question);
          nextQuestion = result.question;
          reasoning = result.reasoning;
        } else {
          status.isComplete = true;
          updatedSession.status = 'completed';
          await saveSession(req.user.username, updatedSession as Session);
        }
      } catch (err) {
        console.error('[persona/generator/answer] Error generating next question:', err);
        return json({
          error: 'Failed to generate next question',
          details: err instanceof Error ? err.message : 'Unknown error',
          progress: status.progress,
          isComplete: status.isComplete,
        }, 500);
      }
    } else {
      updatedSession.status = 'completed';
      await saveSession(req.user.username, updatedSession as Session);
    }

    return json({
      success: true,
      nextQuestion,
      reasoning,
      progress: status.progress,
      isComplete: status.isComplete,
      questionsRemaining: status.questionsRemaining,
      message: status.message,
    });
  } catch (err) {
    console.error('[persona/generator/answer] Error:', err);
    return error(err instanceof Error ? err.message : 'Failed to process answer');
  }
}

export async function handlePersonaGeneratorUpdateAnswer(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireAuthenticated(req);
    if (authError) return authError;

    if (!resolvePersonaPath('therapy')) {
      return error('Access denied', 403);
    }

    const { sessionId, questionId, content } = req.body ?? {};
    if (!sessionId || !questionId || typeof content !== 'string') {
      return error('sessionId, questionId, and content are required', 400);
    }

    const { session, response } = await loadOwnedSession(req.user.username, req.user.userId, sessionId);
    if (response) {
      return response.status === 403 ? error('Access denied', 403) : response;
    }

    const answerIndex = session!.answers.findIndex((a) => a.questionId === questionId);
    if (answerIndex === -1) {
      return error('Answer not found', 404);
    }

    session!.answers[answerIndex].content = content;
    session!.answers[answerIndex].editedAt = new Date().toISOString();

    await saveSession(req.user.username, session! as Session);

    return json({
      success: true,
      answer: session!.answers[answerIndex],
    });
  } catch (err) {
    console.error('[persona/generator/update-answer] Error:', err);
    return error(err instanceof Error ? err.message : 'Failed to update answer');
  }
}

export async function handlePersonaGeneratorFinalize(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireAuthenticated(req);
    if (authError) return authError;

    const interviewsPath = resolvePersonaPath('therapy');
    if (!interviewsPath) {
      return error('Write access denied', 403);
    }

    const { sessionId, strategy = 'merge', copyToTraining = false } = req.body ?? {};
    if (!sessionId) {
      return error('sessionId is required', 400);
    }

    const { session, response } = await loadOwnedSession(req.user.username, req.user.userId, sessionId);
    if (response) return response;

    if (session!.status === 'finalized') {
      return error('Session already finalized', 400);
    }

    const extracted = await extractPersonaFromSession(session! as Session);
    const personaCorePath = resolvePersonaPath('core.json');
    if (!personaCorePath) {
      throw new Error('Failed to resolve persona core path');
    }

    const currentPersona = loadExistingPersona(personaCorePath);
    const { updated, diff } = mergePersonaDraft(currentPersona, extracted, strategy);
    const diffText = generateDiffText(diff);

    const sessionDir = path.join(interviewsPath, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const summaryPath = path.join(sessionDir, 'summary.json');
    const summary = {
      sessionId,
      userId: req.user.userId,
      username: req.user.username,
      finalizedAt: new Date().toISOString(),
      extracted,
      diff: {
        changes: diff.changes,
        summary: diff.summary,
      },
      diffText,
      strategy,
      previewPersona: updated,
    };
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

    session!.status = 'finalized';
    session!.finalizedAt = new Date().toISOString();
    await saveSession(req.user.username, session! as Session);

    let trainingPath: string | null = null;
    if (copyToTraining) {
      try {
        const trainingDir = path.join(interviewsPath, '..', '..', 'memory', 'training', 'persona-interviews');
        fs.mkdirSync(trainingDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        trainingPath = path.join(trainingDir, `${sessionId}-${timestamp}.jsonl`);

        const lines: string[] = [];
        for (const question of session!.questions) {
          const answer = session!.answers.find((a) => a.questionId === question.id);
          if (answer) {
            lines.push(JSON.stringify({
              messages: [
                { role: 'assistant', content: question.prompt },
                { role: 'user', content: answer.content },
              ],
              category: question.category,
              timestamp: (answer as any).answeredAt,
            }));
          }
        }

        fs.writeFileSync(trainingPath, lines.join('\n'), 'utf-8');

        await audit({
          category: 'action',
          level: 'info',
          event: 'persona_training_data_exported',
          actor: req.user.username,
          details: {
            action: 'persona_training_data_exported',
            sessionId,
            trainingPath,
            questionCount: session!.questions.length,
          },
        });
      } catch (err) {
        console.error('[finalize] Failed to copy to training data:', err);
      }
    }

    await audit({
      category: 'action',
      level: 'info',
      event: 'persona_session_finalized',
      actor: req.user.username,
      userId: req.user.userId,
      details: {
        action: 'persona_session_finalized',
        sessionId,
        userId: req.user.userId,
        username: req.user.username,
        questionCount: session!.questions.length,
        answerCount: session!.answers.length,
        confidence: extracted.confidence,
        diffSummary: diff.summary,
        trainingExported: copyToTraining,
      },
    });

    return json({
      success: true,
      message: 'Session finalized successfully',
      extracted,
      diff: {
        changes: diff.changes,
        summary: diff.summary,
        text: diffText,
      },
      summaryPath,
      trainingPath,
      confidence: extracted.confidence,
    });
  } catch (err) {
    console.error('[persona/generator/finalize] Error:', err);
    return error(err instanceof Error ? err.message : 'Failed to finalize session');
  }
}

export async function handlePersonaGeneratorApply(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireAuthenticated(req);
    if (authError) return authError;

    const interviewsPath = resolvePersonaPath('therapy');
    if (!interviewsPath) {
      return error('Write access denied', 403);
    }

    const personaCorePath = resolvePersonaPath('core.json');
    if (!personaCorePath) {
      return error('Cannot access persona core', 403);
    }

    const { sessionId, strategy } = req.body ?? {};
    if (!sessionId || !strategy) {
      return error('sessionId and strategy are required', 400);
    }

    if (!['replace', 'merge', 'append'].includes(strategy)) {
      return error('strategy must be one of: replace, merge, append', 400);
    }

    const { session, response } = await loadOwnedSession(req.user.username, req.user.userId, sessionId);
    if (response) return response;

    if (session!.status !== 'finalized') {
      return error('Session must be finalized before applying', 400);
    }

    const summaryPath = path.join(interviewsPath, sessionId, 'summary.json');
    if (!fs.existsSync(summaryPath)) {
      return error('Summary not found - session may not be finalized', 400);
    }

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    const extracted = summary.extracted;
    const currentPersona = loadExistingPersona(personaCorePath);

    const backupDir = path.join(interviewsPath, sessionId, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `persona-core-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(currentPersona, null, 2), 'utf-8');

    const { updated, diff } = mergePersonaDraft(currentPersona, extracted, strategy);
    savePersona(personaCorePath, updated);

    const diffText = generateDiffText(diff);

    session!.status = 'applied';
    session!.appliedAt = new Date().toISOString();
    session!.appliedStrategy = strategy;
    await saveSession(req.user.username, session! as Session);

    await audit({
      category: 'data_change',
      level: 'info',
      event: 'persona_draft_applied',
      actor: req.user.username,
      userId: req.user.userId,
      details: {
        action: 'persona_draft_applied',
        sessionId,
        userId: req.user.userId,
        username: req.user.username,
        strategy,
        diffSummary: diff.summary,
        backupPath,
        personaPath: personaCorePath,
      },
    });

    return json({
      success: true,
      message: `Persona updated successfully using ${strategy} strategy`,
      diff: {
        changes: diff.changes,
        summary: diff.summary,
        text: diffText,
      },
      backupPath,
      personaPath: personaCorePath,
    });
  } catch (err) {
    console.error('[persona/generator/apply] Error:', err);
    return error(err instanceof Error ? err.message : 'Failed to apply persona draft');
  }
}

export async function handlePersonaGeneratorDiscard(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireAuthenticated(req);
    if (authError) return authError;

    if (!resolvePersonaPath('therapy')) {
      return error('Write access denied', 403);
    }

    const { sessionId } = req.body ?? {};
    if (!sessionId) {
      return error('sessionId is required', 400);
    }

    const { response } = await loadOwnedSession(req.user.username, req.user.userId, sessionId);
    if (response) return response;

    await discardSession(req.user.username, sessionId);

    return json({
      success: true,
      message: 'Session discarded successfully',
    });
  } catch (err) {
    console.error('[persona/generator/discard] Error:', err);
    return error(err instanceof Error ? err.message : 'Failed to discard session');
  }
}

export async function handlePersonaGeneratorAddNotes(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireAuthenticated(req);
    if (authError) return authError;

    const { notes } = req.body ?? {};
    if (!notes || typeof notes !== 'string' || notes.trim().length === 0) {
      return error('Notes text is required', 400);
    }

    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'Tell me about yourself, your personality, values, and what matters to you.',
      },
      {
        role: 'user',
        content: notes,
      },
    ];

    const extracted = await extractPersonaFromTranscript(messages);
    const personaPath = resolvePersonaPath('core.json');
    if (!personaPath) {
      return error('Access denied', 403);
    }

    const currentPersona = loadExistingPersona(personaPath);
    const backupDir = path.join(path.dirname(personaPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `persona-core-notes-${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(currentPersona, null, 2), 'utf-8');

    const { updated } = mergePersonaDraft(currentPersona, extracted, 'merge');
    savePersona(personaPath, updated);

    await captureEvent(`Persona Notes - Self-Reflection\n\n${notes}`, {
      type: 'observation',
      tags: ['persona-notes', 'self-reflection', 'quick-add'],
      metadata: {
        source: 'persona-generator-notes',
        extractedPersona: true,
        confidence: extracted.confidence?.overall || 0,
      },
    });

    audit({
      category: 'action',
      level: 'info',
      event: 'persona_notes_added',
      actor: req.user.username,
      details: {
        action: 'persona_notes_added',
        notesLength: notes.length,
        backupPath,
        confidence: extracted.confidence?.overall || 0,
        timestamp: new Date().toISOString(),
      },
    });

    return json({
      success: true,
      message: 'Notes processed and merged with persona',
      extracted,
      backupPath,
    });
  } catch (err) {
    console.error('[persona/generator/add-notes] POST error:', err);
    return error('Failed to process notes', 500, (err as Error).message);
  }
}

export async function handlePersonaGeneratorResetPersona(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireAuthenticated(req);
    if (authError) return authError;

    const personaPath = resolvePersonaPath('core.json');
    if (!personaPath) {
      return error('Access denied', 403);
    }

    const backupDir = path.join(path.dirname(personaPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `persona-core-reset-${timestamp}.json`);

    let currentPersona = DEFAULT_PERSONA;
    if (fs.existsSync(personaPath)) {
      currentPersona = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));
    }

    fs.writeFileSync(backupPath, JSON.stringify(currentPersona, null, 2), 'utf-8');
    fs.writeFileSync(personaPath, JSON.stringify(DEFAULT_PERSONA, null, 2), 'utf-8');

    audit({
      category: 'action',
      level: 'info',
      event: 'persona_file_reset',
      actor: req.user.username,
      details: {
        action: 'persona_file_reset',
        backupPath,
        timestamp: new Date().toISOString(),
      },
    });

    return json({
      success: true,
      backupPath,
      message: 'Persona file reset to defaults',
    });
  } catch (err) {
    console.error('[persona/generator/reset-persona] POST error:', err);
    return error('Failed to reset persona', 500, (err as Error).message);
  }
}

export async function handlePersonaGeneratorPurgeSessions(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireAuthenticated(req);
    if (authError) return authError;

    const interviewsDir = resolvePersonaPath('therapy');
    if (!interviewsDir) {
      return error('Access denied', 403);
    }

    if (!fs.existsSync(interviewsDir)) {
      return json({ success: true, deletedCount: 0 });
    }

    const files = fs.readdirSync(interviewsDir);
    const sessionFiles = files.filter((f) => f.endsWith('.json'));

    for (const file of sessionFiles) {
      fs.unlinkSync(path.join(interviewsDir, file));
    }

    audit({
      category: 'action',
      level: 'info',
      event: 'persona_sessions_purged',
      actor: req.user.username,
      details: {
        action: 'persona_sessions_purged',
        deletedCount: sessionFiles.length,
        timestamp: new Date().toISOString(),
      },
    });

    return json({
      success: true,
      deletedCount: sessionFiles.length,
    });
  } catch (err) {
    console.error('[persona/generator/purge-sessions] POST error:', err);
    return error('Failed to purge sessions', 500, (err as Error).message);
  }
}
