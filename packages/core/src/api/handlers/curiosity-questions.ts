import {
  curiosityQuestionStore,
  CuriosityQuestionNotFoundError,
  CuriosityQuestionResolutionConflictError,
} from '../../curiosity-questions.js';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

export async function handleSkipCuriosityQuestion(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, error: 'Request body must contain an object' };
  }
  const questionId = (body as Record<string, unknown>).questionId;
  if (typeof questionId !== 'string' || !questionId.trim()) {
    return { status: 400, error: 'questionId is required' };
  }
  try {
    const result = await curiosityQuestionStore.resolve(req.user.username, questionId, 'skipped');
    return successResponse({ success: true, question: result.record, changed: result.changed });
  } catch (error) {
    if (error instanceof CuriosityQuestionNotFoundError) {
      return { status: 404, error: error.message };
    }
    if (error instanceof CuriosityQuestionResolutionConflictError) {
      return { status: 409, error: error.message };
    }
    return { status: 500, error: (error as Error).message };
  }
}
