/**
 * RunPod Validate API Handlers
 *
 * Validates a RunPod API key by making a simple API call.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

interface ValidateResponse {
  valid: boolean;
  error?: string;
  userInfo?: {
    id: string;
    email?: string;
  };
}

/**
 * POST /api/runpod/validate - Validate RunPod API key
 * Body: { apiKey: string }
 */
export async function handleValidateRunpodKey(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  try {
    const { apiKey } = body || {};

    if (!apiKey || typeof apiKey !== 'string') {
      return successResponse({
        valid: false,
        error: 'API key is required',
      } as ValidateResponse);
    }

    // Test the API key by fetching user info
    const response = await fetch('https://api.runpod.io/graphql?api_key=' + apiKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          query {
            myself {
              id
              email
            }
          }
        `,
      }),
    });

    if (!response.ok) {
      return successResponse({
        valid: false,
        error: `RunPod API returned ${response.status}: ${response.statusText}`,
      } as ValidateResponse);
    }

    const data = await response.json();

    // Check for GraphQL errors
    if (data.errors && data.errors.length > 0) {
      const errorMsg = data.errors[0].message || 'Invalid API key';
      return successResponse({
        valid: false,
        error: errorMsg,
      } as ValidateResponse);
    }

    // Check if we got user data
    if (data.data?.myself) {
      return successResponse({
        valid: true,
        userInfo: {
          id: data.data.myself.id,
          email: data.data.myself.email,
        },
      } as ValidateResponse);
    }

    // No errors but no user data either
    return successResponse({
      valid: false,
      error: 'Unable to verify API key',
    } as ValidateResponse);
  } catch (error) {
    console.error('[runpod-validate] POST error:', error);
    return {
      status: 500,
      error: (error as Error).message,
      data: { valid: false },
    };
  }
}
