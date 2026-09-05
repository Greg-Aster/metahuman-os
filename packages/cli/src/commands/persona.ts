/**
 * Persona Management Commands
 * Manage persona interviews, adapters, and persona state
 * Includes persona generator interview system
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  audit,
  addQuestion,
  applyPersonaDraft,
  cleanupSessions,
  extractPersonaFromSession,
  generateDiffText,
  generateNextQuestion,
  getActiveAdapter,
  evaluatePersonaInterviewCompletion,
  loadPersonaInterviewConfig,
  getProfilePaths,
  getUserContext,
  listPersonaSessions as listSessions,
  loadPersonaCore,
  loadPersonaSession as loadSession,
  mergePersonaDraft,
  recordAnswer,
  savePersonaSession as saveSession,
  startPersonaSession as startSession,
  type MergeStrategy,
  type PersonaSession as Session,
} from '@metahuman/core';
import readline from 'node:readline';

function requirePersonaContext() {
  const context = getUserContext();
  if (!context) {
    throw new Error('Persona commands require an explicit user. Run: mh --user <username> persona <command>');
  }
  return {
    userId: context.userId,
    username: context.username,
    paths: getProfilePaths(context.username),
  };
}

export function personaStatus() {
  const { paths } = requirePersonaContext();
  console.log('Persona Status\n');

  // Check for active adapter (Tier-2)
  const activeAdapter = getActiveAdapter();

  if (activeAdapter) {
    console.log('Active Adapter: ✓');
    console.log(`  Model: ${activeAdapter.modelName}`);
    console.log(`  Activated: ${activeAdapter.activatedAt}`);
    if (activeAdapter.adapterPath) {
      console.log(`  Path: ${activeAdapter.adapterPath}`);
    }
    if (activeAdapter.status) {
      console.log(`  Status: ${activeAdapter.status}`);
    }
    if (activeAdapter.baseModel) {
      console.log(`  Base Model: ${activeAdapter.baseModel}`);
    }
  } else {
    console.log('Active Adapter: ❌ None (using base model)');
  }

  console.log('');

  // Check base persona
  const personaCorePath = paths.personaCore;
  if (fs.existsSync(personaCorePath)) {
    const persona = JSON.parse(fs.readFileSync(personaCorePath, 'utf-8'));
    console.log(`Base Persona: ${persona.identity?.name || 'Unknown'}`);
    console.log(`  Role: ${persona.identity?.role || 'N/A'}`);
  }
}

/**
 * Persona Generator: Start interactive interview session
 */
