# Curiosity System - Implementation Plan

**Last Updated:** 2025-11-11
**Status:** Ready for Implementation
**Estimated Effort:** 12-16 hours (3-4 implementation sessions)

---

## Executive Summary

This plan adapts the curiosity system design to MetaHuman OS's existing architecture patterns. After reviewing the codebase, I've identified all the integration points, reusable patterns, and specific files that need modification.

**Key Insight:** Your system already has 90% of the infrastructure needed - we're primarily adding a new agent, a config layer, and UI controls that follow your established patterns.

---

## Phase 1: Storage & Configuration (2-3 hours)

### 1.1 Path Extensions

**File:** `packages/core/src/paths.ts`

**Action:** Add curiosity paths to `getProfilePaths()` function (around line 34-77):

```typescript
// Add after audioArchive (line 66):
curiosity: path.join(profileRoot, 'memory', 'curiosity'),
curiosityQuestions: path.join(profileRoot, 'memory', 'curiosity', 'questions'),
curiosityQuestionsPending: path.join(profileRoot, 'memory', 'curiosity', 'questions', 'pending'),
curiosityQuestionsAnswered: path.join(profileRoot, 'memory', 'curiosity', 'questions', 'answered'),
curiosityFacts: path.join(profileRoot, 'memory', 'curiosity', 'facts'),
curiosityResearch: path.join(profileRoot, 'memory', 'curiosity', 'research'),
curiosityConfig: path.join(profileRoot, 'etc', 'curiosity.json'),
```

**Verification:** Run `pnpm tsc` to ensure no type errors.

---

### 1.2 Config Schema Definition

**File:** `packages/core/src/config.ts` (add new section at end)

**Action:** Add curiosity config types and loaders:

```typescript
// ============================================================================
// Curiosity Configuration
// ============================================================================

export interface CuriosityConfig {
  maxOpenQuestions: number;          // 0 = off, 1 = gentle, 3 = chatty
  researchMode: 'off' | 'local' | 'web';
  inactivityThresholdSeconds: number; // How long to wait before asking
  questionTopics: string[];           // Filter topics (empty = all)
  minTrustLevel: string;              // Minimum trust to ask questions
}

let curiosityConfigCache: CuriosityConfig | null = null;

export function loadCuriosityConfig(): CuriosityConfig {
  if (curiosityConfigCache) return curiosityConfigCache;

  const config = loadUserConfig<CuriosityConfig>('curiosity.json', getDefaultCuriosityConfig());
  curiosityConfigCache = config;
  return config;
}

export function saveCuriosityConfig(config: CuriosityConfig): void {
  saveUserConfig('curiosity.json', config);
  curiosityConfigCache = config; // Update cache
}

export function getDefaultCuriosityConfig(): CuriosityConfig {
  return {
    maxOpenQuestions: 1,
    researchMode: 'local',
    inactivityThresholdSeconds: 1800, // 30 minutes
    questionTopics: [],
    minTrustLevel: 'observe'
  };
}
```

**Verification:** Build and ensure exports are available: `pnpm --filter @metahuman/core tsc`

---

### 1.3 Memory Directory Scaffolding

**File:** `packages/cli/src/mh-init.ts` (or create initialization script)

**Action:** Add curiosity directories to initialization:

```typescript
// Add to directory creation section (find where memory/ dirs are created):
'memory/curiosity',
'memory/curiosity/questions',
'memory/curiosity/questions/pending',
'memory/curiosity/questions/answered',
'memory/curiosity/facts',
'memory/curiosity/research',
```

**Manual Step:** For existing installations, run:
```bash
mkdir -p memory/curiosity/{questions/{pending,answered},facts,research}
mkdir -p profiles/*/memory/curiosity/{questions/{pending,answered},facts,research}
```

---

## Phase 2: API Layer (2-3 hours)

### 2.1 Curiosity Config API

**File:** `apps/site/src/pages/api/curiosity-config.ts` (NEW FILE)

**Pattern:** Follow `apps/site/src/pages/api/boredom.ts` exactly

