/**
 * Persona Management Commands
 * Manage active profiles, adapters, and persona state
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paths, audit, getActiveAdapter } from '@metahuman/core';

export function personaActivate() {
  console.log('Activating persona profile (running morning-loader)...\n');

  const agentPath = path.join(paths.brain, 'agents', 'morning-loader.ts');

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
    cwd: paths.root,
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
  const activeProfilePath = path.join(paths.persona, 'active-profile.md');
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
  const personaCorePath = paths.personaCore;
  if (fs.existsSync(personaCorePath)) {
    const persona = JSON.parse(fs.readFileSync(personaCorePath, 'utf-8'));
    console.log(`Base Persona: ${persona.identity?.name || 'Unknown'}`);
    console.log(`  Role: ${persona.identity?.role || 'N/A'}`);
  }
}

export function personaDiff() {
  console.log('Persona Diff (Base vs Active Profile)\n');

  const activeProfilePath = path.join(paths.persona, 'active-profile.md');

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

export function personaCommand(args: string[]) {
  const subcommand = args[0];

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
    case undefined:
      console.log('Usage: mh persona <command>');
      console.log('');
      console.log('Commands:');
      console.log('  activate   - Generate and activate daily profile (run morning-loader)');
      console.log('  status     - Show current persona state (profile, adapter)');
      console.log('  diff       - Compare base persona vs active profile');
      break;
    default:
      console.log(`Unknown persona command: ${subcommand}`);
      console.log('Run `mh persona` for usage.');
      process.exit(1);
  }
}