export async function personaGenerate(options: { resume?: boolean } = {}) {
  const { username, userId, paths } = requirePersonaContext();

  try {
    let session: Session;

    if (options.resume) {
      // Try to resume latest active session
      const sessions = await listSessions(username);
      const activeSession = sessions.find((s) => s.status === 'active');

      if (!activeSession) {
        console.log('No active session found. Starting new interview...\n');
        session = await startSession(userId, username);
      } else {
        console.log(`Resuming session: ${activeSession.sessionId}\n`);
        const loadedSession = await loadSession(username, activeSession.sessionId);
        if (!loadedSession) throw new Error('Failed to load session');
        session = loadedSession;
      }
    } else {
      console.log('Starting new persona interview...\n');
      session = await startSession(userId, username);
    }
    const interviewConfig = await loadPersonaInterviewConfig(username);

    // Interactive interview loop
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = (question: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(question, (answer) => {
          resolve(answer);
        });
      });
    };

    // Display category coverage
    const showProgress = () => {
      console.log('\n' + '='.repeat(50));
      console.log('CATEGORY COVERAGE:');
      for (const [category, percentage] of Object.entries(session.categoryCoverage)) {
        const bars = Math.floor(percentage / 10);
        const progress = '█'.repeat(bars) + '░'.repeat(10 - bars);
        console.log(`  ${category.padEnd(15)} ${progress} ${percentage}%`);
      }
      console.log('='.repeat(50) + '\n');
    };

    // Interview loop
    while (session.status === 'active') {
      showProgress();

      // Get current unanswered question
      const currentQuestion = session.questions[session.questions.length - 1];

      if (session.answers.length >= session.questions.length) {
        // All questions answered, check completion
        const status = evaluatePersonaInterviewCompletion(session, interviewConfig);

        if (status.isComplete) {
          console.log('\n✓ Interview complete! All categories have sufficient coverage.\n');
          session.status = 'completed';
          await saveSession(username, session);
          break;
        }

        // Generate next question
        console.log('Generating next question...\n');
        const result = await generateNextQuestion(session);

        if (!result) {
          console.log('\n✓ Interview complete!\n');
          session.status = 'completed';
          await saveSession(username, session);
          break;
        }

        await addQuestion(username, session.sessionId, result.question);
        const loadedSession = await loadSession(username, session.sessionId);
        if (!loadedSession) throw new Error('Failed to reload session');
        session = loadedSession;
        continue;
      }

      // Display question
      console.log(`\n[${currentQuestion.category.toUpperCase()}]`);
      console.log(`Q: ${currentQuestion.prompt}\n`);

      // Get answer
      const answer = await askQuestion('Your answer: ');

      if (answer.trim().toLowerCase() === 'quit' || answer.trim().toLowerCase() === 'exit') {
        console.log(`\nPausing interview. Resume with: mh --user ${username} persona generate --resume`);
        rl.close();
        return;
      }

      if (!answer.trim()) {
        console.log('Please provide an answer, or type "quit" to pause.\n');
        continue;
      }

      // Record answer
      await recordAnswer(username, session.sessionId, currentQuestion.id, answer, {
        minLength: interviewConfig.sessionDefaults.minAnswerLength,
        maxLength: interviewConfig.sessionDefaults.maxAnswerLength,
      });
      const loadedSession = await loadSession(username, session.sessionId);
      if (!loadedSession) throw new Error('Failed to reload session');
      session = loadedSession;
    }

    rl.close();

    if (session.status === 'completed') {
      console.log('Finalizing session and extracting persona data...\n');

      // Extract persona
      const extracted = await extractPersonaFromSession(session);

      // Load existing persona
      const currentPersona = loadPersonaCore();

      // Generate diff
      const { diff } = mergePersonaDraft(currentPersona, extracted, 'merge');
      const diffText = generateDiffText(diff);

      console.log(diffText);
      console.log('\n' + '='.repeat(50));

      // Ask to apply
      const rlApply = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const applyAnswer = await new Promise<string>((resolve) => {
        rlApply.question(
          '\nApply changes to persona/core.json? (yes/no): ',
          (answer) => {
            rlApply.close();
            resolve(answer);
          }
        );
      });

      if (applyAnswer.trim().toLowerCase() === 'yes' || applyAnswer.trim().toLowerCase() === 'y') {
        const { diff: appliedDiff, archiveFilename } = applyPersonaDraft(extracted, 'merge');
        const backupPath = path.join(paths.persona, 'archives', archiveFilename);

        console.log(`\n✓ Persona updated successfully!`);
        console.log(`  Backup saved to: ${backupPath}`);

        // Mark session as applied
        session.status = 'applied';
        await saveSession(username, session);

        await audit({
          category: 'data_change',
          level: 'info',
          event: 'persona_applied_via_cli',
          actor: 'cli',
          details: {
            sessionId: session.sessionId,
            diffSummary: appliedDiff.summary,
            backupPath,
          },
        });
      } else {
        console.log('\nChanges not applied. You can apply later with:');
        console.log(`  mh --user ${username} persona apply ${session.sessionId}`);
      }
    }
  } catch (error) {
    console.error('Error during persona generation:', error);
    process.exit(1);
  }
}

/**
 * List all persona interview sessions
 */
