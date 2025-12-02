#!/usr/bin/env tsx
/**
 * Psychoanalyzer Agent
 *
 * Reviews recent episodic memories using the psychotherapist model,
 * extracts personality insights, and incrementally updates persona files.
 * Creates archives for version tracking and change history.
 *
 * Usage: ./bin/mh agent run psychoanalyzer
 */

import fs from 'node:fs';
import path from 'node:path';
import { storageClient, systemPaths, ROOT } from '@metahuman/core';
import { callLLM } from '@metahuman/core/model-router';
import { audit } from '@metahuman/core/audit';

interface Config {
  enabled: boolean;
  memorySelection: {
    strategy: string;
    daysBack: number;
    maxMemories: number;
    minMemories: number;
    excludeTypes: string[];
    priorityTags: string[];
  };
  analysis: {
    model: string;
    temperature: number;
    focusAreas: string[];
    confidenceThreshold: number;
  };
  updateStrategy: {
    mode: string;
    preserveUserEdits: boolean;
    mergeStrategy: string;
    fields: Record<string, boolean>;
  };
  reconciliation: {
    enabled: boolean;
    removeStaleGoals: boolean;
    removeStaleInterests: boolean;
    updateGoalStatuses: boolean;
    removeContradictedValues: boolean;
    removeUnusedHeuristics: boolean;
  };
  archival: {
    enabled: boolean;
    path: string;
    format: string;
    keepVersions: number;
    generateChangelog: boolean;
    changelogPath: string;
  };
  notifications: {
    createMemory: boolean;
    memoryType: string;
    title: string;
    includeChangeSummary: boolean;
  };
}

interface Memory {
  id: string;
  timestamp: string;
  content: string;
  type: string;
  tags?: string[];
  entities?: string[];
  importance?: number;
}

interface AnalysisResult {
  insights: {
    values?: Array<{ value: string; description: string; evidence: string[] }>;
    goals?: {
      shortTerm?: Array<{ goal: string; status: string }>;
      midTerm?: Array<{ goal: string; status: string }>;
      longTerm?: Array<{ goal: string; status: string }>;
    };
    interests?: string[];
    communicationPatterns?: string[];
    decisionHeuristics?: Array<{ signal: string; response: string; evidence: string }>;
    personalityShifts?: string[];
    aesthetic?: string[];
    motifs?: string[];
  };
  reconciliation?: {
    staleGoals?: Array<{ goal: string; timeframe: string; reason: string }>;
    staleInterests?: Array<{ interest: string; reason: string }>;
    updatedGoals?: Array<{ goal: string; timeframe: string; newStatus: string; reason: string }>;
    removedValues?: Array<{ value: string; reason: string }>;
    removedHeuristics?: Array<{ signal: string; reason: string }>;
  };
  confidence: number;
  summary: string;
  memoriesAnalyzed: number;
  dateRange: { start: string; end: string };
}

async function loadConfig(): Promise<Config> {
  const configPath = path.join(systemPaths.etc, 'psychoanalyzer.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Psychoanalyzer configuration not found at etc/psychoanalyzer.json');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

async function selectMemories(config: Config): Promise<Memory[]> {
  console.log('🔍 Selecting memories for analysis...');

  const episodicResult = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
  const episodicPath = episodicResult.success && episodicResult.path ? episodicResult.path : null;
  if (!episodicPath) {
    throw new Error('Cannot resolve episodic memory path');
  }
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - config.memorySelection.daysBack);

  const memories: Memory[] = [];
  const years = fs.readdirSync(episodicPath).filter(f => f.match(/^\d{4}$/));

  for (const year of years.sort().reverse()) {
    const yearPath = path.join(episodicPath, year);
    const files = fs.readdirSync(yearPath)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first

    for (const file of files) {
      if (memories.length >= config.memorySelection.maxMemories) break;

      const filePath = path.join(yearPath, file);
      try {
        const memory: Memory = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // Filter by date
        const memoryDate = new Date(memory.timestamp);
        if (memoryDate < cutoffDate) continue;

        // Exclude certain types
        if (config.memorySelection.excludeTypes.includes(memory.type)) continue;

        // Prioritize memories with important tags
        const hasPriorityTag = memory.tags?.some(tag =>
          config.memorySelection.priorityTags.includes(tag)
        );

        if (hasPriorityTag) {
          memories.unshift(memory); // Add to beginning
        } else {
          memories.push(memory);
        }
      } catch (err) {
        console.error(`Failed to read memory ${file}:`, err);
      }
    }

    if (memories.length >= config.memorySelection.maxMemories) break;
  }

  // Trim to max
  const selected = memories.slice(0, config.memorySelection.maxMemories);

  console.log(`✅ Selected ${selected.length} memories from last ${config.memorySelection.daysBack} days`);

  if (selected.length < config.memorySelection.minMemories) {
    throw new Error(
      `Insufficient memories: found ${selected.length}, need at least ${config.memorySelection.minMemories}`
    );
  }

  return selected;
}

