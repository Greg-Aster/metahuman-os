/**
 * System Coder - Fix Generator
 *
 * Generates code fixes for captured errors using Big Brother (Claude CLI).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { audit } from '../audit.js';
import type { CapturedError, FileChange, FixRisk, ProposedFix } from './types.js';
import { createFix } from './fix-management.js';
import { getError, updateErrorStatus } from './error-capture.js';

// ============================================================================
// Types
// ============================================================================

interface FixGenerationResult {
  success: boolean;
  fix?: ProposedFix;
  error?: string;
}

interface ParsedFix {
  title: string;
  explanation: string;
  changes: FileChange[];
  risk: FixRisk;
  confidence: number;
  testCommands?: string[];
}

// ============================================================================
// Fix Generation via Claude CLI
// ============================================================================

/**
 * Generate a fix for an error using Claude CLI
 */
export async function generateFixForError(
  username: string,
  errorId: string
): Promise<FixGenerationResult> {
  // Get the error
  const error = getError(username, errorId);
  if (!error) {
    return { success: false, error: 'Error not found' };
  }

  // Update error status to reviewing
  updateErrorStatus(username, errorId, 'reviewing');

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_fix_generation_started',
    details: { errorId, source: error.source, severity: error.severity },
    actor: 'system-coder',
    userId: username,
  });

  try {
    // Build the prompt for Claude
    const prompt = buildFixPrompt(error);

    // Call Claude CLI
    const response = await callClaudeForFix(prompt);

    // Parse the response to extract fix details
    const parsedFix = parseFixResponse(response, error);

    if (!parsedFix) {
      updateErrorStatus(username, errorId, 'new'); // Reset status
      return { success: false, error: 'Failed to parse fix from Claude response' };
    }

    // Create the fix
    const fix = createFix(username, errorId, {
      title: parsedFix.title,
      explanation: parsedFix.explanation,
      changes: parsedFix.changes,
      risk: parsedFix.risk,
      generatedBy: 'big_brother',
      confidence: parsedFix.confidence,
      testCommands: parsedFix.testCommands,
    });

    // Update error with fix ID
    updateErrorStatus(username, errorId, 'reviewing', fix.id);

    audit({
      level: 'info',
      category: 'action',
      event: 'system_coder_fix_generated',
      details: {
        errorId,
        fixId: fix.id,
        changesCount: fix.changes.length,
        risk: fix.risk,
      },
      actor: 'system-coder',
      userId: username,
    });

    return { success: true, fix };
  } catch (error) {
    updateErrorStatus(username, errorId, 'new'); // Reset status on failure

    audit({
      level: 'error',
      category: 'action',
      event: 'system_coder_fix_generation_failed',
      details: {
        errorId,
        error: (error as Error).message,
      },
      actor: 'system-coder',
      userId: username,
    });

    return { success: false, error: (error as Error).message };
  }
}

/**
 * Build the prompt for Claude to generate a fix
 */
function buildFixPrompt(error: CapturedError): string {
  let fileContext = '';

  // Try to read the file if we have context
  if (error.context.file) {
    try {
      const content = fs.readFileSync(error.context.file, 'utf-8');
      const lines = content.split('\n');
      const errorLine = error.context.line || 0;

      // Get context around the error line (20 lines before and after)
      const start = Math.max(0, errorLine - 20);
      const end = Math.min(lines.length, errorLine + 20);
      const contextLines = lines.slice(start, end);

      fileContext = `
## File Content (${error.context.file}, lines ${start + 1}-${end}):
\`\`\`
${contextLines.map((line, i) => `${start + i + 1}: ${line}`).join('\n')}
\`\`\`
`;
    } catch {
      fileContext = `\n(Could not read file: ${error.context.file})\n`;
    }
  }

  return `You are a code maintenance agent for the MetaHuman OS project. An error has been captured and you need to generate a fix.

## Error Details

**Source:** ${error.source}
**Severity:** ${error.severity}
**Message:** ${error.message}

${error.stack ? `**Stack Trace:**\n\`\`\`\n${error.stack}\n\`\`\`\n` : ''}

${error.context.file ? `**File:** ${error.context.file}${error.context.line ? `:${error.context.line}` : ''}` : ''}
${error.context.command ? `**Command:** ${error.context.command}` : ''}
${error.context.output ? `**Output:**\n\`\`\`\n${error.context.output.substring(0, 1000)}\n\`\`\`\n` : ''}

${fileContext}

## Instructions

Analyze this error and provide a fix. Your response MUST be in this exact format:

### FIX_TITLE
[A brief title for the fix, e.g., "Fix null reference in user authentication"]