export async function personaSessions() {
  const { username } = requirePersonaContext();

  try {
    const sessions = await listSessions(username);

    if (sessions.length === 0) {
      console.log('No interview sessions found.\n');
      console.log(`Start a new interview with: mh --user ${username} persona generate`);
      return;
    }

    console.log('Persona Interview Sessions\n');
    console.log('='.repeat(80));

    for (const session of sessions) {
      console.log(`\nSession ID: ${session.sessionId}`);
      console.log(`Status:     ${session.status}`);
      console.log(`Created:    ${new Date(session.createdAt).toLocaleString()}`);
      console.log(`Questions:  ${session.questionCount}`);
      console.log(`Answers:    ${session.answerCount}`);

      if (session.completedAt) {
        console.log(`Completed:  ${new Date(session.completedAt).toLocaleString()}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\nTotal sessions: ${sessions.length}`);
  } catch (error) {
    console.error('Error loading sessions:', error);
    process.exit(1);
  }
}

/**
 * View transcript of a specific session
 */
export async function personaView(sessionId: string) {
  const { username } = requirePersonaContext();

  if (!sessionId) {
    console.error('Error: sessionId required');
    console.log('Usage: mh persona view <sessionId>');
    process.exit(1);
  }

  try {
    const session = await loadSession(username, sessionId);

    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }

    console.log('Persona Interview Transcript\n');
    console.log('='.repeat(80));
    console.log(`Session ID: ${session.sessionId}`);
    console.log(`Status:     ${session.status}`);
    console.log(`Created:    ${new Date(session.createdAt).toLocaleString()}`);
    console.log('='.repeat(80) + '\n');

    for (let i = 0; i < session.questions.length; i++) {
      const question = session.questions[i];
      const answer = session.answers.find((a) => a.questionId === question.id);

      console.log(`\n[${question.category.toUpperCase()}]`);
      console.log(`Q: ${question.prompt}`);

      if (answer) {
        console.log(`A: ${answer.content}`);
      } else {
        console.log(`A: (not answered)`);
      }

      console.log('');
    }

    console.log('='.repeat(80));

    // Show category coverage
    console.log('\nCategory Coverage:');
    for (const [category, percentage] of Object.entries(session.categoryCoverage)) {
      const bars = Math.floor(percentage / 10);
      const progress = '█'.repeat(bars) + '░'.repeat(10 - bars);
      console.log(`  ${category.padEnd(15)} ${progress} ${percentage}%`);
    }
  } catch (error) {
    console.error('Error viewing session:', error);
    process.exit(1);
  }
}

/**
 * Apply persona changes from a finalized session
 */
export async function personaApply(sessionId: string, strategy: MergeStrategy = 'merge') {
  const { username, paths } = requirePersonaContext();

  if (!sessionId) {
    console.error('Error: sessionId required');
    console.log('Usage: mh persona apply <sessionId> [strategy]');
    console.log('Strategies: replace, merge (default), append');
    process.exit(1);
  }

  try {
    const session = await loadSession(username, sessionId);

    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }

    console.log('Extracting persona from session...\n');

    // Extract persona
    const extracted = await extractPersonaFromSession(session);

    // Load existing persona
    const currentPersona = loadPersonaCore();

    // Generate diff
    const { diff: previewDiff } = mergePersonaDraft(currentPersona, extracted, strategy);
    const diffText = generateDiffText(previewDiff);

    console.log(diffText);
    console.log('\n' + '='.repeat(50));

    const { diff, archiveFilename } = applyPersonaDraft(extracted, strategy);
    const backupPath = path.join(paths.persona, 'archives', archiveFilename);

    console.log(`\n✓ Persona updated successfully using "${strategy}" strategy`);
    console.log(`  Backup saved to: ${backupPath}`);
    console.log(`  Changes: ${diff.summary.additions} additions, ${diff.summary.updates} updates`);

    // Mark session as applied
    session.status = 'applied';
    session.appliedAt = new Date().toISOString();
    session.appliedStrategy = strategy;
    await saveSession(username, session);

    await audit({
      category: 'data_change',
      level: 'info',
      event: 'persona_applied_via_cli',
      actor: 'cli',
      details: {
        sessionId: session.sessionId,
        strategy,
        diffSummary: diff.summary,
        backupPath,
      },
    });
  } catch (error) {
    console.error('Error applying persona:', error);
    process.exit(1);
  }
}

/**
 * Discard a persona interview session
 */
