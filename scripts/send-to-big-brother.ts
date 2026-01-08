#!/usr/bin/env tsx

import { sendPromptToBigBrother } from '@metahuman/core/big-brother';

async function main() {
  const prompt = `# Task: Review Desire Outcome

You need to review the outcome of a failed desire execution and decide what to do next.

## Desire Details
- ID: desire-1767651386925-v597z8
- Title: "A long walk."
- Description: "I strongly desire to go on a long trip. I am considering the southern terminus of the pacific crest trail traveling north."
- Status: awaiting_review (execution failed/aborted)
- Strength: 80%

## Execution History
The desire was being executed but failed with error: "Claude CLI request failed: Claude CLI timed out after 300000ms"
The execution was aborted after 1223 minutes.

## Your Task
1. Read the full desire manifest at: /media/greggles/STACK/metahuman-profiles/greggles/persona/desires/folders/desire-1767651386925-v597z8/manifest.json
2. Analyze why the execution failed
3. Decide on the verdict: retry, escalate, complete, or abandon
4. If retry: Update the plan if needed
5. Update the desire status and save the manifest

Please proceed with the review and tell me what you decide.`;

  console.log('[send-to-big-brother] Sending prompt to Big Brother...');
  
  try {
    const result = await sendPromptToBigBrother(prompt, {
      timeout: 120000
    });
    
    console.log('[send-to-big-brother] Result:', result);
  } catch (error) {
    console.error('[send-to-big-brother] Error:', error);
  }
}

main().catch(console.error);