```typescript
import type { APIRoute } from 'astro';
import { loadCuriosityConfig, saveCuriosityConfig } from '@metahuman/core';
import { withAuthenticatedContext } from '@metahuman/core';

export const GET: APIRoute = async ({ cookies }) => {
  return withAuthenticatedContext(cookies, async (userContext) => {
    try {
      const config = loadCuriosityConfig();
      return new Response(JSON.stringify(config), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: (error as Error).message }), {
        status: 500
      });
    }
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  return withAuthenticatedContext(cookies, async (userContext) => {
    try {
      const updates = await request.json();
      const current = loadCuriosityConfig();

      // Merge updates (validate fields)
      const newConfig = {
        ...current,
        ...updates,
        maxOpenQuestions: Math.max(0, Math.min(5, updates.maxOpenQuestions ?? current.maxOpenQuestions))
      };

      saveCuriosityConfig(newConfig);

      return new Response(JSON.stringify({ success: true, config: newConfig }), {
        status: 200
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: (error as Error).message }), {
        status: 500
      });
    }
  });
};
```

**Verification:** Test with:
```bash
curl http://localhost:4321/api/curiosity-config
curl -X POST http://localhost:4321/api/curiosity-config -H "Content-Type: application/json" -d '{"maxOpenQuestions": 2}'
```

---

### 2.2 Extend Memories API

**File:** `apps/site/src/pages/api/memories_all.ts`

**Action:** Add curiosity collections to response (around line 50-100):

```typescript
// After loading dreams/reflections, add:
const curiosityQuestionsDir = path.join(paths.curiosityQuestions);
const curiosityQuestions: any[] = [];

if (fs.existsSync(curiosityQuestionsDir)) {
  const pendingDir = path.join(curiosityQuestionsDir, 'pending');
  const answeredDir = path.join(curiosityQuestionsDir, 'answered');

  [pendingDir, answeredDir].forEach(dir => {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      files.forEach(file => {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
          curiosityQuestions.push({
            ...content,
            relPath: path.relative(paths.root, path.join(dir, file)),
            status: dir.includes('pending') ? 'pending' : 'answered'
          });
        } catch {}
      });
    }
  });
}

// In return statement, add:
curiosityQuestions: curiosityQuestions.sort((a, b) =>
  new Date(b.askedAt).getTime() - new Date(a.askedAt).getTime()
)
```

**Verification:** Check `/api/memories_all` response includes `curiosityQuestions` array.

---

### 2.3 Extend Status API

**File:** `apps/site/src/pages/api/status.ts`

**Action:** Add curiosity stats to status payload (around where agent stats are collected):

```typescript
// Add after agent status section:
const curiosityConfig = loadCuriosityConfig();
const pendingQuestionsDir = path.join(paths.curiosityQuestionsPending);
let openQuestionCount = 0;
let lastAskedTimestamp: string | null = null;

if (fs.existsSync(pendingQuestionsDir)) {
  const files = fs.readdirSync(pendingQuestionsDir).filter(f => f.endsWith('.json'));
  openQuestionCount = files.length;

  // Find most recent question
  files.forEach(file => {
    try {
      const q = JSON.parse(fs.readFileSync(path.join(pendingQuestionsDir, file), 'utf-8'));
      if (!lastAskedTimestamp || q.askedAt > lastAskedTimestamp) {
        lastAskedTimestamp = q.askedAt;
      }
    } catch {}
  });
}

// In return payload:
curiosity: {
  enabled: curiosityConfig.maxOpenQuestions > 0,
  openQuestions: openQuestionCount,
  maxOpenQuestions: curiosityConfig.maxOpenQuestions,
  lastAsked: lastAskedTimestamp,
  researchMode: curiosityConfig.researchMode
}
```

---

## Phase 3: Curiosity Service Agent (4-5 hours)

### 3.1 Agent Implementation

**File:** `brain/agents/curiosity-service.ts` (NEW FILE)

**Pattern:** Clone structure from `brain/agents/reflector.ts`

