#!/usr/bin/env node

/**
 * Graph vs Legacy Regression Harness
 *
 * Usage:
 *   node scripts/graph-regression.mjs [prompts.json]
 *
 * Relies on the local dev server at http://localhost:4321.
 */

import fs from 'node:fs';
import path from 'node:path';

const API_URL = process.env.GRAPH_REGRESSION_API || 'http://localhost:4321/api/persona_chat';
const PROMPTS_PATH = process.argv[2] || path.join(process.cwd(), 'docs', 'tests', 'graph-regression-prompts.json');

async function loadPrompts() {
  try {
    const raw = await fs.promises.readFile(PROMPTS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.prompts) || parsed.prompts.length === 0) {
      throw new Error('prompts array missing or empty');
    }
    return parsed.prompts;
  } catch (error) {
    console.error('[graph-regression] Failed to load prompts:', error);
    process.exit(1);
  }
}

async function readSseAnswer(response) {
  if (!response.body) {
    throw new Error('SSE response missing body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalAnswer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (!chunk.startsWith('data:')) continue;

      const payloadRaw = chunk.replace(/^data:\s*/, '');
      if (!payloadRaw) continue;

      let payload;
      try {
        payload = JSON.parse(payloadRaw);
      } catch {
        continue;
      }

      if (payload.type === 'answer' && payload.data?.response) {
        finalAnswer = payload.data.response;
      } else if (payload.type === 'error') {
        throw new Error(payload.data?.message || 'Graph stream error');
      }
    }
  }

  if (!finalAnswer) {
    throw new Error('No answer event received from SSE stream');
  }

  return finalAnswer;
}

async function sendPrompt(prompt, useGraph) {
  const start = Date.now();
  const payload = {
    message: prompt,
    mode: 'conversation',
    newSession: true,
    graphPipelineOverride: useGraph,
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`Request failed (status ${res.status}): ${errorBody}`);
  }

  const contentType = res.headers.get('content-type') || '';
  let responseText;

  if (contentType.includes('text/event-stream')) {
    responseText = await readSseAnswer(res);
  } else {
    const data = await res.json();
    responseText = typeof data.response === 'string' ? data.response : JSON.stringify(data);
  }

  const duration = Date.now() - start;
  return { response: responseText, duration };
}

async function run() {
  const prompts = await loadPrompts();
  const results = [];

  for (const prompt of prompts) {
    console.log(`\n[graph-regression] Prompt: "${prompt}"`);
    let legacy;
    try {
      legacy = await sendPrompt(prompt, false);
    } catch (error) {
      console.error(`[graph-regression] Legacy pipeline failed: ${error.message}`);
      throw error;
    }

    let graph;
    try {
      graph = await sendPrompt(prompt, true);
    } catch (error) {
      console.error(`[graph-regression] Graph pipeline failed: ${error.message}`);
      throw error;
    }
    const match = legacy.response.trim() === graph.response.trim();
    results.push({
      prompt,
      legacyResponse: legacy.response,
      graphResponse: graph.response,
      match,
      legacyDurationMs: legacy.duration,
      graphDurationMs: graph.duration,
    });
    console.log(`  Legacy ${legacy.duration}ms | Graph ${graph.duration}ms | Match: ${match ? 'YES' : 'NO'}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    api: API_URL,
    promptFile: PROMPTS_PATH,
    summary: {
      total: results.length,
      matches: results.filter(r => r.match).length,
      mismatches: results.filter(r => !r.match).length,
    },
    results,
  };

  const reportDir = path.join(process.cwd(), 'logs', 'graph-regression');
  await fs.promises.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `report-${Date.now()}.json`);
  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(`\nSaved regression report to ${reportPath}`);
}

run().catch(error => {
  console.error('[graph-regression] Unexpected error:', error);
  process.exit(1);
});