### FIX_EXPLANATION
[Explain what caused the error and how the fix addresses it]

### FIX_RISK
[One of: none, low, medium, high, critical]

### FIX_CONFIDENCE
[A number between 0 and 1, e.g., 0.85]

### FILE_CHANGES
[For each file that needs to be changed, use this format:]

#### CHANGE: [create|modify|delete]
FILE: [absolute path to file]
\`\`\`[language]
[The complete new content for the file (for create/modify) or leave empty for delete]
\`\`\`

### TEST_COMMANDS
[Optional: commands to verify the fix works, one per line]

---

Important guidelines:
1. Only modify files that are directly related to fixing the error
2. Provide complete file content for modified files (not just patches)
3. Be conservative - prefer minimal changes
4. Consider edge cases and don't introduce new bugs
5. If the error requires investigation or is unclear, set confidence low (< 0.5)
`;
}

/**
 * Call Claude CLI to generate a fix
 */
async function callClaudeForFix(prompt: string): Promise<string> {
  const { isClaudeSessionReady, sendPrompt, startClaudeSession, isClaudeInstalled } = await import('../claude-session.js');

  // Check if Claude CLI is available
  const installed = await isClaudeInstalled();
  if (!installed) {
    throw new Error('Claude CLI is not installed. Please install it with: npm install -g @anthropic-ai/claude-code');
  }

  // Ensure session is ready
  if (!isClaudeSessionReady()) {
    const started = await startClaudeSession();
    if (!started) {
      throw new Error('Failed to start Claude CLI session');
    }
  }

  // Send prompt and get response (2 minute timeout for complex analysis)
  const response = await sendPrompt(prompt, 120000);
  return response;
}

/**
 * Parse Claude's response to extract fix details
 */
function parseFixResponse(response: string, error: CapturedError): ParsedFix | null {
  try {
    // Extract title
    const titleMatch = response.match(/### FIX_TITLE\s*\n([^\n#]+)/);
    const title = titleMatch?.[1]?.trim() || `Fix for ${error.source} error`;

    // Extract explanation
    const explanationMatch = response.match(/### FIX_EXPLANATION\s*\n([\s\S]*?)(?=###|$)/);
    const explanation = explanationMatch?.[1]?.trim() || 'No explanation provided';

    // Extract risk
    const riskMatch = response.match(/### FIX_RISK\s*\n\s*(none|low|medium|high|critical)/i);
    const risk = (riskMatch?.[1]?.toLowerCase() as FixRisk) || 'medium';

    // Extract confidence
    const confidenceMatch = response.match(/### FIX_CONFIDENCE\s*\n\s*([0-9.]+)/);
    const confidence = parseFloat(confidenceMatch?.[1] || '0.5');

    // Extract file changes
    const changes: FileChange[] = [];
    const changesSection = response.match(/### FILE_CHANGES\s*\n([\s\S]*?)(?=### TEST_COMMANDS|$)/);

    if (changesSection) {
      const changeBlocks = changesSection[1].split(/#### CHANGE:/);

      for (const block of changeBlocks) {
        if (!block.trim()) continue;

        const changeTypeMatch = block.match(/^\s*(create|modify|delete)/i);
        const fileMatch = block.match(/FILE:\s*([^\n]+)/);
        const contentMatch = block.match(/```[\w]*\n([\s\S]*?)```/);

        if (changeTypeMatch && fileMatch) {
          changes.push({
            changeType: changeTypeMatch[1].toLowerCase() as 'create' | 'modify' | 'delete',
            filePath: fileMatch[1].trim(),
            newContent: contentMatch?.[1] || '',
          });
        }
      }
    }

    // Extract test commands
    const testCommandsMatch = response.match(/### TEST_COMMANDS\s*\n([\s\S]*?)(?=---|$)/);
    const testCommands = testCommandsMatch?.[1]
      ?.split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')) || undefined;

    // Validate we have at least some changes or it's an investigation-only response
    if (changes.length === 0 && confidence > 0.5) {
      return null; // Can't generate a fix without changes
    }

    return {
      title,
      explanation,
      changes,
      risk,
      confidence,
      testCommands,
    };
  } catch (error) {
    console.error('Failed to parse fix response:', error);
    return null;
  }
}

/**
 * Generate fixes for multiple errors (batch processing)
 */
export async function generateFixesForErrors(
  username: string,
  errorIds: string[]
): Promise<{ results: Record<string, FixGenerationResult> }> {
  const results: Record<string, FixGenerationResult> = {};

  for (const errorId of errorIds) {
    results[errorId] = await generateFixForError(username, errorId);
    // Add a small delay between requests to avoid overwhelming Claude
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { results };
}