```typescript
#!/usr/bin/env tsx
/**
 * Curiosity Service Agent
 *
 * Monitors user inactivity and asks thoughtful questions when appropriate.
 * Respects maxOpenQuestions limit and trust/autonomy policies.
 *
 * MULTI-USER: Processes all users sequentially with isolated contexts.
 */

import {
  callLLM,
  type RouterMessage,
  captureEvent,
  searchMemory,
  paths,
  audit,
  loadPersonaCore,
  acquireLock,
  isLocked,
  initGlobalLogger,
  listUsers,
  withUserContext,
  loadCuriosityConfig,
  readAutonomyConfig,
  loadTrustLevel
} from '@metahuman/core';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

/**
 * Check if user is currently active (implementation depends on your activity tracking)
 */
async function isUserActive(username: string): Promise<boolean> {
  // TODO: Integrate with activity-ping API or check last interaction timestamp
  // For now, assume inactive if no chat in last N minutes
  const config = loadCuriosityConfig();
  const activityFile = path.join(paths.state, 'last-activity.json');

  if (!fsSync.existsSync(activityFile)) return false;

  try {
    const data = JSON.parse(await fs.readFile(activityFile, 'utf-8'));
    const lastActivity = new Date(data.timestamp);
    const now = new Date();
    const elapsedSeconds = (now.getTime() - lastActivity.getTime()) / 1000;
    return elapsedSeconds < config.inactivityThresholdSeconds;
  } catch {
    return false;
  }
}

/**
 * Count pending (unanswered) questions
 */
async function countPendingQuestions(): Promise<number> {
  const pendingDir = paths.curiosityQuestionsPending;

  if (!fsSync.existsSync(pendingDir)) {
    await fs.mkdir(pendingDir, { recursive: true });
    return 0;
  }

  const files = await fs.readdir(pendingDir);
  return files.filter(f => f.endsWith('.json')).length;
}

/**
 * Generate a curiosity question for a single user
 */
async function generateUserQuestion(username: string): Promise<boolean> {
  console.log(`[curiosity-service] Processing user: ${username}`);

  const config = loadCuriosityConfig();
  const trust = loadTrustLevel();
  const autonomy = readAutonomyConfig();

  // Check if user has permission (min trust level)
  const trustLevels = ['observe', 'suggest', 'trusted', 'supervised_auto', 'bounded_auto'];
  const currentTrustIdx = trustLevels.indexOf(trust);
  const requiredTrustIdx = trustLevels.indexOf(config.minTrustLevel);

  if (currentTrustIdx < requiredTrustIdx) {
    console.log(`[curiosity-service] Trust level ${trust} below minimum ${config.minTrustLevel}, skipping`);
    return false;
  }

  // Check inactivity
  const active = await isUserActive(username);
  if (active) {
    console.log(`[curiosity-service] User ${username} is active, skipping question`);
    return false;
  }

  // Check question limit
  const pendingCount = await countPendingQuestions();
  if (pendingCount >= config.maxOpenQuestions) {
    console.log(`[curiosity-service] Already have ${pendingCount} pending questions (max ${config.maxOpenQuestions}), skipping`);
    return false;
  }

  // Sample recent memories for context
  const recentMemories = await sampleRecentMemories(5);
  if (recentMemories.length === 0) {
    console.log(`[curiosity-service] No memories to base questions on yet`);
    return false;
  }

  // Generate question via LLM
  const persona = loadPersonaCore();
  const memoriesText = recentMemories.map((m, i) => `${i + 1}. ${m.content}`).join('\n');

  const systemPrompt = `
You are ${persona.identity.name}'s curiosity engine. Based on recent memories, ask ONE thoughtful question that could deepen understanding or uncover interesting connections.

Guidelines:
- Keep questions open-ended and engaging
- Focus on "why" and "how" over "what"
- Connect memories to broader patterns
- Avoid yes/no questions
- Keep under 100 words
- Be genuinely curious, not formulaic
  `.trim();

  const userPrompt = `
Recent memories:
${memoriesText}

