import type { APIRoute } from 'astro';
import { loadPersonaCore, ollama, captureEvent, ROOT, listActiveTasks, audit, getIndexStatus, queryIndex, buildRagContext, searchMemory, loadTrustLevel, llm, callLLM, type ModelRole, getOrchestratorContext, getPersonaContext, updateConversationContext, updateCurrentFocus, resolveModelForCognitiveMode } from '@metahuman/core';
import { loadCognitiveMode, getModeDefinition, canWriteMemory, canUseOperator } from '@metahuman/core/cognitive-mode';
import { readFileSync, existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { initializeSkills } from '../../../../../brain/skills/index';
import { getAvailableSkills, executeSkill, type SkillManifest } from '@metahuman/core/skills';

type Role = 'system' | 'user' | 'assistant';
type Mode = 'inner' | 'conversation';

// Simple in-memory histories per mode
const histories: Record<Mode, Array<{ role: Role; content: string }>> = {
  inner: [],
  conversation: [],
};



// Dedup and retry guards
const lastUserTurn: Record<Mode, { text: string; ts: number } | null> = { inner: null, conversation: null };
const lastAssistantReplies: Record<Mode, string[]> = { inner: [], conversation: [] };
// Track recently used memory IDs to avoid repeating the same snippets turn after turn
const recentMemoryIds: Record<Mode, string[]> = { inner: [], conversation: [] };

/**
 * Helper to load cognitive mode context and compute derived flags.
 * Returns mode, defaults, and permission flags for consistent behavior.
 */
function getCognitiveModeContext() {
  const cognitiveConfig = loadCognitiveMode();
  const mode = cognitiveConfig.currentMode;
  const modeDefinition = getModeDefinition(mode);
  const defaults = modeDefinition.defaults;

  return {
    mode,
    config: cognitiveConfig,
    definition: modeDefinition,
    defaults,
    allowMemoryWrites: canWriteMemory(mode),
    allowOperator: canUseOperator(mode),
  };
}

/**
 * Load persona summary and recent reflections as fallback grounding context.
 * Used in dual mode when semantic index is unavailable.
 */
async function loadPersonaFallbackContext(persona: any): Promise<string> {
  try {
    const fallbackParts: string[] = [];

    // Add core identity
    if (persona?.identity) {
      const { name, role, purpose } = persona.identity;
      fallbackParts.push(`I am ${name}. ${role}. ${purpose}`);
    }

    // Add key personality traits
    if (persona?.personality?.communicationStyle) {
      const tone = persona.personality.communicationStyle.tone || [];
      if (Array.isArray(tone) && tone.length > 0) {
        fallbackParts.push(`Communication style: ${tone.join(', ')}`);
      }
    }

    // Add core values
    if (persona?.values?.core) {
      const values = persona.values.core.map((v: any) => v.value).filter(Boolean);
      if (values.length > 0) {
        fallbackParts.push(`Core values: ${values.join(', ')}`);
      }
    }

    // Try to load recent reflections as lightweight grounding
    try {
      const reflectionsPath = path.join(ROOT, 'memory/reflections');
      if (existsSync(reflectionsPath)) {
        const files = await fs.readdir(reflectionsPath);
        const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse().slice(0, 2);

        for (const file of jsonFiles) {
          try {
            const content = await fs.readFile(path.join(reflectionsPath, file), 'utf-8');
            const reflection = JSON.parse(content);
            if (reflection.content) {
              fallbackParts.push(`Recent reflection: ${reflection.content.substring(0, 200)}`);
            }
          } catch {}
        }
      }
    } catch {}

    return fallbackParts.join('\n\n');
  } catch (error) {
    console.error('[loadPersonaFallbackContext] Error:', error);
    return 'Core identity available but details unavailable.';
  }
}

function stripChainOfThought(raw: string): string {
  if (!raw) return '';
  let text = raw;

  // Remove explicit <think> blocks often emitted by Qwen-style models
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // If the model used fenced "thinking" code blocks, drop them
  text = text.replace(/```(?:thought|thinking|plan)?[\s\S]*?```/gi, '').trim();

  // Peel off common "Final Answer" style markers, preferring the last occurrence
  const markers = [
    '**Final Answer**:',
    '**Final Answer**',
    'Final Answer:',
    'Final answer:',
    'User-facing response:',
    'User-Facing Response:',
    'Answer:',
    'Response:',
  ];
  for (const marker of markers) {
    const idx = text.lastIndexOf(marker);
    if (idx !== -1) {
      text = text.slice(idx + marker.length).trim();
      break;
    }
  }

  // Remove leftover markdown emphasis artifacts
  text = text.replace(/^\*\*\s*/g, '').replace(/\s*\*\*$/g, '').trim();

  // Collapse excessive spacing
  text = text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return text.trim();
}



async function getRelevantContext(
  userMessage: string,
  mode: Mode,
  opts?: { usingLora?: boolean; includePersonaSummary?: boolean }
): Promise<{ context: string; usedSemantic: boolean }> {
  try {
    // Load cognitive mode to enforce mode-specific retrieval behavior
    const cognitiveContext = getCognitiveModeContext();
    const cognitiveMode = cognitiveContext.mode;

    const tasks = listActiveTasks();
    const idx = getIndexStatus();
    const persona = loadPersonaCore();

    let usedSemantic = false;
    let memoryContext = '';

    // DUAL MODE: Mandatory semantic search with fallback
    if (cognitiveMode === 'dual') {
      if (!(idx as any).exists) {
        // Log warning but provide fallback context
        console.warn('[DUAL MODE] No semantic index available - memory grounding degraded');
        audit({
          level: 'warn',
          category: 'action',
          event: 'dual_mode_missing_index',
          details: { message: 'Semantic index unavailable in dual mode, using persona fallback' },
          actor: 'system',
        });
        // Fallback: provide persona summary as baseline grounding
        memoryContext = await loadPersonaFallbackContext(persona);
      } else {
        // Force semantic search in dual mode
        try {
          const hits = await queryIndex(userMessage, { topK: 8 });
          const threshold = 0.62;
          const filtered = [] as typeof hits;
          for (const h of hits) {
            if (h.score < threshold) continue;
            try {
              const raw = readFileSync(h.item.path, 'utf-8');
              const obj = JSON.parse(raw);
              const t = (obj && obj.type) ? String(obj.type) : '';
              const tags: string[] = Array.isArray(obj?.tags) ? obj.tags.map((x: any) => String(x)) : [];
              if (t === 'inner_dialogue') continue;
              if (tags.includes('reflection') || tags.includes('dream')) continue;
            } catch {}
            filtered.push(h);
          }
          if (filtered.length > 0) {
            usedSemantic = true;
            const recent = recentMemoryIds[mode] || [];
            const novel = filtered.filter(h => !recent.includes(h.item.id));
            const chosen = (novel.length > 0 ? novel : filtered).slice(0, 2);
            const lines: string[] = [];
            let used = 0;
            for (const h of chosen) {
              try {
                const raw = readFileSync(h.item.path, 'utf-8');
                const obj = JSON.parse(raw);
                const content = String(obj?.content || '').trim();
                if (!content) continue;
                const chunk = `- ${content}`;
                if (used + chunk.length > 900) break;
                lines.push(chunk);
                used += chunk.length;
                recentMemoryIds[mode] = [...recent.slice(-9), h.item.id];
              } catch {}
            }
            if (lines.length) {
              memoryContext = lines.join('\n');
            }
          } else {
            // No results above threshold - use persona fallback
            memoryContext = await loadPersonaFallbackContext(persona);
          }
        } catch (error) {
          console.error('[DUAL MODE] Semantic search failed:', error);
          memoryContext = await loadPersonaFallbackContext(persona);
        }
      }
    }
    // EMULATION MODE & AGENT MODE: Use existing semantic search logic
    else {
      if ((idx as any).exists) {
        try {
          const hits = await queryIndex(userMessage, { topK: 8 });
          const threshold = 0.62;
          const filtered = [] as typeof hits;
          for (const h of hits) {
            if (h.score < threshold) continue;
            try {
              const raw = readFileSync(h.item.path, 'utf-8');
              const obj = JSON.parse(raw);
              const t = (obj && obj.type) ? String(obj.type) : '';
              const tags: string[] = Array.isArray(obj?.tags) ? obj.tags.map((x: any) => String(x)) : [];
              if (t === 'inner_dialogue') continue;
              if (tags.includes('reflection') || tags.includes('dream')) continue;
            } catch {}
            filtered.push(h);
          }
          if (filtered.length > 0) {
            usedSemantic = true;
            const recent = recentMemoryIds[mode] || [];
            const novel = filtered.filter(h => !recent.includes(h.item.id));
            const chosen = (novel.length > 0 ? novel : filtered).slice(0, 2);
            const lines: string[] = [];
            let used = 0;
            for (const h of chosen) {
              try {
                const raw = readFileSync(h.item.path, 'utf-8');
                const obj = JSON.parse(raw);
                const content = String(obj?.content || '').trim();
                if (!content) continue;
                const chunk = `- ${content}`;
                if (used + chunk.length > 900) break;
                lines.push(chunk);
                used += chunk.length;
                recentMemoryIds[mode] = [...recent.slice(-9), h.item.id];
              } catch {}
            }
            if (lines.length) {
              memoryContext = lines.join('\n');
            }
          }
        } catch {/* ignore semantic errors and fall back */}
      }
    }

    // Fallback to keyword search if no semantic results
    // NOTE: We intentionally do not use keyword fallback for grounding decisions
    // to enforce strict memory-grounded responses (semantic index only).
    const keywordContext = '';

    // Compose context string
    let context = '';
    if (memoryContext) context += `\n\n## Relevant Memories\n${memoryContext}\n`;
    if (keywordContext) context += `\n\n## Keyword Matches (fallback):\n${keywordContext}\n`;
    // Persona context (aliases, current projects) — omitted in LoRA mode to avoid double-conditioning
    const allowPersona = opts?.includePersonaSummary !== false;
    if (allowPersona && !opts?.usingLora) {
      try {
        const aliases = (persona as any)?.identity?.aliases || [];
        const projects = (persona as any)?.context?.projects?.current || [];
        const projList = Array.isArray(projects) ? projects.map((p: any) => p.name).join(', ') : '';
        const aliasList = Array.isArray(aliases) ? aliases.join(', ') : '';
        const personaBits = [
          aliasList ? `Aliases: ${aliasList}` : '',
          projList ? `Current Projects: ${projList}` : '',
        ].filter(Boolean).join(' | ');
        if (personaBits) context += `\n\n## Persona Context\n${personaBits}\n`;
      } catch {/* ignore persona enrich failures */}
    }
    // Only include tasks if the user asks about them
    const wantsTasks = /\b(task|tasks|todo|to[- ]do|project|projects|what am i working|current work)\b/i.test(userMessage);
    if (wantsTasks && tasks.length > 0) {
      context += '\n\n## Active Tasks:\n';
      tasks.forEach((task, idx) => {
        context += `${idx + 1}. ${task.title} (${task.status}) - Priority: ${task.priority}\n`;
      });
    }



    // Log context retrieval with cognitive mode tracking
    audit({
      level: 'info',
      category: 'action',
      event: 'chat_context_retrieved',
      details: {
        query: userMessage,
        tasks: tasks.length,
        indexUsed: usedSemantic,
        cognitiveMode,
        usedFallback: cognitiveMode === 'dual' && !usedSemantic,
      },
      actor: 'system',
    });

    return { context, usedSemantic };
  } catch (error) {
    console.error('Error retrieving context:', error);
    return { context: '', usedSemantic: false };
  }
}

function initializeChat(mode: Mode, reason = false, usingLora = false, includePersonaSummary = true): void {
  let systemPrompt = '';
  if (includePersonaSummary) {
    const persona = loadPersonaCore();

    // Phase 5: Add persona cache context (long-term themes and facts)
    const personaCache = getPersonaContext();

    systemPrompt = `
You are ${persona.identity.name}, an autonomous digital personality extension.
Your role is: ${persona.identity.role}.
Your purpose is: ${persona.identity.purpose}.

Your personality is defined by these traits:
- Communication Style: ${persona.personality.communicationStyle.tone.join(', ')}.
- Values: ${persona.values.core.map(v => v.value).join(', ')}.

${personaCache ? `Long-term context:\n${personaCache}\n` : ''}
You are having a ${mode}.
    `.trim();
  } else {
    systemPrompt = mode === 'inner'
      ? 'You are having an internal dialogue with yourself.'
      : 'You are having a conversation.';
  }

  histories[mode] = [{ role: 'system', content: systemPrompt }];
}

export const GET: APIRoute = async (context) => {
  const { request, cookies } = context;
  const url = new URL(request.url);
  const message = url.searchParams.get('message') || '';
  const mode = url.searchParams.get('mode') || 'inner';
  const newSession = url.searchParams.get('newSession') === 'true';
  const audience = url.searchParams.get('audience') || undefined;
  const length = url.searchParams.get('length') || 'auto';
  const reason = url.searchParams.get('reason') === 'true';
  const depthParam = url.searchParams.get('reasoningDepth') || url.searchParams.get('reasonDepth');
  let reasoningDepth = Number(depthParam);
  if (!Number.isFinite(reasoningDepth)) {
    reasoningDepth = reason ? 1 : 0;
  }
  reasoningDepth = Math.max(0, Math.min(3, Math.round(reasoningDepth)));
  const llmRaw = url.searchParams.get('llm');
  const forceOperator = url.searchParams.get('forceOperator') === 'true' || url.searchParams.get('operator') === 'true';
  const yolo = url.searchParams.get('yolo') === 'true';
  let llm = {};
  if (llmRaw) {
    try {
      llm = JSON.parse(llmRaw);
    } catch (e) {
      console.error('Failed to parse "llm" query param:', e);
      llm = {};
    }
  }

  return handleChatRequest({ message, mode, newSession, audience, length, reason, reasoningDepth, llm, forceOperator, yolo, origin: url.origin, cookies });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const url = new URL(request.url);
  const body = await request.json();
  return handleChatRequest({ ...body, origin: url.origin, cookies });
};

async function shouldUseOperator(message: string, recentContext?: string): Promise<boolean> {
  const cognitiveContext = getCognitiveModeContext();
  const { mode } = cognitiveContext;

  const trimmed = String(message ?? '').trim();
  const lowered = trimmed.toLowerCase();
  const contextLower = (recentContext ?? '').toLowerCase();

  if (mode === 'emulation') {
    return false;
  }

  const trust = loadTrustLevel();

  if (mode === 'agent' && trust !== 'supervised_auto' && trust !== 'bounded_auto') {
    return false;
  }

  const followUpRead = contextLower.includes('assistant: i found the file') && /\bread\b/.test(lowered);
  if (followUpRead) {
    return true;
  }

  // Strong file reading indicators
  const fileReadPatterns = [
    /\b(read|show|display|view|cat|open)\s+(the\s+)?(content|contents|file)\s+(of|from|in)\b/i,
    /\b(read|show|display|view|cat)\s+.*\.(txt|md|json|csv|log|py|js|ts|jsx|tsx)\b/i,
    /\b(what|what's|whats)\s+(in|inside)\s+(the\s+)?file\b/i,
  ];

  if (fileReadPatterns.some(pattern => pattern.test(trimmed))) {
    return true;
  }

  const actionLike = /(make|create|add|log|record|track|schedule|write|edit|modify|delete|remove|move|rename|open|scan|check|mark|complete|finish|update|run|execute|start|stop|install|uninstall|build|compile|test|fetch|download|upload|commit|push|pull|git|grep|search|replace|apply|patch|launch|train|generate|summarize|index|ingest|read)\b/i;
  const looksLikePath = /\b(\.{1,2}\/[\w\-\.\/]+|\/[\w\-\.\/]+|[A-Za-z]:\\)/;
  const taskIntent = /\b(task|tasks|todo|to[- ]do|checklist|reminder)\b/i;
  const taskAction = /\b(make|create|add|log|record|track|schedule|set|mark|complete|finish|update|check)\b/i;
  const taskQuery = /\b(what|list|show|display|read|review)\b/i;
  if (taskIntent.test(trimmed) && (taskAction.test(trimmed) || taskQuery.test(trimmed))) {
    return true;
  }

  const hasActionSignals =
    followUpRead ||
    actionLike.test(trimmed) ||
    looksLikePath.test(trimmed) ||
    /https?:\/\//i.test(trimmed);
  if (!hasActionSignals) return false;

  const skills = getAvailableSkills(trust)
    .map(s => `- ${s.id}: ${s.description}`)
    .join('\n');

  // Phase 5: Add orchestrator short-term state context
  const orchestratorState = getOrchestratorContext();

  const systemPrompt = `You are a task routing system.
Your job is to decide if the user's request should be handled by a conversational AI or an autonomous operator with specific skills.

If the user is asking a question, having a conversation, or asking for information, respond with "chat".
If the user is asking to perform an action, execute a task, or do something that requires using a skill, respond with "operator".

Available operator skills:
${skills}

${orchestratorState ? `Current state:\n${orchestratorState}\n` : ''}
Respond with a single word: "chat" or "operator".`;

  const contextBlock = recentContext
    ? `Recent conversation:\n${recentContext}\n\n`
    : '';

  try {
    // Use orchestrator model for routing decisions (Phase 2: Orchestrator Separation)
    const startTime = Date.now();
    const routerResponse = await callLLM({
      role: 'orchestrator' as ModelRole,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${contextBlock}User request:\n${trimmed}` },
      ],
      cognitiveMode: mode,
      options: {
        temperature: 0.1,
      }
    });
    const orchestratorLatency = Date.now() - startTime;

    console.log(`[CHAT_REQUEST] Orchestrator model: ${routerResponse.modelId} (${orchestratorLatency}ms)`);
    const decision = routerResponse.content.trim().toLowerCase();
    audit({
      level: 'info',
      category: 'decision',
      event: 'operator_route_decision',
      details: {
        message,
        decision,
        cognitiveMode: mode,
        recentContext,
        orchestratorModel: routerResponse.modelId,
        orchestratorLatencyMs: orchestratorLatency,
        phase: 2, // Phase 2: Orchestrator Separation
      },
      actor: 'orchestrator',
    });

    let useOperator = false;
    if (decision === 'operator') {
      useOperator = true;
    } else if (decision === 'chat') {
      useOperator = false;
    } else if (decision.includes('operator') || decision.startsWith('task') || decision.includes('skills')) {
      useOperator = true;
    }

    if (!useOperator) {
      const actionPattern = /\b(read|write|create|delete|open|update|append|modify|summarize|scan|list|execute|run|schedule|mark|complete)\b/;
      const targetPattern = /\b(file|document|note|folder|directory|task|calendar|memory|dataset)\b/;
      if (actionPattern.test(lowered) && targetPattern.test(lowered)) {
        useOperator = true;
      } else if (followUpRead) {
        useOperator = true;
      }
    }

    return useOperator;
  } catch (error) {
    console.error('[shouldUseOperator] Error:', error);
    return false;
  }
}

function formatOperatorResult(result: any): string {
  let output = `### Operator Execution Report\n\n**Task:** ${result.task.goal}\n\n**Outcome:** ${result.success ? '✅ Success' : '❌ Failed'}\n`;

  // Check if operator produced a file write with conversational content (e.g., greeting response)
  // If so, extract the content to return directly to chat instead of just showing the file path
  let extractedContent = '';
  if (result.results && Array.isArray(result.results)) {
    for (const res of result.results) {
      if (res.success && res.output && res.skillId === 'fs_write') {
        // Try to read the file content if it's a conversational response
        const filePath = res.output.path;
        if (filePath && typeof filePath === 'string') {
          try {
            const content = readFileSync(path.join(ROOT, filePath), 'utf-8').trim();
            // If content looks conversational (not code/json), extract it
            if (content && !content.startsWith('{') && !content.startsWith('[')) {
              extractedContent = content;
            }
          } catch {
            // Ignore file read errors
          }
        }
      }
    }
  }

  // If we extracted conversational content, return it directly for synthesis
  if (extractedContent) {
    return extractedContent;
  }

  if (result.plan && result.plan.steps) {
    output += '\n**Plan:**\n';
    result.plan.steps.forEach((step: any) => {
      output += `- **Step ${step.id}:** ${step.description} (Skill: ${step.skillId})\n`;
    });
  }

  if (result.results) {
    output += '\n**Execution:**\n';
    result.results.forEach((res: any) => {
      output += `- **Step ${res.stepId}:** ${res.success ? 'SUCCESS' : 'FAILED'}\n`;
      if (res.error) {
        output += `  - _Error: ${res.error}_\n`;
      }
      if (res.output) {
        const items = res.output?.results;
        if (Array.isArray(items) && items.length) {
          output += '  - _Results:_\n';
          items.forEach((item: any) => {
            const title = item?.title || item?.url;
            if (title && item?.url) {
              output += `    • [${title}](${item.url})\n`;
            }
            if (item?.snippet) {
              output += `      ${item.snippet}\n`;
            }
            if (item?.image) {
              output += `      ![](${item.image})\n`;
            }
            if (Array.isArray(item?.deepLinks) && item.deepLinks.length) {
              item.deepLinks.slice(0, 4).forEach((link: any) => {
                if (link?.title && link?.url) {
                  output += `      ↳ [${link.title}](${link.url})\n`;
                }
              });
            }
          });
        } else {
          output += `  - _Output: ${JSON.stringify(res.output, null, 2)}_\n`;
        }
      }
    });
  }

  if (result.critique) {
    output += `\n**Critique:** ${result.critique.feedback}\n`;
    if (result.critique.shouldRetry) {
      output += `**Suggestion:** Retry recommended. ${result.critique.suggestedFixes || ''}\n`;
    }
  }

  if (result.error) {
    output += `\n**Error:** ${result.error}\n`;
  }

  return output;
}

async function synthesizeOperatorAnswer(model: string, userMessage: string, operatorReport: string, cognitiveMode = 'dual'): Promise<string> {
  const instructions = `You are assisting a user after an autonomous operator fetched raw data for them.
Summarize the findings in a concise, conversational way:
- Open with the direct answer (1-2 sentences) focused on the user's request.
- Follow with up to four bullet points highlighting the most relevant facts.
- If useful links are present, list them under "Links" with descriptive labels.
- Close with a short suggestion inviting the user to ask follow-up questions.
Do not mention the operator, internal steps, or unavailable data. If nothing useful was found, say so plainly.`;

  const prompt = [
    { role: 'system', content: instructions },
    {
      role: 'user',
      content: `The user asked:\n${userMessage}\n\nHere is the raw operator report:\n${operatorReport}`,
    },
  ];

  const summaryResp = await callLLM({
    role: 'summarizer',
    messages: prompt as RouterMessage[],
    cognitiveMode,
    options: {
      temperature: 0.35,
      topP: 0.9,
      repeatPenalty: 1.2,
      maxTokens: 768,
    },
  });

  const text = summaryResp.content.trim();
  return text || operatorReport;
}

async function handleChatRequest({ message, mode = 'inner', newSession = false, audience, length, reason, reasoningDepth, llm, forceOperator = false, yolo = false, origin, cookies }: { message: string; mode?: string; newSession?: boolean; audience?: string; length?: string; reason?: boolean; reasoningDepth?: number; llm?: any; forceOperator?: boolean; yolo?: boolean; origin?: string; cookies?: any }) {
  console.log(`\n[CHAT_REQUEST] Received: "${message}"`);
  const m: Mode = mode === 'conversation' ? 'conversation' : 'inner';

  let model;
  let usingLora = false;
  let includePersonaSummary = true;
  const depthCandidate = Number(reasoningDepth);
  let depthLevel = Number.isFinite(depthCandidate) ? Math.max(0, Math.min(3, Math.round(depthCandidate))) : undefined;
  if (depthLevel === undefined) {
    depthLevel = reason ? 1 : 0;
  }
  const reasoningRequested = depthLevel > 0;

  try {
    const agentConfigPath = path.join(ROOT, 'etc', 'agent.json');
    if (!existsSync(agentConfigPath)) {
      throw new Error('agent.json not found in etc/');
    }
    const config = JSON.parse(await fs.readFile(agentConfigPath, 'utf-8'));
    if (!config.model) {
      throw new Error('Default model not configured in etc/agent.json');
    }

    includePersonaSummary = config.includePersonaSummary !== false;

    // Use adapter if enabled, otherwise use base model
    if (config.useAdapter && config.adapterModel) {
      model = config.adapterModel;
      usingLora = true;
    } else {
      model = config.model;
      usingLora = false;
    }
  } catch (error) {
    console.error('[persona_chat] Fatal: Could not determine model.', error);
    return new Response(JSON.stringify({ error: 'Could not determine model: ' + (error as Error).message }), { status: 500 });
  }

  // Check if user is authenticated (has session cookie)
  const sessionCookie = cookies?.get('mh_session');
  const isAuthenticated = !!sessionCookie;

  // Load cognitive mode context once for consistent routing and memory policies
  // For unauthenticated users, force emulation mode (read-only, safe for guests)
  const cognitiveContext = getCognitiveModeContext();
  const cognitiveMode: 'dual' | 'agent' | 'emulation' = isAuthenticated ? cognitiveContext.mode : 'emulation';
  const allowMemoryWrites = isAuthenticated ? cognitiveContext.allowMemoryWrites : false;

  const trimmedMessage = String(message ?? '').trim();
  const recentDialogue = histories[m]
    .filter(turn => turn.role !== 'system')
    .slice(-8)
    .map(turn => {
      if (turn.role === 'assistant') return `Assistant: ${turn.content}`;
      if (turn.role === 'user') return `User: ${turn.content}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
  const routingContext = trimmedMessage
    ? [recentDialogue, `User: ${trimmedMessage}`].filter(Boolean).join('\n')
    : recentDialogue;

  // Decide whether to use the operator or the chat model
  // Optimization: Skip expensive shouldUseOperator check if not authenticated or in emulation
  // This avoids unnecessary LLM calls for routing decisions
  let wouldUseOperator = false;
  if (isAuthenticated && cognitiveMode !== 'emulation') {
    wouldUseOperator = forceOperator || await shouldUseOperator(message ?? '', routingContext);
  }
  const useOperator = isAuthenticated && wouldUseOperator;

  console.log(`[CHAT_REQUEST] Cognitive Mode: ${cognitiveMode}`);
  console.log(`[CHAT_REQUEST] Authenticated: ${isAuthenticated}`);
  console.log(`[CHAT_REQUEST] Routing decision: ${useOperator ? 'OPERATOR' : 'PERSONA'}`);

  // Log and notify when operator is blocked due to lack of authentication
  if (wouldUseOperator && !isAuthenticated) {
    console.log('[CHAT_REQUEST] Operator routing blocked - user not authenticated');

    // Add a system message to inform the user about limited capabilities
    const authWarning = `_Note: I'm currently in **Emulation Mode** (read-only) because you're not authenticated. Some features like file operations, task management, and code execution require authentication. [Learn more about modes](/user-guide) or contact the owner for access._`;

    histories[m].push({
      role: 'system',
      content: authWarning
    });
  }

  if (useOperator) {
    // Stream the operator response
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let isClosed = false;

        // Safe enqueue that checks if controller is still open
        const push = (type: string, data: any) => {
          if (!isClosed) {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
            } catch (error) {
              // Controller was closed, ignore
              isClosed = true;
            }
          }
        };

        try {
          lastUserTurn[m] = { text: trimmedMessage, ts: Date.now() };
          histories[m].push({ role: 'user', content: message });

          // Build operator context with recent conversation history
          let operatorContext = '';

          // Include last 3-5 turns for context (excluding current message which is already in 'goal')
          const recentHistory = histories[m].slice(-6, -1); // Last 5 messages before current
          if (recentHistory.length > 0) {
            operatorContext += 'Recent conversation:\n';
            for (const turn of recentHistory) {
              const label = turn.role === 'user' ? 'User' : turn.role === 'assistant' ? 'Assistant' : 'System';
              operatorContext += `${label}: ${turn.content.substring(0, 500)}\n`;
            }
            operatorContext += '\n';
          }

          // Add routing context if provided
          if (routingContext) {
            operatorContext += `Routing context: ${routingContext}\n`;
          }

          const operatorUrl = origin ? new URL('/api/operator', origin).toString() : '/api/operator';

          // Build headers with session cookie to pass through authentication
          const operatorHeaders: Record<string, string> = {
            'Content-Type': 'application/json'
          };

          // Forward session cookie for authentication
          const sessionCookie = cookies.get('mh_session');
          if (sessionCookie) {
            operatorHeaders['Cookie'] = `mh_session=${sessionCookie.value}`;
          }

          const operatorResponse = await fetch(operatorUrl, {
            method: 'POST',
            headers: operatorHeaders,
            body: JSON.stringify({
              goal: message,
              context: operatorContext,
              autoApprove: true,
              profile: (typeof audience === 'string' && ['files','git','web'].includes(audience) ? audience : undefined),
              yolo,
              allowMemoryWrites, // Pass cognitive mode memory write permission to operator
            }),
          });

          if (!operatorResponse.ok) {
            throw new Error(`Operator API failed with status ${operatorResponse.status}`);
          }

          const result = await operatorResponse.json();
          const formattedResult = formatOperatorResult(result);

          // Preserve the raw operator data in history for follow-up questions
          histories[m].push({ role: 'system', content: `## Operator Findings\n${formattedResult}` });

          let synthesized = formattedResult;
          try {
            synthesized = await synthesizeOperatorAnswer(model, message, formattedResult, cognitiveMode);
          } catch (err) {
            console.error('[persona_chat] Failed to synthesize operator answer:', err);
          }

          // Audit operator execution with cognitive mode tracking
          audit({
            level: 'info',
            category: 'action',
            event: 'chat_assistant',
            details: { mode: m, content: synthesized, cognitiveMode, usedOperator: true },
            actor: 'assistant'
          });

          push('answer', { response: synthesized });

          histories[m].push({ role: 'assistant', content: synthesized });
          lastAssistantReplies[m].push(synthesized);
        } catch (error) {
          console.error('[persona_chat] Operator error:', error);
          audit({
            level: 'error',
            category: 'action',
            event: 'chat_assistant_error',
            details: { mode: m, error: (error as Error).message, cognitiveMode, usedOperator: true },
            actor: 'assistant'
          });
          push('error', { message: (error as Error).message });
        } finally {
          isClosed = true;
          try {
            controller.close();
          } catch (error) {
            // Already closed, ignore
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  // If not using the operator, proceed with the normal chat flow
  console.log(`[${new Date().toISOString()}] handleChatRequest: mode=${m}, history length=${histories[m].length}`);
  console.log(JSON.stringify(histories[m], null, 2));

  if (newSession || histories[m].length === 0) {
    initializeChat(m, reasoningRequested, usingLora, includePersonaSummary);
    if (!message) {
      return new Response(JSON.stringify({ response: 'Chat session initialized.' }), { status: 200 });
    }
  }

  if (!message) {
    return new Response(JSON.stringify({ error: 'Message is required' }), { status: 400 });
  }

  // Debounce duplicate user messages within a short window
  const nowTs = Date.now();
  const lastU = lastUserTurn[m];
  if (lastU && lastU.text === trimmedMessage && (nowTs - lastU.ts) < 1500) {
    const lastA = (lastAssistantReplies[m][lastAssistantReplies[m].length - 1]) || '';
    return new Response(JSON.stringify({ response: lastA, duplicate: true }), { status: 200 });
  }
  lastUserTurn[m] = { text: trimmedMessage, ts: nowTs };

  if (m === 'conversation' && audience && forceOperator) {
    histories[m].push({ role: 'system', content: `Audience/context: ${audience}` });
  }

  // Get relevant context (memories + tasks) for this message
  const { context: contextInfo, usedSemantic } = await getRelevantContext(message, m, { usingLora, includePersonaSummary });
  console.log(`[CHAT_REQUEST] Context retrieved. Length: ${contextInfo.length}, Semantic Search: ${usedSemantic}`);

  // Add user message and context to history
  // NOTE: The context is added as a separate system message to make it clear to the model what is the user's message and what is context.
  // Appending the context to the user's message can confuse the model and cause it to repeat the context.
  if (contextInfo) {
    histories[m].push({ role: 'system', content: `## Context\n${contextInfo}` });
  }
  histories[m].push({ role: 'user', content: message });

  try {
    const temperature = m === 'inner' ? 0.5 : 0.6;
    // Merge LLM options from request (clamped)
    const llmOpts: Record<string, number> = {};
    try {
      const rawCtx = Number(llm?.num_ctx);
      if (Number.isFinite(rawCtx) && rawCtx > 0) {
        const num_ctx = Math.max(4096, Math.min(131072, rawCtx));
        llmOpts.num_ctx = num_ctx;
      }
      const rawPredict = Number(llm?.num_predict);
      if (Number.isFinite(rawPredict) && rawPredict > 0) {
        const num_predict = Math.max(256, Math.min(8192, rawPredict));
        llmOpts.num_predict = num_predict;
      }
    } catch {}

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let isClosed = false;

        // Safe enqueue that checks if controller is still open
        const push = (type: string, data: any) => {
          if (!isClosed) {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
            } catch (error) {
              // Controller was closed, ignore
              isClosed = true;
            }
          }
        };

        const emitReasoningStage = (stage: string, round: number, content: string) => {
          if (!content) return;
          push('reasoning', {
            stage,
            round,
            content,
          });
        };

        try {
          // Remove all artificial token limits - let the model decide output length
          // Only set a reasonable max to prevent runaway generation
          if (llmOpts && (llmOpts as any).num_predict == null) {
            (llmOpts as any).num_predict = 4096; // Generous limit
          }

          let assistantResponse = '';
          if (reasoningRequested) {
            const plannerConfigs = [
              { instruction: 'Provide 2-3 concise steps focused on the immediate response.', maxTokens: 512 },
              { instruction: 'Provide 4-6 detailed steps with rationale, assumptions, and potential risks.', maxTokens: 1024 },
              { instruction: 'Deliberate thoroughly: explore alternatives, flag uncertainties, and outline contingency or evaluation criteria.', maxTokens: 1536 },
            ];
            const configIdx = Math.max(1, Math.min(depthLevel, plannerConfigs.length));
            const planConfig = plannerConfigs[configIdx - 1];
            const basePlannerPrompt = `You are my private planner. Your task is to create a detailed and thoughtful plan to answer the user's last message.\n\n1.  **Analyze the User's Intent:** What is the user *really* asking? What is their underlying goal?\n2.  **Review the Context:** Consider the recent conversation history and any provided memories or context. How does this information influence the response?\n3.  **Identify Ambiguities:** Are there any parts of the user's message that are unclear or could be interpreted in multiple ways?\n4.  **Formulate a Strategy:** Based on your analysis, create a step-by-step plan to construct a comprehensive and helpful response.\n5.  **Output:** Respond ONLY as JSON with keys: \`analysis\` (your analysis of the user's intent and context), \`ambiguities\` (any identified ambiguities), and \`plan\` (an array of detailed steps to take). Do NOT include the final answer.`;
            const roundsRequested = Math.max(1, Math.min(depthLevel, 3));
            let guidance = '';
            let finalPlan = '';
            let finalCritique = '';
            let finalConfidence = 0;
            let roundsCompleted = 0;

            for (let round = 1; round <= roundsRequested; round++) {
              roundsCompleted = round;
              const plannerPrompt = guidance
                ? `${basePlannerPrompt}\n6.  **Refinement Requirement:** Address the following critique when producing the updated plan.\n${guidance}`
                : `${basePlannerPrompt}\n6.  **Depth Requirement:** ${planConfig?.instruction ?? 'Provide the best possible plan.'}`;

              const plannerOpts: Record<string, number> = { ...llmOpts };
              if (planConfig?.maxTokens) {
                plannerOpts.num_predict = planConfig.maxTokens;
              } else if (plannerOpts.num_predict == null) {
                plannerOpts.num_predict = 768;
              }
              const plannerTemperature = Math.min(temperature, round >= 3 ? 0.3 : configIdx >= 3 ? 0.35 : configIdx === 2 ? 0.4 : 0.5);

              const planResp = await callLLM({
                role: 'planner',
                messages: [...histories[m], { role: 'system', content: plannerPrompt }] as RouterMessage[],
                cognitiveMode: mode,
                options: {
                  temperature: plannerTemperature,
                  topP: 0.9,
                  repeatPenalty: 1.3,
                  maxTokens: plannerOpts.num_predict,
                },
              });
              const rawPlan = planResp.content.trim();
              let planSummary = '';
              try {
                const obj = JSON.parse(rawPlan);
                const analysis = Array.isArray(obj?.analysis)
                  ? obj.analysis.map((a: any) => String(a)).join('\n')
                  : typeof obj?.analysis === 'string'
                    ? obj.analysis
                    : '';
                const ambiguitiesList = Array.isArray(obj?.ambiguities)
                  ? obj.ambiguities.map((a: any) => String(a))
                  : obj?.ambiguities
                    ? [String(obj.ambiguities)]
                    : [];
                const steps: string[] = Array.isArray(obj?.plan)
                  ? obj.plan.map((s: any) => String(s))
                  : [];
                const considerations: string[] = Array.isArray(obj?.considerations)
                  ? obj.considerations.map((c: any) => String(c))
                  : [];
                const sections: string[] = [];
                if (analysis) sections.push(`Analysis:\n${analysis}`);
                if (ambiguitiesList.length) sections.push(`Ambiguities:\n${ambiguitiesList.map(a => `- ${a}`).join('\n')}`);
                if (steps.length) sections.push(`Plan:\n${steps.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}`);
                if (considerations.length) sections.push(`Considerations:\n${considerations.map(c => `- ${c}`).join('\n')}`);
                planSummary = sections.filter(Boolean).join('\n\n');
              } catch {
                planSummary = rawPlan.slice(0, 2000);
              }
              if (!planSummary) {
                planSummary = rawPlan.slice(0, 2000);
              }

              finalPlan = planSummary;
              emitReasoningStage('plan', round, planSummary);

              const criticPrompt = `You are a rigorous critique assistant evaluating the plan below for a conversational AI. Review the plan carefully. Respond ONLY as JSON with keys: \`approve\` (boolean), \`issues\` (array of strings describing problems), \`questions\` (array of follow-up questions or missing info), \`suggestions\` (array of improvements), and \`confidence\` (number between 0 and 1).\n\n[PLAN]\n${planSummary}`;
              const criticResp = await callLLM({
                role: 'planner',
                messages: [...histories[m], { role: 'system', content: criticPrompt }] as RouterMessage[],
                cognitiveMode: mode,
                options: {
                  temperature: Math.min(0.4, plannerTemperature),
                  topP: 0.8,
                  repeatPenalty: 1.3,
                  maxTokens: llmOpts.num_predict,
                },
              });
              const rawCritique = criticResp.content.trim();
              let critiqueSummary = rawCritique;
              let guidanceForNext = '';
              let approve = false;
              let criticConfidence = 0;
              try {
                const obj = JSON.parse(rawCritique);
                approve = Boolean(obj?.approve);
                criticConfidence = Number(obj?.confidence) || 0;
                const issues: string[] = Array.isArray(obj?.issues) ? obj.issues.map((s: any) => String(s)) : [];
                const questions: string[] = Array.isArray(obj?.questions) ? obj.questions.map((s: any) => String(s)) : [];
                const suggestions: string[] = Array.isArray(obj?.suggestions) ? obj.suggestions.map((s: any) => String(s)) : [];
                const sections: string[] = [];
                if (issues.length) sections.push(`Issues:\n${issues.map(i => `- ${i}`).join('\n')}`);
                if (questions.length) sections.push(`Questions:\n${questions.map(q => `- ${q}`).join('\n')}`);
                if (suggestions.length) sections.push(`Suggestions:\n${suggestions.map(s => `- ${s}`).join('\n')}`);
                sections.push(`Confidence: ${(criticConfidence * 100).toFixed(0)}%`);
                critiqueSummary = sections.join('\n\n') || rawCritique;
                guidanceForNext = sections.filter(Boolean).join('\n');
                if (!guidanceForNext) {
                  guidanceForNext = rawCritique;
                }
              } catch {
                guidanceForNext = rawCritique;
              }

              finalCritique = critiqueSummary.slice(0, 2000);
              finalConfidence = Math.max(finalConfidence, Number.isFinite(criticConfidence) ? criticConfidence : 0);
              emitReasoningStage('critique', round, critiqueSummary);

              if (approve || round === roundsRequested) {
                emitReasoningStage('status', round, approve ? 'Critic approved the plan.' : 'Reached configured depth; proceeding with final answer.');
                break;
              }

              guidance = guidanceForNext;
            }

            const answerGuard = `Use the following internal plan silently to craft the final answer. Do not mention that you planned or show any steps. Provide only the final answer.`;
            const guidanceNote = finalCritique
              ? `\n\n[CRITIQUE NOTES]\n${finalCritique}`
              : '';
            const finalPlanSection = finalPlan ? `\n\n[APPROVED PLAN]\n${finalPlan}` : '';
            const answerResp = await callLLM({
              role: 'persona',
              messages: [...histories[m], { role: 'system', content: `${answerGuard}${finalPlanSection}${guidanceNote}` }] as RouterMessage[],
              cognitiveMode: mode,
              options: {
                temperature,
                topP: 0.9,
                repeatPenalty: 1.3,
                maxTokens: llmOpts.num_predict,
              },
            });
            assistantResponse = answerResp.content || '';
          } else {
            // Resolve and log the persona model being used
            const personaModel = resolveModelForCognitiveMode(cognitiveMode, 'persona' as ModelRole);
            console.log(`[CHAT_REQUEST] Persona model: ${personaModel.id}`);

            // Let the model work naturally without extra instructions
            // Use role-based routing for persona responses
            const llmResponse = await callLLM({
              role: 'persona' as ModelRole,
              messages: histories[m].map(h => ({
                role: h.role as 'system' | 'user' | 'assistant',
                content: h.content
              })),
              cognitiveMode,
              options: {
                temperature,
                topP: 0.9,
                repeatPenalty: 1.3,
                ...llmOpts
              }
            });

            // For backward compatibility, construct response object matching ollama.chat format
            const response = {
              message: {
                content: llmResponse.content,
                thinking: (llmResponse as any).thinking || ''
              },
              model: llmResponse.model,
            };

            // Handle Qwen3 thinking mode: content is in thinking field, actual answer often isn't separated
            const thinking = (response.message as any).thinking || '';
            const content = response.message.content || '';

            console.log('[persona_chat] DEBUG - thinking length:', thinking.length, 'content length:', content.length);

            // If reasoning is enabled and we have thinking, stream it first
            if (reasoningRequested && thinking) {
              emitReasoningStage('thought', 1, thinking);
            }

          const extractFromThinking = (text: string) => {
            const trimmed = (text || '').trim();
            if (!trimmed) return '';

            // Prefer the last quoted span – Qwen often frames the final reply this way
            const quotedMatches = Array.from(trimmed.matchAll(/["“”](.+?)["“”]/gs))
              .map(m => (m[1] || '').trim())
              .filter(Boolean);
            if (quotedMatches.length > 0) {
              return quotedMatches[quotedMatches.length - 1];
            }

            // Fall back to the last non-empty paragraph
            const paragraphs = trimmed.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
            if (paragraphs.length > 0) {
              const lastPara = paragraphs[paragraphs.length - 1];
              if (lastPara) return lastPara;
            }

            // As a final fallback, take the last couple of sentences
            const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
            return sentences.slice(-3).join(' ').trim();
          };

          const looksLikeReasoning = (text: string) => {
            const sample = (text || '').toLowerCase();
            if (!sample) return true;
            const reasoningPhrases = [
              'the user',
              'i should',
              'i need to',
              'let me',
              'plan',
              'strategy',
              'consider',
              'decide',
              'maybe i',
            ];
            const hasSecondPerson = /\byou\b/i.test(text);
            const hasGreeting = /\b(hello|hi|hey|greetings)\b/i.test(text);
            const looksLikeSentence = /[.!?]["”']?$/.test(text.trim());
            const isReasoningHint = reasoningPhrases.some(p => sample.includes(p));
            // Treat it as reasoning if we detect planning language without an obvious second-person answer
            return isReasoningHint && !hasSecondPerson && !hasGreeting ? true : !looksLikeSentence;
          };

            // Qwen3 puts everything in thinking, content is often empty
            // When content is empty, we need to extract the answer from thinking
            if (content) {
              assistantResponse = content;
            } else if (thinking) {
              // Try to extract the final answer from thinking text
              let extracted = extractFromThinking(thinking);

              // If it still looks like planning notes, run a focused follow-up pass
              if (!extracted || looksLikeReasoning(extracted)) {
                const followMessages = [
                  {
                    role: 'system',
                    content: 'You are finalizing a conversation response. The user should only see the finished reply. Do not reveal any internal reasoning or mention that you were given it.',
                  },
                  {
                    role: 'user',
                    content: `User message:\n"${message}"\n\nInternal reasoning you produced earlier:\n${thinking}\n\nNow respond to the user. Output only the final reply text they should see.`,
                  },
                ] as typeof histories[m];
                try {
                  const followResp = await callLLM({
                    role: 'persona',
                    messages: followMessages as RouterMessage[],
                    cognitiveMode: mode,
                    options: {
                      temperature,
                      topP: 0.9,
                      repeatPenalty: 1.3,
                      maxTokens: llmOpts.num_predict,
                    },
                  });

                  extracted = followResp.content || extracted;
                } catch (followError) {
                  console.error('[persona_chat] follow-up extraction failed:', followError);
                }
              }

              assistantResponse = extracted || thinking; // Final fallback to full thinking
            } else {
              assistantResponse = ''; // No response at all
            }

            console.log('[persona_chat] DEBUG - final assistantResponse:', assistantResponse.slice(0, 100));
          }

          // No brevity rules - let the model output freely
          const cleanedAssistant = stripChainOfThought(assistantResponse);
          assistantResponse = cleanedAssistant.length > 0 ? cleanedAssistant : '';

          // Store history
          histories[m].pop();
          histories[m].push({ role: 'user', content: message });
          histories[m].push({ role: 'assistant', content: assistantResponse });

          // Capture event and audit (only if mode allows writes)
          // Note: cognitiveMode and allowMemoryWrites are already loaded at function start
          if (allowMemoryWrites) {
            const eventType = m === 'inner' ? 'inner_dialogue' : 'conversation';
            const responseForMemory = assistantResponse && assistantResponse.trim().length > 0 ? assistantResponse.trim() : undefined;
            const userPath = captureEvent(`Me: "${message}"`, {
              type: eventType,
              tags: ['chat', m],
              response: responseForMemory,
            });
            const userRelPath = path.relative(ROOT, userPath);

            audit({
              level: 'info',
              category: 'action',
              event: 'chat_assistant',
              details: { mode: m, content: assistantResponse, cognitiveMode, usedOperator: false },
              actor: 'assistant'
            });

            // Stream the final answer with save confirmation
            push('answer', { response: assistantResponse, saved: { userRelPath } });
          } else {
            // Emulation mode: return response without saving
            audit({
              level: 'info',
              category: 'action',
              event: 'chat_assistant_readonly',
              details: { mode: m, content: assistantResponse, cognitiveMode, usedOperator: false },
              actor: 'assistant'
            });

            // Stream the final answer without save confirmation
            push('answer', { response: assistantResponse });
          }

        } catch (error) {
          console.error('Persona chat stream error:', error);
          audit({
            level: 'error',
            category: 'action',
            event: 'chat_assistant_error',
            details: { mode: m, error: (error as Error).message, cognitiveMode, usedOperator: false },
            actor: 'assistant'
          });
          push('error', { message: (error as Error).message });
        } finally {
          isClosed = true;
          try {
            controller.close();
          } catch (error) {
            // Already closed, ignore
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    histories[m].pop();
    console.error('Persona chat API error:', error);
    audit({
      level: 'error',
      category: 'action',
      event: 'chat_handler_error',
      details: { mode: m, error: (error as Error).message, cognitiveMode },
      actor: 'system'
    });
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
  }
};
