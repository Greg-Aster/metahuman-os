/**
 * TTS API
 * POST /api/tts - Generate speech from text
 * GET /api/tts - Get TTS status
 *
 * MIGRATED: Uses unified handler via astroHandler
 */

import { astroHandler } from '@metahuman/core/api';

export const POST = astroHandler;
export const GET = astroHandler;