What thoughtful question could deepen ${persona.identity.humanName || 'your'} understanding of these experiences or patterns?
  `.trim();

  const messages: RouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  try {
    const response = await callLLM({
      role: 'persona',
      messages,
      options: { temperature: 0.8 }
    });

    const question = response.content.trim();
    if (!question) {
      console.log(`[curiosity-service] LLM returned empty question`);
      return false;
    }

    // Store question
    const questionId = `cur-q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const questionData = {
      id: questionId,
      question,
      askedAt: new Date().toISOString(),
      seedMemories: recentMemories.map(m => m.__file).filter(Boolean),
      status: 'pending',
      trustLevel: trust,
      autonomyMode: autonomy.mode
    };

    const questionFile = path.join(paths.curiosityQuestionsPending, `${questionId}.json`);
    await fs.mkdir(paths.curiosityQuestionsPending, { recursive: true });
    await fs.writeFile(questionFile, JSON.stringify(questionData, null, 2));

    // Emit as episodic event
    captureEvent(question, {
      type: 'curiosity_question',
      tags: ['curiosity', 'question', 'idle'],
      metadata: {
        curiosity: {
          questionId,
          topic: 'general',
          seedMemories: questionData.seedMemories,
          askedAt: questionData.askedAt
        }
      }
    });

    audit({
      category: 'action',
      level: 'info',
      message: 'Curiosity service asked a question',
      actor: 'curiosity-service',
      metadata: {
        questionId,
        question: question.substring(0, 100),
        pendingCount: pendingCount + 1,
        trust,
        autonomy: autonomy.mode
      }
    });

    console.log(`[curiosity-service] Asked: "${question.substring(0, 60)}..."`);
    return true;

  } catch (error) {
    console.error(`[curiosity-service] Error generating question:`, error);
    audit({
      category: 'system',
      level: 'error',
      message: `Curiosity service error: ${(error as Error).message}`,
      actor: 'curiosity-service',
      metadata: { error: (error as Error).stack, username }
    });
    return false;
  }
}

/**
 * Sample recent memories (simple version - can enhance with weighted selection later)
 */
async function sampleRecentMemories(count: number): Promise<any[]> {
  const episodicDir = paths.episodic;
  if (!fsSync.existsSync(episodicDir)) return [];

  const memories: any[] = [];
  const now = Date.now();
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // Last 7 days

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
          const timestamp = new Date(content.timestamp).getTime();
          const age = now - timestamp;

          if (age < maxAgeMs && content.type !== 'curiosity_question' && content.type !== 'reflection') {
            memories.push({ ...content, __file: fullPath });
          }
        } catch {}
      }
    }
  }

  await walk(episodicDir);

  // Sort by recency and take top N
  memories.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return memories.slice(0, count);
}

/**
 * Main entry point (multi-user)
 */
async function run() {
  initGlobalLogger('curiosity-service');

  // Single-instance guard
  let lock;
  try {
    if (isLocked('agent-curiosity')) {
      console.log('[curiosity-service] Another instance is already running. Exiting.');
      return;
    }
    lock = acquireLock('agent-curiosity');
  } catch {
    console.log('[curiosity-service] Failed to acquire lock. Exiting.');
    return;
  }

  console.log('[curiosity-service] Starting curiosity cycle (multi-user)...');

  audit({
    category: 'action',
    level: 'info',
    message: 'Curiosity service starting cycle',
    actor: 'curiosity-service'
  });

  try {
    const users = listUsers();
    console.log(`[curiosity-service] Found ${users.length} users to process`);

    let questionsAsked = 0;

    for (const user of users) {
      try {
        const asked = await withUserContext(
          { userId: user.id, username: user.username, role: user.role },
          async () => {
            return await generateUserQuestion(user.username);
          }
        );

        if (asked) questionsAsked++;
      } catch (error) {
        console.error(`[curiosity-service] Failed to process user ${user.username}:`, (error as Error).message);
      }
    }

    console.log(`[curiosity-service] Cycle complete. Asked ${questionsAsked} questions across ${users.length} users.`);

    audit({
      category: 'action',
      level: 'info',
      message: 'Curiosity service completed cycle',
      actor: 'curiosity-service',
      metadata: { questionsAsked, userCount: users.length }
    });

  } finally {
    lock.release();
  }
}

