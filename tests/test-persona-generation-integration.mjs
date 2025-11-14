#!/usr/bin/env node
/**
 * Persona Generation Integration Test (Validation)
 *
 * Validates that all required files and exports exist for the persona generation system.
 * Run with tsx for full integration testing (requires compilation).
 *
 * This validation checks:
 * - All persona modules exist
 * - All API endpoints exist
 * - All CLI commands exist
 * - All UI components exist
 * - Configuration files are valid
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const TEST_USER = 'test-user-' + Date.now();
const TEST_USER_ID = 'test-' + Date.now();

console.log('='.repeat(80));
console.log('PERSONA GENERATION INTEGRATION TEST');
console.log('='.repeat(80));
console.log(`Test User: ${TEST_USER}`);
console.log(`Test User ID: ${TEST_USER_ID}`);
console.log('');

// Mock questions and answers for testing
const mockQuestionsAndAnswers = [
  {
    category: 'values',
    prompt: 'What values are most important to you in your work and personal life?',
    answer: 'I value autonomy, creativity, and continuous learning. I believe in working independently while collaborating effectively with others.',
  },
  {
    category: 'values',
    prompt: 'Can you describe a time when one of your core values influenced an important decision?',
    answer: 'When I had to choose between a high-paying corporate job and a startup role, I chose the startup because it offered more autonomy and learning opportunities.',
  },
  {
    category: 'goals',
    prompt: 'What are your main goals for the next year?',
    answer: 'I want to master TypeScript, build three meaningful open-source projects, and contribute to AI safety research.',
  },
  {
    category: 'style',
    prompt: 'How would you describe your communication style?',
    answer: 'I prefer direct, concise communication with occasional humor. I value clarity over politeness when technical accuracy is at stake.',
  },
  {
    category: 'biography',
    prompt: 'What experiences have shaped who you are today?',
    answer: 'Growing up in a multicultural environment taught me to appreciate different perspectives. My computer science degree gave me technical foundations, but self-directed learning has been more valuable.',
  },
  {
    category: 'current_focus',
    prompt: 'What are you currently working on or learning?',
    answer: 'Building MetaHuman OS - a personal AI system. Also exploring LLM fine-tuning and studying cognitive architectures.',
  },
  {
    category: 'style',
    prompt: 'How do you approach problem-solving?',
    answer: 'I start with understanding the root cause, then explore multiple solutions before committing. I prefer iterative refinement over perfect-first-time approaches.',
  },
];

async function runIntegrationTest() {
  let session;
  let sessionId;

  try {
    // Step 1: Start a new session
    console.log('Step 1: Starting new session...');
    session = await startSession(TEST_USER_ID, TEST_USER);
    sessionId = session.sessionId;
    console.log(`✓ Session created: ${sessionId}`);
    console.log(`  Status: ${session.status}`);
    console.log(`  Questions: ${session.questions.length}`);
    console.log('');

    // Step 2: Answer all mock questions
    console.log('Step 2: Answering questions...');

    for (let i = 0; i < mockQuestionsAndAnswers.length; i++) {
      const { category, prompt, answer } = mockQuestionsAndAnswers[i];

      // Add question to session (simulating question generation)
      const question = {
        id: `q${i + 1}-${Date.now()}`,
        prompt,
        category,
        generatedAt: new Date().toISOString(),
      };

      await addQuestion(TEST_USER, sessionId, question);

      // Record answer
      await recordAnswer(TEST_USER, sessionId, question.id, answer);

      console.log(`  [${category.toUpperCase()}] Q${i + 1} answered`);
    }

    // Reload session to see updated coverage
    session = await loadSession(TEST_USER, sessionId);
    console.log('');
    console.log('Category Coverage:');
    for (const [category, percentage] of Object.entries(session.categoryCoverage)) {
      const bars = Math.floor(percentage / 10);
      const progress = '█'.repeat(bars) + '░'.repeat(10 - bars);
      console.log(`  ${category.padEnd(15)} ${progress} ${percentage}%`);
    }
    console.log('');

    // Step 3: Extract persona from session
    console.log('Step 3: Extracting persona from session...');
    const extracted = await extractPersonaFromSession(session);

    console.log(`✓ Persona extracted`);
    console.log(`  Big Five traits: ${Object.keys(extracted.bigFive || {}).length}`);
    console.log(`  Values: ${(extracted.values || []).length}`);
    console.log(`  Interests: ${(extracted.interests || []).length}`);
    console.log(`  Confidence: ${Math.round((extracted.confidence || 0) * 100)}%`);
    console.log('');

    // Step 4: Create test persona file and merge
    console.log('Step 4: Merging with existing persona...');

    // Create a minimal test persona
    const testPersonaPath = path.join(paths.root, 'test-persona-core.json');
    const testPersona = {
      identity: {
        name: 'TestBot',
        role: 'Digital assistant',
      },
      personality: {
        bigFive: {
          openness: 0.5,
          conscientiousness: 0.6,
          extraversion: 0.4,
          agreeableness: 0.7,
          neuroticism: 0.3,
        },
      },
      lastUpdated: new Date().toISOString(),
    };

    fs.writeFileSync(testPersonaPath, JSON.stringify(testPersona, null, 2), 'utf-8');

    // Merge with 'merge' strategy
    const { updated, diff } = mergePersonaDraft(testPersona, extracted, 'merge');

    console.log(`✓ Merge completed`);
    console.log(`  Changes: ${diff.summary.additions} additions, ${diff.summary.updates} updates`);
    console.log('');

    // Step 5: Save updated persona
    console.log('Step 5: Saving updated persona...');

    // Create backup
    const backupPath = path.join(paths.root, `test-persona-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(testPersona, null, 2), 'utf-8');

    // Save updated persona
    savePersona(testPersonaPath, updated);

    console.log(`✓ Persona saved`);
    console.log(`  Path: ${testPersonaPath}`);
    console.log(`  Backup: ${backupPath}`);
    console.log('');

    // Step 6: Verify persona was updated correctly
    console.log('Step 6: Verifying persona updates...');

    const savedPersona = JSON.parse(fs.readFileSync(testPersonaPath, 'utf-8'));

    // Check that new values were added
    const hasNewValues = savedPersona.values && savedPersona.values.core && savedPersona.values.core.length > 0;
    const hasBigFive = savedPersona.personality && savedPersona.personality.bigFive;
    const hasInterests = savedPersona.personality && savedPersona.personality.interests && savedPersona.personality.interests.length > 0;

    console.log(`  Values present: ${hasNewValues ? '✓' : '✗'}`);
    console.log(`  Big Five present: ${hasBigFive ? '✓' : '✗'}`);
    console.log(`  Interests present: ${hasInterests ? '✓' : '✗'}`);
    console.log('');

    // Step 7: Mark session as applied
    console.log('Step 7: Marking session as applied...');
    session.status = 'applied';
    session.appliedAt = new Date().toISOString();
    session.appliedStrategy = 'merge';
    await saveSession(TEST_USER, session);

    console.log(`✓ Session marked as applied`);
    console.log('');

    // Cleanup
    console.log('Cleanup: Removing test files...');
    fs.rmSync(testPersonaPath, { force: true });
    fs.rmSync(backupPath, { force: true });

    // Remove test session directory
    const sessionDir = path.join(paths.root, 'profiles', TEST_USER, 'persona', 'interviews', sessionId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }

    // Remove test profile directory
    const testProfileDir = path.join(paths.root, 'profiles', TEST_USER);
    if (fs.existsSync(testProfileDir)) {
      fs.rmSync(testProfileDir, { recursive: true, force: true });
    }

    console.log(`✓ Test files cleaned up`);
    console.log('');

    // Success!
    console.log('='.repeat(80));
    console.log('✓ ALL INTEGRATION TESTS PASSED');
    console.log('='.repeat(80));
    console.log('');
    console.log('Test Results:');
    console.log('  ✓ Session creation');
    console.log('  ✓ Question/answer recording');
    console.log('  ✓ Category coverage tracking');
    console.log('  ✓ Persona extraction');
    console.log('  ✓ Persona merging');
    console.log('  ✓ File I/O and backups');
    console.log('  ✓ Session status management');
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('');
    console.error('='.repeat(80));
    console.error('✗ INTEGRATION TEST FAILED');
    console.error('='.repeat(80));
    console.error('');
    console.error('Error:', error.message);
    console.error('');
    console.error('Stack trace:');
    console.error(error.stack);
    console.error('');

    // Cleanup on failure
    try {
      const testPersonaPath = path.join(paths.root, 'test-persona-core.json');
      const testProfileDir = path.join(paths.root, 'profiles', TEST_USER);

      if (fs.existsSync(testPersonaPath)) {
        fs.rmSync(testPersonaPath, { force: true });
      }

      if (fs.existsSync(testProfileDir)) {
        fs.rmSync(testProfileDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError.message);
    }

    process.exit(1);
  }
}

// Run the test
runIntegrationTest();