async function analyzeMemories(memories: Memory[], config: Config): Promise<AnalysisResult> {
  console.log('🧠 Analyzing memories with psychotherapist model...');

  // Load current persona for reconciliation
  const personaResult = storageClient.resolvePath({ category: 'config', subcategory: 'persona', relativePath: 'core.json' });
  const personaPath = personaResult.success && personaResult.path ? personaResult.path : null;
  if (!personaPath) {
    throw new Error('Cannot resolve persona core path');
  }
  const currentPersona = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));

  // Prepare memory transcript for analysis
  const transcript = memories.map((m, i) =>
    `[${i + 1}] ${m.timestamp} (${m.type})\n${m.content}\n${m.tags ? `Tags: ${m.tags.join(', ')}` : ''}`
  ).join('\n\n---\n\n');

  const dateRange = {
    start: memories[memories.length - 1].timestamp,
    end: memories[0].timestamp,
  };

  const analysisPrompt = `You are a psychotherapist analyzing episodic memories to extract personality insights and reconcile them with an existing persona profile.

# Current Persona (for reconciliation)

${JSON.stringify({
  values: currentPersona.values?.core || [],
  goals: currentPersona.goals || {},
  interests: currentPersona.personality?.interests || [],
  communicationPatterns: currentPersona.personality?.communicationStyle?.tone || [],
  decisionHeuristics: currentPersona.decisionHeuristics || [],
  aesthetic: currentPersona.personality?.aesthetic || [],
  motifs: currentPersona.writingStyle?.motifs || []
}, null, 2)}

# Recent Memories to Analyze (${memories.length} total, last ${config.memorySelection.daysBack} days)

${transcript}

# Analysis Task

You have TWO jobs:

## 1. Extract New Insights

Based on these recent memories, identify NEW patterns in:
${config.analysis.focusAreas.map(area => `- ${area.replace(/_/g, ' ')}`).join('\n')}

## 2. Reconcile Existing Persona

Compare the current persona (above) with recent memories and identify:
- **Stale goals**: Goals from persona that show NO evidence in recent memories (likely abandoned or completed)
- **Updated goals**: Goals that have changed status (e.g., active → completed, planning → abandoned)
- **Stale interests**: Interests from persona that never appear in recent memories (likely faded)
- **Removed values**: Values that contradict recent behavior patterns
- **Removed heuristics**: Decision patterns that are no longer used

# Output Format

Return a JSON object with this structure:

{
  "insights": {
    "values": [{ "value": "string", "description": "string", "evidence": ["evt-id1", "evt-id2"] }],
    "goals": {
      "shortTerm": [{ "goal": "string", "status": "active|completed|paused" }],
      "midTerm": [{ "goal": "string", "status": "active|planning|completed" }],
      "longTerm": [{ "goal": "string", "status": "aspirational|ongoing|completed" }]
    },
    "interests": ["interest1", "interest2"],
    "communicationPatterns": ["pattern1", "pattern2"],
    "decisionHeuristics": [{ "signal": "string", "response": "string", "evidence": "evt-id" }],
    "personalityShifts": ["shift1", "shift2"],
    "aesthetic": ["aesthetic1", "aesthetic2"],
    "motifs": ["motif1", "motif2"]
  },
  "reconciliation": {
    "staleGoals": [{ "goal": "exact text from persona", "timeframe": "shortTerm|midTerm|longTerm", "reason": "why it's stale" }],
    "staleInterests": [{ "interest": "exact text from persona", "reason": "why it's stale" }],
    "updatedGoals": [{ "goal": "exact text from persona", "timeframe": "shortTerm|midTerm|longTerm", "newStatus": "completed|abandoned|paused", "reason": "evidence from memories" }],
    "removedValues": [{ "value": "exact text from persona", "reason": "why it contradicts recent behavior" }],
    "removedHeuristics": [{ "signal": "exact text from persona", "reason": "why it's no longer used" }]
  },
  "confidence": 0.85,
  "summary": "Brief summary of key findings and changes"
}

**Critical Instructions:**
- For reconciliation fields, use EXACT text from the current persona (copy-paste the goal/interest/value text exactly)
- Only flag items as stale if there's ZERO evidence in recent memories
- Be conservative with removals - only remove items that clearly contradict recent behavior
- Focus on patterns, not one-off events
- If recent memories are too sparse to judge staleness, omit that reconciliation field
- Reference specific memory IDs in evidence fields`;

  const messages = [{ role: 'user' as const, content: analysisPrompt }];

  const response = await callLLM({
    role: 'psychotherapist',
    messages,
    options: { temperature: config.analysis.temperature },
  });

  // Parse JSON from response content
  let analysisResult: AnalysisResult;
  try {
    // callLLM returns an object with content property
    const content = typeof response === 'string' ? response : response.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const parsed = JSON.parse(jsonMatch[0]);
    analysisResult = {
      ...parsed,
      memoriesAnalyzed: memories.length,
      dateRange,
    };
  } catch (err) {
    console.error('Failed to parse analysis response:', err);
    console.log('Raw response:', response);
    throw new Error('Failed to parse psychotherapist analysis');
  }

  console.log(`✅ Analysis complete (confidence: ${analysisResult.confidence.toFixed(2)})`);

  return analysisResult;
}