run().catch(console.error);
```

**Verification:**
```bash
chmod +x brain/agents/curiosity-service.ts
tsx brain/agents/curiosity-service.ts
```

---

### 3.2 Register Agent in Scheduler

**File:** `etc/agents.json`

**Action:** Add curiosity agent configuration:

```json
{
  "curiosity": {
    "enabled": true,
    "interval": 1800,
    "script": "brain/agents/curiosity-service.ts",
    "description": "Asks thoughtful questions during idle periods"
  }
}
```

**Note:** If using scheduler-service, it will auto-detect and run the agent.

---

## Phase 4: UI Integration (3-4 hours)

### 4.1 System Settings UI

**File:** `apps/site/src/components/SystemSettings.svelte`

**Action:** Add curiosity controls after Mind Wandering section (around line 323):

```svelte
<!-- Add after BoredomControl -->
<!-- Curiosity Level Control -->
<div class="setting-group">
  <label class="setting-label">Curiosity Level</label>
  <div class="curiosity-control-container">
    <div class="curiosity-slider-wrapper">
      <input
        type="range"
        min="0"
        max="3"
        bind:value={curiosityLevel}
        on:change={saveCuriositySettings}
        class="curiosity-slider"
      />
      <div class="curiosity-labels">
        <span>Off</span>
        <span>Gentle</span>
        <span>Moderate</span>
        <span>Chatty</span>
      </div>
    </div>
    <p class="curiosity-description">
      {curiosityLevelDescriptions[curiosityLevel]}
    </p>

    <!-- Research Mode Toggle -->
    {#if curiosityLevel > 0}
      <div class="research-mode-controls">
        <label class="field-label">Research Mode</label>
        <select bind:value={curiosityResearchMode} on:change={saveCuriositySettings} class="logging-select">
          <option value="off">Off - Questions only</option>
          <option value="local">Local - Use existing memories</option>
          <option value="web">Web - Allow web searches</option>
        </select>
      </div>
    {/if}
  </div>
</div>

<script>
// Add to script section:
let curiosityLevel = 1;
let curiosityResearchMode: 'off' | 'local' | 'web' = 'local';

const curiosityLevelDescriptions = [
  'Curiosity disabled - no questions will be asked',
  'Gentle - 1 question at a time, infrequent prompts',
  'Moderate - Up to 2 concurrent questions',
  'Chatty - Up to 3 concurrent questions, shorter intervals'
];

async function loadCuriositySettings() {
  try {
    const res = await fetch('/api/curiosity-config');
    if (res.ok) {
      const data = await res.json();
      curiosityLevel = data.maxOpenQuestions;
      curiosityResearchMode = data.researchMode || 'local';
    }
  } catch (err) {
    console.error('[SystemSettings] Error loading curiosity config:', err);
  }
}

async function saveCuriositySettings() {
  try {
    const res = await fetch('/api/curiosity-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxOpenQuestions: curiosityLevel,
        researchMode: curiosityResearchMode
      })
    });
    if (!res.ok) throw new Error('Failed to save curiosity settings');
  } catch (err) {
    console.error('[SystemSettings] Error saving curiosity config:', err);
  }
}

// Call in onMount:
onMount(async () => {
  // ... existing code ...
  loadCuriositySettings();
});
</script>

