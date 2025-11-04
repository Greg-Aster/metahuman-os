#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

type Cmd = 'help'|'init'|'brief'|'plan'|'memory'|'weekly';

const repoRoot = path.resolve(process.cwd(), '..', '..');
const brainDir = path.join(repoRoot, 'brain');
const outDir = path.join(repoRoot, 'out');
const memoryDir = path.join(repoRoot, 'memory');

function today() {
  return new Date().toISOString().slice(0,10);
}

function ensureDirs() {
  const dirs = [
    path.join(brainDir, 'journal'),
    path.join(brainDir, 'inbox'),
    path.join(outDir, 'daily'),
    path.join(memoryDir, 'episodic'),
    path.join(memoryDir, 'semantic'),
    path.join(memoryDir, 'preferences'),
    path.join(memoryDir, 'tasks'),
    path.join(memoryDir, 'index'),
  ];
  dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));
}

function ensureDailyNote() {
  const d = today();
  const f = path.join(brainDir, 'journal', `${d}.md`);
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, `# ${d} — Daily Note\n\n## One Main Thing\n- [ ] \n\n## Top 3\n- [ ] \n- [ ] \n- [ ] \n\n## Blocks / Risks\n- \n\n## Quick Capture\n- \n\n## Linkbacks\n- [[TODO]]\n`);
  }
  return f;
}

function makeBrief() {
  const d = today();
  const f = path.join(outDir, 'daily', `${d}.md`);
  const carryovers = collectCarryovers();
  const y = new Date(Date.now() - 24*3600*1000).toISOString().slice(0,10);
  const yFile = path.join(brainDir, 'journal', `${y}.md`);
  const yExists = fs.existsSync(yFile);
  const yOpen = yExists ? fs.readFileSync(yFile, 'utf8') : '';
  const yMain = yOpen.split('\n').slice(0,200).join('\n');
  const body = [
    `# ${d} — Daily Brief`,
    '',
    'Hello, here’s your brief.',
    '',
    '## Carryovers (open tasks)',
    carryovers.trim() || '- (none)',
    '',
    '## Yesterday snapshot',
    yExists ? '### One Main Thing (yesterday)\n' + yMain : '- No note found for yesterday.',
    '',
    '## Today’s Template',
    '- Set your One Main Thing in today’s note.',
    '- Pick Top 3. Move blockers to “Blocks / Risks.”',
    '',
    '## Links',
    `- [[${d}]] (today)`,
    yExists ? `- [[${y}]] (yesterday)` : ''
  ].join('\n');
  fs.writeFileSync(f, body);
  return f;
}

function collectCarryovers(): string {
  // Simple grep-like scan for unchecked boxes and tasks with status: todo
  const journalDir = path.join(brainDir, 'journal');
  let lines: string[] = [];
  if (fs.existsSync(journalDir)) {
    for (const file of fs.readdirSync(journalDir)) {
      if (!file.endsWith('.md')) continue;
      const txt = fs.readFileSync(path.join(journalDir, file), 'utf8');
      lines.push(...txt.split('\n').filter(l => l.startsWith('- [ ]')));
    }
  }
  const tasksDir = path.join(memoryDir, 'tasks');
  if (fs.existsSync(tasksDir)) {
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.endsWith('.md')) {
          const t = fs.readFileSync(p, 'utf8');
          const hasTodo = /^status:\s*todo\b/m.test(t);
          if (hasTodo) {
            const m = /^title:\s*(.+)$/m.exec(t);
            const title = m ? m[1].trim() : path.basename(p);
            const rel = path.relative(repoRoot, p);
            lines.push(`- [ ] ${title} (${rel})`);
          }
        }
      }
    };
    walk(tasksDir);
  }
  return lines.join('\n');
}

function makePlan() {
  const d = today();
  const f = path.join(outDir, 'daily', `${d}-plan.md`);
  const carryovers = collectCarryovers();
  const plan = `# ${d} — Today’s Plan\n\n## One Main Thing\n- \n\n## Top 3\n- \n- \n- \n\n## Carryovers\n${carryovers}\n\n## Blocks / Risks\n- \n\n## Notes\n- Preferences: see persona/profile.md\n- Memory: memory/*\n\n## Links\n- [[${d}]] (today’s note)\n`;
  fs.writeFileSync(f, plan);
  return f;
}