async function archiveCurrentPersona(config: Config): Promise<string> {
  if (!config.archival.enabled) {
    console.log('⏭️  Archival disabled, skipping...');
    return '';
  }

  console.log('📦 Archiving current persona...');

  const personaResult = storageClient.resolvePath({ category: 'config', subcategory: 'persona', relativePath: 'core.json' });
  const personaPath = personaResult.success && personaResult.path ? personaResult.path : null;
  if (!personaPath) {
    throw new Error('Cannot resolve persona core path');
  }
  const currentPersona = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));

  // Create archives directory in user's profile
  // Use dirname of personaCore to get profile-specific persona directory
  const personaDir = path.dirname(personaPath);
  const archivePath = path.join(personaDir, config.archival.path);
  fs.mkdirSync(archivePath, { recursive: true });

  // Generate archive filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); // YYYY-MM-DD-HHmmss
  const archiveFile = path.join(archivePath, `${timestamp}.json`);

  // Save archive
  fs.writeFileSync(archiveFile, JSON.stringify(currentPersona, null, 2), 'utf-8');

  // Cleanup old archives if exceeds keepVersions
  const archives = fs.readdirSync(archivePath)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  if (archives.length > config.archival.keepVersions) {
    const toDelete = archives.slice(config.archival.keepVersions);
    for (const old of toDelete) {
      fs.unlinkSync(path.join(archivePath, old));
    }
    console.log(`🗑️  Cleaned up ${toDelete.length} old archives`);
  }

  console.log(`✅ Archived to ${path.relative(ROOT, archiveFile)}`);

  return archiveFile;
}

