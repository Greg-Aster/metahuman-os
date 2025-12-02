/**
 * Persona Management Commands
 * Manage active profiles, adapters, and persona state
 * Includes persona generator interview system
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, systemPaths, audit, getActiveAdapter } from '@metahuman/core';
import {
  startSession,
  loadSession,
  saveSession,
  listSessions,
  addQuestion,
  recordAnswer,
  type Session,
} from '@metahuman/core/persona/session-manager';
import { generateNextQuestion, getCompletionStatus } from '@metahuman/core/persona/question-generator';
import { extractPersonaFromSession } from '@metahuman/core/persona/extractor';
import {
  loadExistingPersona,
  mergePersonaDraft,
  savePersona,
  generateDiffText,
  type MergeStrategy,
} from '@metahuman/core/persona/merger';
import { cleanupSessions, previewCleanup } from '@metahuman/core/persona/cleanup';
import readline from 'node:readline';

export function personaActivate() {
  console.log('Activating persona profile (running morning-loader)...\n');

  const agentPath = path.join(systemPaths.brain, 'agents', 'morning-loader.ts');

  if (!fs.existsSync(agentPath)) {
    console.error('Error: morning-loader.ts not found');
    process.exit(1);
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'persona_activate_requested',
    details: { manual: true },
    actor: 'cli',
  });

  const child = spawn('tsx', [agentPath], {
    stdio: 'inherit',
    cwd: ROOT,
  });

  child.on('error', (err) => {
    console.error(`Failed to run morning-loader: ${err.message}`);
    process.exit(1);
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.log('\n✓ Persona profile activated successfully');
    } else {
      console.error(`\nmorning-loader exited with code ${code}`);
      process.exit(code || 1);
    }
  });
}

export function personaStatus() {
  console.log('Persona Status\n');

  // Check for active profile
  const activeProfilePath = path.join(systemPaths.persona, 'active-profile.md');
  const activeProfileExists = fs.existsSync(activeProfilePath);

  if (activeProfileExists) {
    const stats = fs.statSync(activeProfilePath);
    const lastModified = stats.mtime.toISOString();
    const age = Math.floor((Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60));

    console.log(`Active Profile: ${activeProfilePath}`);
    console.log(`Last Updated: ${lastModified} (${age}h ago)`);
    console.log(`Size: ${stats.size} bytes`);

    // Show which daily profile it links to
    if (stats.isSymbolicLink()) {
      const target = fs.readlinkSync(activeProfilePath);
      console.log(`Target: ${target}`);
    }
  } else {
    console.log('Active Profile: ❌ None (using base persona only)');
    console.log('\nRun `mh persona activate` to generate a daily profile.');
  }

  console.log('');

  // Check for active adapter (Tier-2)
  const activeAdapter = getActiveAdapter();

  if (activeAdapter) {
    console.log('Active Adapter: ✓');
    console.log(`  Model: ${activeAdapter.modelName}`);
    console.log(`  Activated: ${activeAdapter.activatedAt}`);
    console.log(`  Eval Score: ${typeof activeAdapter.evalScore === 'number' ? activeAdapter.evalScore.toFixed(3) : 'N/A'}`);
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
  const personaCorePath = systemPaths.personaCore;
  if (fs.existsSync(personaCorePath)) {
    const persona = JSON.parse(fs.readFileSync(personaCorePath, 'utf-8'));
    console.log(`Base Persona: ${persona.identity?.name || 'Unknown'}`);
    console.log(`  Role: ${persona.identity?.role || 'N/A'}`);
  }
}

export function personaDiff() {
  console.log('Persona Diff (Base vs Active Profile)\n');

  const activeProfilePath = path.join(systemPaths.persona, 'active-profile.md');

  if (!fs.existsSync(activeProfilePath)) {
    console.log('No active profile found. Run `mh persona activate` first.');
    return;
  }

  const activeProfile = fs.readFileSync(activeProfilePath, 'utf-8');

  // Show the overnight learnings section
  const overnightMatch = activeProfile.match(/## Overnight Learnings[\s\S]*?(?=\n---|\n##|$)/);

  if (overnightMatch) {
    console.log('Recent Overnight Learnings:\n');
    console.log(overnightMatch[0]);
  } else {
    console.log('No overnight learnings section found in active profile.');
  }

  console.log('\n---\n');
  console.log('Full active profile available at:');
  console.log(activeProfilePath);
}

/**
 * Persona Generator: Start interactive interview session
 */
