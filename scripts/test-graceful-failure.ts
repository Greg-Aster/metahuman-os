#!/usr/bin/env tsx
/**
 * Test Graceful Failure Handling
 *
 * Tests that the operator detects stuck states and returns structured errors
 * instead of throwing exceptions.
 */

import { runOperatorWithFeatureFlag } from '../brain/agents/operator-react';

async function testGracefulFailure() {
  console.log('🧪 Testing graceful failure handling...\n');

  const testCases = [
    {
      name: 'Impossible Task (should detect stuck state)',
      goal: 'Read the file at /nonexistent/impossible/path.txt and summarize its contents',
      expectedError: 'repeated_failures'
    },
    {
      name: 'Ambiguous Task (should detect no progress)',
      goal: 'Do something useful',
      expectedError: 'no_progress'
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n📝 Test: ${testCase.name}`);
    console.log(`Goal: "${testCase.goal}"`);
    console.log('━'.repeat(80));

    try {
      const result = await runOperatorWithFeatureFlag(
        testCase.goal,
        {
          contextPackage: {
            memories: [],
            memoryCount: 0,
            fallbackUsed: false,
            persona: { name: 'Test', summary: '' },
            activeTasks: [],
            recentTopics: [],
            patterns: [],
            recentTools: [],
            functionGuides: [],
            mode: 'dual',
            retrievalTime: 0,
            timestamp: new Date().toISOString()
          }
        },
        undefined,
        { userId: 'test-user', cognitiveMode: 'dual' }
      );

      if (result.error) {
        console.log('✅ Graceful failure detected');
        console.log(`   Error type: ${result.error.type}`);
        console.log(`   Error subtype: ${result.error.errorType || 'N/A'}`);
        console.log(`   Reason: ${result.error.reason}`);
        console.log(`   Iterations: ${result.metadata?.iterations || 'N/A'}`);

        if (result.error.suggestions && result.error.suggestions.length > 0) {
          console.log(`\n   Suggestions provided: ${result.error.suggestions.length}`);
          result.error.suggestions.slice(0, 2).forEach((s: string, i: number) => {
            console.log(`   ${i + 1}. ${s.substring(0, 70)}...`);
          });
        }

        if (result.error.context) {
          console.log(`\n   Context details:`);
          if (result.error.context.failedActions) {
            console.log(`   - Failed actions: ${result.error.context.failedActions.join(', ')}`);
          }
          if (result.error.context.failureCount) {
            console.log(`   - Failure count: ${result.error.context.failureCount}`);
          }
        }

        // Verify expected error type
        if (result.error.errorType === testCase.expectedError) {
          console.log(`\n✓ Expected error type matched: ${testCase.expectedError}`);
        } else {
          console.log(`\n⚠️  Expected ${testCase.expectedError}, got ${result.error.errorType}`);
        }
      } else {
        console.log('❌ No error detected (task unexpectedly succeeded)');
        console.log(`   Result: ${result.result?.substring(0, 100)}`);
      }

    } catch (error) {
      console.log('❌ Unexpected exception thrown (should have returned structured error)');
      console.log(`   Error: ${(error as Error).message}`);
      console.log(`\n   Stack trace:`);
      console.log((error as Error).stack);
    }
  }

  console.log('\n\n✨ Test complete!\n');
  console.log('Expected behavior:');
  console.log('- No exceptions should be thrown');
  console.log('- All errors should be structured objects with type, reason, and suggestions');
  console.log('- HTTP 500 errors should never reach the user');
}

testGracefulFailure().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