async function updatePersona(
  analysis: AnalysisResult,
  config: Config
): Promise<{ updated: any; changes: string[] }> {
  console.log('📝 Updating persona with new insights...');

  if (analysis.confidence < config.analysis.confidenceThreshold) {
    console.log(`⚠️  Confidence ${analysis.confidence.toFixed(2)} below threshold ${config.analysis.confidenceThreshold}, skipping update`);
    return { updated: null, changes: [] };
  }

  const personaResult = storageClient.resolvePath({ category: 'config', subcategory: 'persona', relativePath: 'core.json' });
  const personaPath = personaResult.success && personaResult.path ? personaResult.path : null;
  if (!personaPath) {
    throw new Error('Cannot resolve persona core path');
  }
  const currentPersona = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));
  const changes: string[] = [];

  // Update each field based on configuration
  const insights = analysis.insights;

  // Values
  if (config.updateStrategy.fields['values.core'] && insights.values) {
    const existingValues = currentPersona.values?.core || [];
    const newValues = insights.values.filter(v =>
      !existingValues.some((ev: any) => ev.value === v.value)
    );

    if (newValues.length > 0) {
      currentPersona.values = currentPersona.values || {};
      currentPersona.values.core = [
        ...existingValues,
        ...newValues.map((v, i) => ({
          value: v.value,
          description: v.description,
          priority: existingValues.length + i + 1,
        })),
      ];
      changes.push(`Added ${newValues.length} new core value(s): ${newValues.map(v => v.value).join(', ')}`);
    }
  }

  // Goals
  if (config.updateStrategy.fields.goals && insights.goals) {
    currentPersona.goals = currentPersona.goals || { shortTerm: [], midTerm: [], longTerm: [] };

    for (const [timeframe, goals] of Object.entries(insights.goals)) {
      if (!goals) continue;
      const existing = currentPersona.goals[timeframe] || [];
      const newGoals = goals.filter((g: any) =>
        !existing.some((eg: any) => eg.goal === g.goal)
      );

      if (newGoals.length > 0) {
        currentPersona.goals[timeframe] = [...existing, ...newGoals];
        changes.push(`Added ${newGoals.length} ${timeframe} goal(s)`);
      }
    }
  }

  // Interests
  if (config.updateStrategy.fields['personality.interests'] && insights.interests) {
    currentPersona.personality = currentPersona.personality || {};
    const existing = currentPersona.personality.interests || [];
    const newInterests = insights.interests.filter(i => !existing.includes(i));

    if (newInterests.length > 0) {
      currentPersona.personality.interests = [...existing, ...newInterests];
      changes.push(`Added ${newInterests.length} new interest(s): ${newInterests.join(', ')}`);
    }
  }

  // Aesthetic
  if (config.updateStrategy.fields['personality.aesthetic'] && insights.aesthetic) {
    currentPersona.personality = currentPersona.personality || {};
    const existing = currentPersona.personality.aesthetic || [];
    const newAesthetic = insights.aesthetic.filter(a => !existing.includes(a));

    if (newAesthetic.length > 0) {
      currentPersona.personality.aesthetic = [...existing, ...newAesthetic];
      changes.push(`Added ${newAesthetic.length} aesthetic preference(s): ${newAesthetic.join(', ')}`);
    }
  }

  // Communication patterns
  if (config.updateStrategy.fields['personality.communicationStyle'] && insights.communicationPatterns) {
    currentPersona.personality = currentPersona.personality || {};
    currentPersona.personality.communicationStyle = currentPersona.personality.communicationStyle || {};
    const existing = currentPersona.personality.communicationStyle.tone || [];
    const newPatterns = insights.communicationPatterns.filter(p => !existing.includes(p));

    if (newPatterns.length > 0) {
      currentPersona.personality.communicationStyle.tone = [...existing, ...newPatterns];
      changes.push(`Added ${newPatterns.length} communication pattern(s)`);
    }
  }

  // Decision heuristics
  if (config.updateStrategy.fields.decisionHeuristics && insights.decisionHeuristics) {
    currentPersona.decisionHeuristics = currentPersona.decisionHeuristics || [];
    const existingSignals = currentPersona.decisionHeuristics.map((h: any) => h.signal);
    const newHeuristics = insights.decisionHeuristics.filter(h =>
      !existingSignals.includes(h.signal)
    );

    if (newHeuristics.length > 0) {
      currentPersona.decisionHeuristics = [...currentPersona.decisionHeuristics, ...newHeuristics];
      changes.push(`Added ${newHeuristics.length} decision heuristic(s)`);
    }
  }

  // Writing style motifs
  if (config.updateStrategy.fields['writingStyle.motifs'] && insights.motifs) {
    currentPersona.writingStyle = currentPersona.writingStyle || { structure: '', motifs: [], defaultMantra: '' };
    const existing = currentPersona.writingStyle.motifs || [];
    const newMotifs = insights.motifs.filter(m => !existing.includes(m));

    if (newMotifs.length > 0) {
      currentPersona.writingStyle.motifs = [...existing, ...newMotifs];
      changes.push(`Added ${newMotifs.length} writing motif(s): ${newMotifs.join(', ')}`);
    }
  }

  // === RECONCILIATION: Remove stale and outdated content ===
  const reconciliation = analysis.reconciliation;

  if (reconciliation && config.reconciliation.enabled) {
    // Remove stale goals
    if (config.reconciliation.removeStaleGoals && reconciliation.staleGoals && reconciliation.staleGoals.length > 0) {
      for (const stale of reconciliation.staleGoals) {
        const timeframe = stale.timeframe as 'shortTerm' | 'midTerm' | 'longTerm';
        if (currentPersona.goals?.[timeframe]) {
          const before = currentPersona.goals[timeframe].length;
          currentPersona.goals[timeframe] = currentPersona.goals[timeframe].filter(
            (g: any) => g.goal !== stale.goal
          );
          const removed = before - currentPersona.goals[timeframe].length;
          if (removed > 0) {
            changes.push(`Removed ${removed} stale ${timeframe} goal(s): "${stale.goal}" (${stale.reason})`);
          }
        }
      }
    }

    // Update goal statuses
    if (config.reconciliation.updateGoalStatuses && reconciliation.updatedGoals && reconciliation.updatedGoals.length > 0) {
      for (const updated of reconciliation.updatedGoals) {
        const timeframe = updated.timeframe as 'shortTerm' | 'midTerm' | 'longTerm';
        if (currentPersona.goals?.[timeframe]) {
          const goal = currentPersona.goals[timeframe].find((g: any) => g.goal === updated.goal);
          if (goal) {
            goal.status = updated.newStatus;
            changes.push(`Updated ${timeframe} goal status: "${updated.goal}" → ${updated.newStatus} (${updated.reason})`);
          }
        }
      }
    }

    // Remove stale interests
    if (config.reconciliation.removeStaleInterests && reconciliation.staleInterests && reconciliation.staleInterests.length > 0) {
      if (currentPersona.personality?.interests) {
        const before = currentPersona.personality.interests.length;
        currentPersona.personality.interests = currentPersona.personality.interests.filter(
          (i: string) => !reconciliation.staleInterests!.some(s => s.interest === i)
        );
        const removed = before - currentPersona.personality.interests.length;
        if (removed > 0) {
          const removedList = reconciliation.staleInterests.map(s => s.interest).join(', ');
          changes.push(`Removed ${removed} stale interest(s): ${removedList}`);
        }
      }
    }

    // Remove contradicted values
    if (config.reconciliation.removeContradictedValues && reconciliation.removedValues && reconciliation.removedValues.length > 0) {
      if (currentPersona.values?.core) {
        const before = currentPersona.values.core.length;
        currentPersona.values.core = currentPersona.values.core.filter(
          (v: any) => !reconciliation.removedValues!.some(r => r.value === v.value)
        );
        const removed = before - currentPersona.values.core.length;
        if (removed > 0) {
          const removedList = reconciliation.removedValues.map(r => r.value).join(', ');
          changes.push(`Removed ${removed} contradicted value(s): ${removedList}`);
        }
      }
    }

    // Remove unused heuristics
    if (config.reconciliation.removeUnusedHeuristics && reconciliation.removedHeuristics && reconciliation.removedHeuristics.length > 0) {
      if (currentPersona.decisionHeuristics) {
        const before = currentPersona.decisionHeuristics.length;
        currentPersona.decisionHeuristics = currentPersona.decisionHeuristics.filter(
          (h: any) => !reconciliation.removedHeuristics!.some(r => r.signal === h.signal)
        );
        const removed = before - currentPersona.decisionHeuristics.length;
        if (removed > 0) {
          changes.push(`Removed ${removed} unused decision heuristic(s)`);
        }
      }
    }
  }

  // Update metadata
  currentPersona.lastUpdated = new Date().toISOString();
  if (!currentPersona.notes) currentPersona.notes = '';
  currentPersona.notes += `\n\n[${new Date().toISOString()}] Updated by psychoanalyzer: ${analysis.summary}`;

  // Save updated persona
  if (changes.length > 0) {
    fs.writeFileSync(personaPath, JSON.stringify(currentPersona, null, 2), 'utf-8');
    console.log(`✅ Applied ${changes.length} update(s) to persona`);
  } else {
    console.log('ℹ️  No updates needed - persona is current');
  }

  return { updated: currentPersona, changes };
}