function weeklyReview() {
  const now = new Date();
  const oneJan = new Date(now.getFullYear(),0,1);
  const week = Math.ceil((((now.getTime() - oneJan.getTime())/86400000) + oneJan.getDay()+1)/7);
  const f = path.join(outDir, 'weekly', `${now.getFullYear()}-W${String(week).padStart(2,'0')}.md`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const body = `# Week ${week} — Weekly Review\n\n## Wins\n- \n\n## What got blocked\n- \n\n## Tasks (open)\n${collectCarryovers()}\n\n## Big rocks next week\n- \n`;
  fs.writeFileSync(f, body);
  return f;
}

function memoryAdd(kind: 'task'|'event', title: string) {
  const now = new Date();
  const year = String(now.getFullYear());
  if (kind === 'task') {
    const id = `task-${now.toISOString().replace(/[-:T.Z]/g,'').slice(0,15)}`;
    const dir = path.join(memoryDir, 'tasks', year);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${id}.md`);
    const utc = now.toISOString();
    fs.writeFileSync(f, `---\nid: ${id}\ntitle: ${title}\nstatus: todo\npriority: P2\ndue: \ndeps: []\ntags: []\ncreated: ${utc}\nupdated: ${utc}\n---\n\nDescribe the task context and acceptance here.\n`);
    return f;
  } else {
    const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
    const slug = title.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'') || 'event';
    const id = `evt-${ts.replace(/[-]/g,'')}`;
    const dir = path.join(memoryDir, 'episodic', year);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${ts}-${slug}.md`);
    fs.writeFileSync(f, `---\nid: ${id}\nwhen: ${now.toISOString()}\ntitle: ${title}\ntags: []\nlinks: []\n---\n\nSummary and outcomes.\n`);
    return f;
  }
}

function memorySearch(q: string) {
  const roots = [path.join(memoryDir), path.join(brainDir, 'journal')];
  const matches: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const txt = fs.readFileSync(p, 'utf8');
        if (txt.toLowerCase().includes(q.toLowerCase())) {
          const rel = path.relative(repoRoot, p);
          matches.push(`${rel}`);
        }
      }
    }
  };
  roots.filter(fs.existsSync).forEach(walk);
  return matches.join('\n');
}

function help() {
  console.log(`Usage: mh-ts <command>\n\nCommands:\n  init                 Scaffold directories and today’s note\n  brief                Generate today’s brief\n  plan                 Generate today’s plan\n  weekly               Generate weekly review stub\n  memory add task <t>  Create a task file\n  memory add event <t> Create an event file\n  memory search <q>    Search memory and journals\n`);
}

async function main() {
  const [, , c = 'help', ...rest] = process.argv;
  const cmd = c as Cmd;
  switch (cmd) {
    case 'init':
      ensureDirs();
      ensureDailyNote();
      console.log('Initialized scaffolding.');
      break;
    case 'brief':
      ensureDirs();
      console.log(makeBrief());
      break;
    case 'plan':
      ensureDirs();
      console.log(makePlan());
      break;
    case 'weekly':
      ensureDirs();
      console.log(weeklyReview());
      break;
    case 'memory':
      ensureDirs();
      {
        const sub = rest[0];
        if (sub === 'add') {
          const kind = (rest[1] as 'task'|'event') || 'task';
          const title = rest.slice(2).join(' ') || (kind === 'task' ? 'New task' : 'Event');
          console.log(memoryAdd(kind, title));
        } else if (sub === 'search') {
          const q = rest.slice(1).join(' ');
          if (!q) { console.error('Provide a query'); process.exit(2); }
          console.log(memorySearch(q));
        } else {
          help();
        }
      }
      break;
    case 'help':
    default:
      help();
  }
}

main().catch(err => { console.error(err); process.exit(1); });