export async function personaGenerate(options: { resume?: boolean } = {}) {
  const username = process.env.USER || 'default';
  const userId = username; // Simplified for CLI

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
        session = await loadSession(username, activeSession.sessionId);
        if (!session) {
          console.error('Failed to load session');
          process.exit(1);
        }
      }
    } else {
      console.log('Starting new persona interview...\n');
      session = await startSession(userId, username);
    }

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
        const status = getCompletionStatus(session);

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
        session = await loadSession(username, session.sessionId);
        if (!session) {
          console.error('Failed to reload session');
          process.exit(1);
        }
        continue;
      }

      // Display question
      console.log(`\n[${currentQuestion.category.toUpperCase()}]`);
      console.log(`Q: ${currentQuestion.prompt}\n`);

      // Get answer
      const answer = await askQuestion('Your answer: ');

      if (answer.trim().toLowerCase() === 'quit' || answer.trim().toLowerCase() === 'exit') {
        console.log('\nPausing interview. Resume with: mh persona generate --resume');
        rl.close();
        return;
      }

      if (!answer.trim()) {
        console.log('Please provide an answer, or type "quit" to pause.\n');
        continue;
      }

      // Record answer
      await recordAnswer(username, session.sessionId, currentQuestion.id, answer);
      session = await loadSession(username, session.sessionId);
      if (!session) {
        console.error('Failed to reload session');
        process.exit(1);
      }
    }

    rl.close();

    if (session.status === 'completed') {
      console.log('Finalizing session and extracting persona data...\n');

      // Extract persona
      const extracted = await extractPersonaFromSession(session);

      // Load existing persona
      const currentPersona = loadExistingPersona(systemPaths.personaCore);

      // Generate diff
      const { updated, diff } = mergePersonaDraft(currentPersona, extracted, 'merge');
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
        // Create backup
        const backupPath = path.join(systemPaths.persona, `core-backup-${Date.now()}.json`);
        fs.writeFileSync(backupPath, JSON.stringify(currentPersona, null, 2), 'utf-8');

        // Apply changes
        savePersona(systemPaths.personaCore, updated);

        console.log(`\n✓ Persona updated successfully!`);
        console.log(`  Backup saved to: ${backupPath}`);

        // Mark session as applied
        session.status = 'applied';
        await saveSession(username, session);

        await audit('data_change', 'info', {
          action: 'persona_applied_via_cli',
          sessionId: session.sessionId,
          diffSummary: diff.summary,
          backupPath,
          actor: 'cli',
        });
      } else {
        console.log('\nChanges not applied. You can apply later with:');
        console.log(`  mh persona apply ${session.sessionId}`);
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
  const username = process.env.USER || 'default';

  try {
    const sessions = await listSessions(username);

    if (sessions.length === 0) {
      console.log('No interview sessions found.\n');
      console.log('Start a new interview with: mh persona generate');
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
  const username = process.env.USER || 'default';

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
  const username = process.env.USER || 'default';

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
    const currentPersona = loadExistingPersona(systemPaths.personaCore);

    // Generate diff
    const { updated, diff } = mergePersonaDraft(currentPersona, extracted, strategy);
    const diffText = generateDiffText(diff);

    console.log(diffText);
    console.log('\n' + '='.repeat(50));

    // Create backup
    const backupPath = path.join(systemPaths.persona, `core-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(currentPersona, null, 2), 'utf-8');

    // Apply changes
    savePersona(systemPaths.personaCore, updated);

    console.log(`\n✓ Persona updated successfully using "${strategy}" strategy`);
    console.log(`  Backup saved to: ${backupPath}`);
    console.log(`  Changes: ${diff.summary.additions} additions, ${diff.summary.updates} updates`);

    // Mark session as applied
    session.status = 'applied';
    session.appliedAt = new Date().toISOString();
    session.appliedStrategy = strategy;
    await saveSession(username, session);

    await audit('data_change', 'info', {
      action: 'persona_applied_via_cli',
      sessionId: session.sessionId,
      strategy,
      diffSummary: diff.summary,
      backupPath,
      actor: 'cli',
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
  const username = process.env.USER || 'default';

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

    await audit('action', 'info', {
      action: 'persona_session_discarded',
      sessionId,
      actor: 'cli',
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
  const username = process.env.USER || 'default';
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

export function personaCommand(args: string[]) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'activate':
      personaActivate();
      break;
    case 'status':
      personaStatus();
      break;
    case 'diff':
      personaDiff();
      break;
    case 'generate':
      personaGenerate({ resume: subArgs.includes('--resume') });
      break;
    case 'sessions':
      personaSessions();
      break;
    case 'view':
      personaView(subArgs[0]);
      break;
    case 'apply':
      personaApply(subArgs[0], (subArgs[1] as MergeStrategy) || 'merge');
      break;
    case 'discard':
      personaDiscard(subArgs[0]);
      break;
    case 'cleanup':
      personaCleanup({
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
      console.log('  activate   - Generate and activate daily profile (run morning-loader)');
      console.log('  status     - Show current persona state (profile, adapter)');
      console.log('  diff       - Compare base persona vs active profile');
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