async function generateChangelog(
  analysis: AnalysisResult,
  changes: string[],
  archiveFile: string,
  config: Config
): Promise<void> {
  if (!config.archival.generateChangelog) {
    return;
  }

  console.log('📋 Generating changelog...');

  // Use profile-specific persona directory (not shared paths.persona)
  const personaResult = storageClient.resolvePath({ category: 'config', subcategory: 'persona', relativePath: 'core.json' });
  const personaPath = personaResult.success && personaResult.path ? personaResult.path : null;
  if (!personaPath) {
    throw new Error('Cannot resolve persona core path');
  }
  const personaDir = path.dirname(personaPath);
  const changelogPath = path.join(personaDir, config.archival.changelogPath);
  const timestamp = new Date().toISOString();

  const entry = `
## ${timestamp}

**Psychoanalyzer Update**

- **Memories Analyzed:** ${analysis.memoriesAnalyzed}
- **Date Range:** ${analysis.dateRange.start} to ${analysis.dateRange.end}
- **Confidence:** ${(analysis.confidence * 100).toFixed(0)}%
- **Archive:** ${path.basename(archiveFile)}

**Summary:** ${analysis.summary}

**Changes:**
${changes.map(c => `- ${c}`).join('\n')}

---
`;

  // Prepend to changelog
  let changelog = '';
  if (fs.existsSync(changelogPath)) {
    changelog = fs.readFileSync(changelogPath, 'utf-8');
  } else {
    changelog = '# Persona Evolution Changelog\n\nAutomatic tracking of persona updates by psychoanalyzer agent.\n\n---\n';
  }

  fs.writeFileSync(changelogPath, changelog.replace(/---\n$/, entry), 'utf-8');

  console.log(`✅ Updated changelog at ${path.relative(ROOT, changelogPath)}`);
}

