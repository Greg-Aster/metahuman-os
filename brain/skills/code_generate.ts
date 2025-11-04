/**
 * code_generate Skill
 * Generate code changes using the coder LLM
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../../packages/core/src/paths';
import { SkillManifest, SkillResult, isPathAllowed } from '../../packages/core/src/skills';
import { callLLM } from '../../packages/core/src/model-router';

export const manifest: SkillManifest = {
  id: 'code_generate',
  name: 'Generate Code',
  description: 'Generate code changes or new code using the coder LLM',
  category: 'fs',

  inputs: {
    filePath: {
      type: 'string',
      required: true,
      description: 'Path to the file to modify or create (project-relative)',
    },
    instructions: {
      type: 'string',
      required: true,
      description: 'Instructions for what code changes to make',
    },
    context: {
      type: 'string',
      required: false,
      description: 'Additional context about the task or surrounding code',
    },
  },

  outputs: {
    patch: { type: 'string', description: 'Generated code changes (unified diff format)' },
    newContent: { type: 'string', description: 'Complete new file content (if creating new file)' },
    explanation: { type: 'string', description: 'Explanation of the changes made' },
    testCommands: { type: 'array', description: 'Suggested test commands to verify changes' },
  },

  risk: 'medium',
  cost: 'expensive',
  minTrustLevel: 'suggest',
  requiresApproval: false, // Code generation itself is safe; application requires approval
  allowedDirectories: ['.'], // Can read any file for context
};

export async function execute(inputs: {
  filePath: string;
  instructions: string;
  context?: string;
}): Promise<SkillResult> {
  try {
    const filepath = path.isAbsolute(inputs.filePath)
      ? path.resolve(inputs.filePath)
      : path.resolve(paths.root, inputs.filePath);

    // Check if file exists
    const fileExists = fs.existsSync(filepath);
    let currentContent = '';
    let surroundingCode = '';

    if (fileExists) {
      // Read current file content
      currentContent = fs.readFileSync(filepath, 'utf-8');

      // Extract surrounding context (first 50 lines for context)
      const lines = currentContent.split('\n');
      if (lines.length > 50) {
        surroundingCode = lines.slice(0, 50).join('\n') + '\n... (truncated)';
      } else {
        surroundingCode = currentContent;
      }
    }

    // Build coder prompt
    const systemPrompt = `You are the MetaHuman OS code agent.
Your job: Generate clean, well-documented code changes based on instructions.

STRICT RULES:
- Never edit files under memory/ or persona/ directories
- Produce either a unified diff (for edits) or complete new file content (for new files)
- Include clear explanations and test commands
- Follow best practices and existing code style
- Handle edge cases and add error handling

Output format (JSON):
{
  "patch": "unified diff string (if editing existing file)",
  "newContent": "complete file content (if creating new file)",
  "explanation": "brief explanation of changes",
  "testCommands": ["command1", "command2"]
}`;

    const userPrompt = `Task: ${inputs.instructions}

File: ${inputs.filePath}
${fileExists ? 'File exists - provide a unified diff' : 'New file - provide complete content'}

${inputs.context ? `Context: ${inputs.context}\n` : ''}
${fileExists ? `\nCurrent content (excerpt):\n\`\`\`\n${surroundingCode}\n\`\`\`\n` : ''}

Generate the code changes as JSON.`;

    // Call coder LLM
    const response = await callLLM({
      role: 'coder',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      options: {
        temperature: 0.2, // Deterministic for code
      },
    });

    // Parse response
    let result;
    try {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = response.content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.content.trim();
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      // If JSON parsing fails, treat the entire response as explanation
      return {
        success: false,
        error: `Failed to parse coder response as JSON: ${(parseError as Error).message}\n\nRaw response:\n${response.content}`,
      };
    }

    // Validate response structure
    if (!result.patch && !result.newContent) {
      return {
        success: false,
        error: 'Coder did not provide patch or newContent',
      };
    }

    return {
      success: true,
      outputs: {
        patch: result.patch || null,
        newContent: result.newContent || null,
        explanation: result.explanation || 'No explanation provided',
        testCommands: Array.isArray(result.testCommands) ? result.testCommands : [],
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Code generation failed: ${(error as Error).message}`,
    };
  }
}