<style>
.curiosity-slider-wrapper {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.curiosity-slider {
  width: 100%;
  accent-color: #7c3aed;
}

.curiosity-labels {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  font-size: 0.75rem;
  color: #6b7280;
}

:global(.dark) .curiosity-labels {
  color: #9ca3af;
}

.curiosity-description {
  font-size: 0.875rem;
  color: #4b5563;
  margin: 0.5rem 0 0 0;
}

:global(.dark) .curiosity-description {
  color: #9ca3af;
}

.research-mode-controls {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
```

---

### 4.2 Memory Tab UI

**File:** `apps/site/src/components/CenterContent.svelte`

**Action:** Add curiosity tab to memory browser (around line 45-48):

```typescript
// Update memoryTab type (around line 45):
let memoryTab: 'episodic' | 'reflections' | 'tasks' | 'curated' | 'ai-ingestor' | 'audio' | 'dreams' | 'curiosity' = 'episodic'

// Add to data loading section (around line 98-140):
let curiosityQuestionsTab: Array<{ id: string; question: string; status: string; askedAt: string; relPath: string }> = []

// In loadEvents() function, add:
const curiosityQuestions = Array.isArray(data.curiosityQuestions) ? data.curiosityQuestions : [];
curiosityQuestionsTab = curiosityQuestions;
```

**Add UI rendering** (find the memory tab switcher around line 400-500 and add):

```svelte
<!-- Add to tab buttons -->
<button
  class="tab-btn {memoryTab === 'curiosity' ? 'active' : ''}"
  on:click={() => memoryTab = 'curiosity'}
>
  Curiosity ({curiosityQuestionsTab.length})
</button>

<!-- Add tab content panel -->
{:else if memoryTab === 'curiosity'}
  <div class="memory-list">
    <div class="section-header">
      <h3>Curiosity Questions</h3>
      <p class="section-description">
        Questions generated during idle time to deepen understanding
      </p>
    </div>
    {#if curiosityQuestionsTab.length === 0}
      <div class="empty-state">
        <p>No curiosity questions yet. Adjust settings to enable.</p>
      </div>
    {:else}
      {#each curiosityQuestionsTab as question}
        <div class="memory-card curiosity-question {question.status}">
          <div class="memory-header">
            <span class="memory-icon">{question.status === 'pending' ? '❓' : '✅'}</span>
            <span class="memory-timestamp">{formatTimestamp(question.askedAt)}</span>
            <span class="memory-status {question.status}">{question.status}</span>
          </div>
          <div class="memory-content">
            <p class="question-text">{question.question}</p>
          </div>
          <div class="memory-actions">
            <button
              class="btn-edit"
              on:click={() => openEditor(question.relPath, 'Question')}
              title="View question details"
            >
              View
            </button>
            {#if question.status === 'pending'}
              <button
                class="btn-reply"
                on:click={() => replyToQuestion(question.id)}
                title="Reply to this question"
              >
                Reply
              </button>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>
```

**Add helper functions**:

```typescript
function replyToQuestion(questionId: string) {
  // Navigate to chat and set focus
  activeView.set('chat');
  // TODO: Implement questionId passing to chat interface
  console.log(`[CenterContent] Reply to question: ${questionId}`);
}
```

**Add styles**:

```svelte
<style>
.curiosity-question {
  border-left: 3px solid #7c3aed;
}

.curiosity-question.pending {
  background: rgba(124, 58, 237, 0.05);
}

:global(.dark) .curiosity-question.pending {
  background: rgba(167, 139, 250, 0.08);
}

.question-text {
  font-style: italic;
  color: #4b5563;
  line-height: 1.6;
}

:global(.dark) .question-text {
  color: #d1d5db;
}

.memory-status {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
}

.memory-status.pending {
  background: #fef3c7;
  color: #92400e;
}

:global(.dark) .memory-status.pending {
  background: rgba(251, 191, 36, 0.2);
  color: #fde68a;
}

.memory-status.answered {
  background: #d1fae5;
  color: #065f46;
}

:global(.dark) .memory-status.answered {
  background: rgba(16, 185, 129, 0.2);
  color: #6ee7b7;
}

.btn-reply {
  padding: 0.375rem 0.75rem;
  background: #7c3aed;
  color: white;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-reply:hover {
  background: #6d28d9;
}
</style>
```

---

### 4.3 Chat Interface Integration (Optional - Phase 2)

**Note:** This implements click-to-reply functionality. Can be deferred to Phase 2.

**File:** `apps/site/src/components/ChatInterface.svelte`

**Changes:**
1. Add state variable for focused question ID (around line 43):
```typescript
let focusedQuestionId: string | null = null;
```

2. Modify `/api/persona_chat` call to include questionId (around line 614):
```typescript
if (focusedQuestionId) {
  params.set('questionId', focusedQuestionId);
}
```

3. Add cancel button when question is focused (around input area, line 1125):
```svelte
{#if focusedQuestionId}
  <div class="replying-to-banner">
    <span>Replying to Curiosity Question</span>
    <button on:click={() => focusedQuestionId = null}>Cancel</button>
  </div>
{/if}
```

---

## Phase 5: Answer Detection & Lifecycle (2-3 hours)

### 5.1 Answer Watcher Agent

**File:** `brain/agents/curiosity-answer-watcher.ts` (NEW FILE - OPTIONAL)

**Purpose:** Watches for user messages that answer pending questions

```typescript
#!/usr/bin/env tsx
/**
 * Curiosity Answer Watcher
 *
 * Periodically checks for episodic events with answerTo metadata
 * and marks corresponding questions as answered.
 */

import {
  paths,
  audit,
  acquireLock,
  initGlobalLogger,
  listUsers,
  withUserContext
} from '@metahuman/core';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

async function processAnswers(username: string): Promise<number> {
  const episodicDir = paths.episodic;
  const pendingDir = paths.curiosityQuestionsPending;
  const answeredDir = paths.curiosityQuestionsAnswered;

  if (!fsSync.existsSync(episodicDir) || !fsSync.existsSync(pendingDir)) {
    return 0;
  }

  await fs.mkdir(answeredDir, { recursive: true });

  let answersProcessed = 0;

  // Walk episodic events looking for answerTo metadata
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
          const questionId = content.metadata?.curiosity?.answerTo;

          if (questionId) {
            // Find matching question
            const questionFile = path.join(pendingDir, `${questionId}.json`);
            if (fsSync.existsSync(questionFile)) {
              // Move to answered
              const question = JSON.parse(await fs.readFile(questionFile, 'utf-8'));
              question.status = 'answered';
              question.answeredAt = new Date().toISOString();
              question.answerEvent = path.relative(paths.root, fullPath);

              await fs.writeFile(
                path.join(answeredDir, `${questionId}.json`),
                JSON.stringify(question, null, 2)
              );
              await fs.unlink(questionFile);

              answersProcessed++;

              audit({
                category: 'action',
                level: 'info',
                message: 'Curiosity question answered',
                actor: 'curiosity-answer-watcher',
                metadata: { questionId, answerEvent: question.answerEvent }
              });
            }
          }
        } catch {}
      }
    }
  }

  await walk(episodicDir);
  return answersProcessed;
}

async function run() {
  initGlobalLogger('curiosity-answer-watcher');

  const lock = acquireLock('agent-curiosity-answer-watcher');

  try {
    const users = listUsers();
    let totalAnswers = 0;

    for (const user of users) {
      const answers = await withUserContext(
        { userId: user.id, username: user.username, role: user.role },
        async () => processAnswers(user.username)
      );
      totalAnswers += answers;
    }

    if (totalAnswers > 0) {
      console.log(`[curiosity-answer-watcher] Processed ${totalAnswers} answers`);
    }
  } finally {
    lock.release();
  }
}

run().catch(console.error);
```

**Register in agents.json:**
```json
"curiosity-answer-watcher": {
  "enabled": true,
  "interval": 300,
  "script": "brain/agents/curiosity-answer-watcher.ts",
  "description": "Marks curiosity questions as answered"
}
```

---

### 5.2 Persona Chat Integration

**File:** `apps/site/src/pages/api/persona_chat.ts`

**Action:** Add questionId handling (around line 100-150 where user message is captured):

```typescript
// Extract questionId from request (around where other params are extracted):
const questionId = url.searchParams.get('questionId');

// When capturing user message (around line 875):
const userMemoryMetadata: any = {
  conversationId: sessionId,
  cognitiveMode,
  usedOperator: false
};

if (questionId) {
  userMemoryMetadata.curiosity = {
    answerTo: questionId
  };
}

// Then use this metadata in captureEvent call
```

---

## Phase 6: Testing & QA (2 hours)

### 6.1 Unit Testing Checklist

- [ ] Config loads with defaults when file missing
- [ ] Config saves and reads back correctly
- [ ] Paths resolve correctly in both root and profile contexts
- [ ] API endpoints return proper JSON structure
- [ ] Agent respects maxOpenQuestions limit
- [ ] Agent respects trust level guards
- [ ] Questions are stored in correct directory
- [ ] Answer detection moves files correctly

### 6.2 Integration Testing

```bash
# Test 1: Config API
curl http://localhost:4321/api/curiosity-config
curl -X POST http://localhost:4321/api/curiosity-config \
  -H "Content-Type: application/json" \
  -d '{"maxOpenQuestions": 2, "researchMode": "local"}'

# Test 2: Run agent manually
tsx brain/agents/curiosity-service.ts

# Test 3: Check questions were created
ls -la memory/curiosity/questions/pending/

# Test 4: Check UI
# Navigate to System Settings -> verify slider appears
# Navigate to Memory -> verify Curiosity tab appears
```

### 6.3 End-to-End Workflow

1. Set curiosity level to "Gentle" (1) in System Settings
2. Wait for inactivity threshold (or manually run agent)
3. Verify question appears in Memory > Curiosity tab
4. Click "Reply" button → should navigate to chat
5. Send a message answering the question
6. Run answer watcher: `tsx brain/agents/curiosity-answer-watcher.ts`
7. Verify question moved from pending to answered
8. Check Memory tab shows status change

---

## Phase 7: Optional Enhancements (Future)

### Research Sister Agent

**File:** `brain/agents/curiosity-researcher.ts`

**Purpose:** Performs local file scans or web research to enrich questions

**Trust Requirements:**
- Local research: `trusted` or higher
- Web research: `supervised_auto` or higher

**Pattern:** Similar to curiosity-service but:
1. Reads pending questions
2. Executes searches based on question topics
3. Stores findings in `memory/curiosity/research/`
4. Links research to original question

---

## Architecture Decisions & Rationale

### Why Per-Profile Storage?
Your system uses `withUserContext()` for multi-user isolation. All curiosity data is stored per-profile to maintain this isolation.

### Why Not Global Config?
Following your boredom-service pattern, curiosity is per-user because different users may want different levels of interaction.

### Why Simple Question Lifecycle?
Start with binary pending/answered state. Can add states like "partial", "dismissed", "expired" later based on usage.

### Why LLM-Generated Questions?
Aligns with your reflector pattern - questions should be contextual and personalized, not templated.

---

## Migration Path for Existing Installations

```bash
# 1. Create directories
for profile in profiles/*/; do
  mkdir -p "$profile/memory/curiosity/questions/"{pending,answered}
  mkdir -p "$profile/memory/curiosity/"{facts,research}
  echo '{"maxOpenQuestions":1,"researchMode":"local","inactivityThresholdSeconds":1800,"questionTopics":[],"minTrustLevel":"observe"}' > "$profile/etc/curiosity.json"
done

# 2. Install dependencies (if any new ones needed)
pnpm install

# 3. Build core package
pnpm --filter @metahuman/core tsc

# 4. Make agents executable
chmod +x brain/agents/curiosity-*.ts

# 5. Restart dev server
pnpm dev
```

---

## Success Metrics

### Functional Completeness
- [ ] Config API responds correctly
- [ ] Questions generated when inactive
- [ ] Questions respect max limit
- [ ] UI shows questions in Memory tab
- [ ] UI slider controls work
- [ ] Answers detected and filed
- [ ] Multi-user isolation works

### Code Quality
- [ ] Follows existing patterns (reflector, boredom-service)
- [ ] TypeScript type-safe throughout
- [ ] Error handling in all async operations
- [ ] Audit events emitted for all actions
- [ ] Lock guards prevent duplicate runs

### User Experience
- [ ] Settings are intuitive
- [ ] Questions are thoughtful and relevant
- [ ] No performance impact on chat
- [ ] Mobile UI remains functional

---

## Next Steps

1. **Start with Phase 1** (Storage & Config) - safest foundation
2. **Test Phase 1** thoroughly before moving to Phase 2
3. **Implement Phase 3** (Agent) after API layer is stable
4. **UI last** - allows backend iteration without breaking UI

**Recommended Session Breakdown:**
- Session 1: Phases 1-2 (paths, config, APIs)
- Session 2: Phase 3 (agent implementation)
- Session 3: Phase 4 (UI integration)
- Session 4: Phases 5-6 (answer detection, testing)

---

## Questions for Consideration

1. **Auto-expiration:** Should unanswered questions expire after N days?
2. **Question topics:** Whitelist/blacklist certain memory types?
3. **Notification style:** Should questions appear in chat or just Memory tab?
4. **Research depth:** How much local file scanning is acceptable?
5. **Multi-turn answers:** Track partial answers across multiple messages?

---

## File Checklist

**New Files to Create:**
- [ ] `brain/agents/curiosity-service.ts`
- [ ] `brain/agents/curiosity-answer-watcher.ts` (optional)
- [ ] `apps/site/src/pages/api/curiosity-config.ts`

**Existing Files to Modify:**
- [ ] `packages/core/src/paths.ts` (add curiosity paths)
- [ ] `packages/core/src/config.ts` (add curiosity config types)
- [ ] `apps/site/src/pages/api/memories_all.ts` (add curiosity collection)
- [ ] `apps/site/src/pages/api/status.ts` (add curiosity stats)
- [ ] `apps/site/src/pages/api/persona_chat.ts` (add questionId handling)
- [ ] `apps/site/src/components/SystemSettings.svelte` (add UI controls)
- [ ] `apps/site/src/components/CenterContent.svelte` (add Memory tab)
- [ ] `apps/site/src/components/ChatInterface.svelte` (optional reply feature)
- [ ] `etc/agents.json` (register agents)

---

**Total Estimated Time:** 12-16 hours across 4 focused sessions

**Risk Level:** Low - all patterns exist, minimal breaking changes

**Rollback Strategy:** All changes are additive. Disable via `maxOpenQuestions: 0` in config.