async function createNotificationMemory(
  analysis: AnalysisResult,
  changes: string[],
  config: Config
): Promise<void> {
  if (!config.notifications.createMemory || changes.length === 0) {
    return;
  }

  console.log('💬 Creating notification memory...');

  const content = `${config.notifications.title}

I've analyzed ${analysis.memoriesAnalyzed} recent memories from the past ${config.memorySelection.daysBack} days and updated your persona based on observed patterns and insights.

**Analysis Summary:**
${analysis.summary}

**Changes Applied:**
${changes.map(c => `• ${c}`).join('\n')}

**Confidence Level:** ${(analysis.confidence * 100).toFixed(0)}%

Your persona continues to evolve naturally based on your lived experiences. You can review the full change history in \`persona/archives/CHANGELOG.md\` and view archived versions to see how your identity has shifted over time.`;

  const memoryId = `evt-${Date.now()}-psychoanalyzer-update`;
  const episodicResult = storageClient.resolvePath({ category: 'memory', subcategory: 'episodic' });
  const episodicPath = episodicResult.success && episodicResult.path ? episodicResult.path : null;
  if (!episodicPath) {
    throw new Error('Cannot resolve episodic memory path');
  }
  const memoryFile = path.join(
    episodicPath,
    new Date().getFullYear().toString(),
    `${memoryId}.json`
  );

  const memory = {
    id: memoryId,
    timestamp: new Date().toISOString(),
    content,
    type: config.notifications.memoryType,
    tags: ['psychoanalyzer', 'persona-update', 'automated'],
    entities: [],
    importance: 0.8,
    metadata: {
      agent: 'psychoanalyzer',
      memoriesAnalyzed: analysis.memoriesAnalyzed,
      confidence: analysis.confidence,
      changesCount: changes.length,
    },
  };

  fs.writeFileSync(memoryFile, JSON.stringify(memory, null, 2), 'utf-8');

  console.log(`✅ Created notification memory: ${memoryId}`);
}

async function main() {
  console.log('🧠 Psychoanalyzer Agent Starting...\n');

  try {
    // Load configuration
    const config = await loadConfig();

    if (!config.enabled) {
      console.log('⏸️  Psychoanalyzer is disabled in configuration');
      process.exit(0);
    }

    // Select memories
    const memories = await selectMemories(config);

    // Analyze memories
    const analysis = await analyzeMemories(memories, config);

    // Archive current persona
    const archiveFile = await archiveCurrentPersona(config);

    // Update persona
    const { updated, changes } = await updatePersona(analysis, config);

    // Generate changelog
    if (changes.length > 0) {
      await generateChangelog(analysis, changes, archiveFile, config);
    }

    // Create notification memory
    await createNotificationMemory(analysis, changes, config);

    // Audit
    await audit('action', 'info', {
      action: 'psychoanalyzer_completed',
      memoriesAnalyzed: analysis.memoriesAnalyzed,
      confidence: analysis.confidence,
      changesCount: changes.length,
      archiveFile,
      actor: 'psychoanalyzer-agent',
    });

    console.log('\n✅ Psychoanalyzer complete!');
    console.log(`\n📊 Summary:`);
    console.log(`   - Analyzed ${analysis.memoriesAnalyzed} memories`);
    console.log(`   - Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
    console.log(`   - Changes applied: ${changes.length}`);
    if (changes.length > 0) {
      console.log(`\n📝 Changes:`);
      changes.forEach(c => console.log(`   • ${c}`));
    }

  } catch (error) {
    console.error('❌ Psychoanalyzer failed:', error);
    await audit('action', 'error', {
      action: 'psychoanalyzer_failed',
      error: error instanceof Error ? error.message : String(error),
      actor: 'psychoanalyzer-agent',
    });
    process.exit(1);
  }
}

main();
