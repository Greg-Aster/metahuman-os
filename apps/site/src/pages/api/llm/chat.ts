/**
 * LLM Chat API - Proxy chat requests to local LLM backend
 *
 * POST /api/llm/chat - Proxy chat to local backend (Ollama or vLLM)
 * Used by remote clients (mobile/laptop) to use the server's LLM.
 *
 * ONE LINE - calls unified handler via astroHandler.
 * SAME business logic as mobile.
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';
export const POST = astroHandler;
