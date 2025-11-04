// Enhanced init function with template copying
function init(): void {
  // Create all required directories
  const dirs = [
    paths.persona,
    paths.episodic,
    paths.semantic,
    paths.procedural,
    paths.preferences,
    paths.inbox,
    paths.inboxArchive,
    paths.audioInbox,
    paths.audioTranscripts,
    paths.audioArchive,
    paths.tasks + '/active',
    paths.tasks + '/completed',
    paths.tasks + '/projects',
    paths.agents,
    paths.skills,
    paths.policies,
    paths.decisions,
    paths.actions,
    paths.sync,
    paths.logs + '/audit',
    paths.out,
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log('✓ Directory structure created');

  // Check if persona files exist, if not copy templates
  const personaFiles = [
    { src: path.join(paths.persona, 'core.json.template'), dest: paths.personaCore },
    { src: path.join(paths.persona, 'relationships.json.template'), dest: paths.personaRelationships },
    { src: path.join(paths.persona, 'routines.json.template'), dest: paths.personaRoutines },
    { src: path.join(paths.persona, 'decision-rules.json.template'), dest: paths.personaDecisionRules },
  ];

  // Copy template files if they don't exist and templates are available
  let copiedTemplates = false;
  if (!fs.existsSync(paths.personaCore)) {
    for (const { src, dest } of personaFiles) {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        copiedTemplates = true;
        console.log(`✓ Copied template: ${path.basename(dest)}`);
      } else {
        // If no templates exist, create minimal default files
        createMinimalPersonaFile(dest);
        copiedTemplates = true;
        console.log(`✓ Created minimal default: ${path.basename(dest)}`);
      }
    }
  }

  // Check if persona files exist
  if (fs.existsSync(paths.personaCore) && !copiedTemplates) {
    console.log('✓ Persona already initialized');
    console.log('\nRun: mh status');

    // Audit initialization
    audit({
      level: 'info',
      category: 'system',
      event: 'system_reinitialized',
      actor: 'human',
    });
  } else if (copiedTemplates) {
    console.log('✓ Persona template files initialized');
    console.log('\n📝 Next steps:');
    console.log('  1. Edit persona/core.json with your details');
    console.log('  2. Update persona/routines.json with your schedule');
    console.log('  3. Run: mh status');

    // Audit first-time init
    audit({
      level: 'info',
      category: 'system',
      event: 'system_initialized',
      details: { firstTime: true },
      actor: 'human',
    });
  }
}

function createMinimalPersonaFile(filepath: string): void {
  const filename = path.basename(filepath);
  let content: any;

  switch (filename) {
    case 'core.json':
      content = {
        version: "1.0.0",
        lastUpdated: new Date().toISOString(),
        identity: {
          name: "MetaHuman OS",
          role: "Autonomous digital personality extension",
          purpose: "Extend cognitive abilities and assist with daily tasks"
        },
        personality: {},
        values: { core: [] },
        goals: { shortTerm: [], midTerm: [], longTerm: [] },
        context: { domains: [], projects: [], currentFocus: [] }
      };
      break;
    case 'relationships.json':
      content = {
        version: "1.0.0",
        relationships: [],
        contacts: [],
        socialCircles: []
      };
      break;
    case 'routines.json':
      content = {
        version: "1.0.0",
        sleep: { schedule: { start: "23:00", end: "07:00" } },
        work: { schedule: { weekday: { start: "09:00", end: "18:00" } } }
      };
      break;
    case 'decision-rules.json':
      content = {
        version: "1.0.0",
        trustLevel: "observe",
        availableModes: ["observe", "suggest", "supervised_auto", "bounded_auto"]
      };
      break;
    default:
      content = { version: "1.0.0" };
  }

  fs.writeFileSync(filepath, JSON.stringify(content, null, 2));
}