export async function personaDiscard(sessionId: string) {
  const { username } = requirePersonaContext();

  if (!sessionId) {
    console.error('Error: sessionId required');
    console.log('Usage: mh persona discard <sessionId>');
    process.exit(1);
  }

  try {
    const session = await loadSession(username, sessionId);

    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }

    // Confirm deletion
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const confirm = await new Promise<string>((resolve) => {
      rl.question(
        `Are you sure you want to discard session ${sessionId}? (yes/no): `,
        (answer) => {
          rl.close();
          resolve(answer);
        }
      );
    });

    if (confirm.trim().toLowerCase() !== 'yes' && confirm.trim().toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }

    // Mark as aborted
    session.status = 'aborted';
    await saveSession(username, session);

    console.log(`✓ Session ${sessionId} discarded.`);

    await audit({
      category: 'action',
      level: 'info',
      event: 'persona_session_discarded',
      actor: 'cli',
      details: { sessionId },
    });
  } catch (error) {
    console.error('Error discarding session:', error);
    process.exit(1);
  }
}

/**
 * Clean up old persona interview sessions
 */
export async function personaCleanup(options: { dryRun?: boolean; maxAge?: number } = {}) {
  const { username } = requirePersonaContext();
  const maxAge = options.maxAge || 30;

  try {
    console.log(`Cleaning up sessions older than ${maxAge} days...`);
    console.log(options.dryRun ? '(DRY RUN - no changes will be made)\n' : '\n');

    const result = await cleanupSessions(username, {
      maxAgeInDays: maxAge,
      statuses: ['aborted', 'completed', 'finalized', 'applied'],
      dryRun: options.dryRun || false,
      archiveBeforeDelete: true,
    });

    // Display results
    console.log('='.repeat(80));
    console.log('CLEANUP SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total sessions checked: ${result.sessions.length}`);
    console.log(`Archived: ${result.archived}`);
    console.log(`Cleaned: ${result.cleaned}`);
    console.log(`Errors: ${result.errors}`);
    console.log('');

    if (result.sessions.length > 0) {
      console.log('DETAILS:');
      console.log('-'.repeat(80));

      for (const session of result.sessions) {
        const actionStr = session.action.toUpperCase().padEnd(10);
        const ageStr = `${session.age}d`.padEnd(6);
        const statusStr = session.status.padEnd(12);

        console.log(
          `${actionStr} | Age: ${ageStr} | Status: ${statusStr} | ${session.sessionId}`
        );

        if (session.reason) {
          console.log(`           Reason: ${session.reason}`);
        }
      }
    }

    console.log('');
    console.log('='.repeat(80));

    if (options.dryRun) {
      console.log('\nThis was a dry run. No changes were made.');
      console.log('Run without --dry-run to actually clean up sessions.');
    } else if (result.archived > 0 || result.cleaned > 0) {
      console.log(`\n✓ Cleanup complete. ${result.archived} sessions archived.`);
    } else {
      console.log('\n✓ No sessions needed cleanup.');
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
}

export async function personaCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'status':
      personaStatus();
      break;
    case 'generate':
      await personaGenerate({ resume: subArgs.includes('--resume') });
      break;
    case 'sessions':
      await personaSessions();
      break;
    case 'view':
      await personaView(subArgs[0]);
      break;
    case 'apply':
      await personaApply(subArgs[0], (subArgs[1] as MergeStrategy) || 'merge');
      break;
    case 'discard':
      await personaDiscard(subArgs[0]);
      break;
    case 'cleanup':
      await personaCleanup({
        dryRun: subArgs.includes('--dry-run'),
        maxAge: subArgs.includes('--max-age')
          ? parseInt(subArgs[subArgs.indexOf('--max-age') + 1], 10)
          : 30,
      });
      break;
    case undefined:
      console.log('Usage: mh persona <command>');
      console.log('');
      console.log('Profile Commands:');
      console.log('  status     - Show current persona and adapter state');
      console.log('');
      console.log('Generator Commands:');
      console.log('  generate           - Start interactive personality interview');
      console.log('  generate --resume  - Resume latest active session');
      console.log('  sessions           - List all interview sessions');
      console.log('  view <id>          - View session transcript');
      console.log('  apply <id> [strategy]  - Apply persona changes (strategies: replace, merge, append)');
      console.log('  discard <id>       - Delete a session');
      console.log('  cleanup [--dry-run] [--max-age <days>]  - Clean up old sessions (default: 30 days)');
      break;
    default:
      console.log(`Unknown persona command: ${subcommand}`);
      console.log('Run `mh persona` for usage.');
      process.exit(1);
  }
}
