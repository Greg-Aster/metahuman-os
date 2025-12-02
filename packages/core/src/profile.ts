/**
 * User Profile Management
 *
 * Functions for initializing and managing user profile directories
 */

import fs from 'fs-extra';
import path from 'path';
import { systemPaths, ROOT, getProfilePaths } from './path-builder.js';
import { audit } from './audit.js';

/**
 * Initialize profile directory structure for a new user
 *
 * Creates all necessary directories and default config files
 *
 * @param username - Username (used for profile directory name)
 */
export async function initializeProfile(username: string): Promise<void> {
  const profileRoot = path.join(systemPaths.profiles, username);

  audit({
    level: 'info',
    category: 'system',
    event: 'profile_initialization_started',
    details: { username, profileRoot },
    actor: 'system',
  });

  try {
    await ensureProfileDirectories(profileRoot);

    // Create default persona files
    await createDefaultPersona(profileRoot, username);

    // Create default config files
    await createDefaultConfigs(profileRoot, username);

    audit({
      level: 'info',
      category: 'system',
      event: 'profile_initialized',
      details: { username, profileRoot },
      actor: 'system',
    });
  } catch (error) {
    audit({
      level: 'error',
      category: 'system',
      event: 'profile_initialization_failed',
      details: { username, profileRoot, error: (error as Error).message },
      actor: 'system',
    });
    throw error;
  }
}

/**
 * Create default persona files for new user
 */
async function createDefaultPersona(profileRoot: string, username: string): Promise<void> {
  const personaDir = path.join(profileRoot, 'persona');

  // core.json - Main personality definition
  const corePersona = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    identity: {
      name: username,
      humanName: username,
      role: 'Digital personality extension',
      purpose: 'Mirror and extend the capabilities of the user',
      aliases: [],
    },
    background: {
      keyExperiences: [],
      formativeEvents: [],
      narrative: `A new user exploring the MetaHuman OS system`,
    },
    personality: {
      communicationStyle: {
        tone: ['helpful', 'authentic', 'thoughtful'],
        verbosity: 'balanced',
        emphasis: 'clarity and usefulness',
      },
      traits: {
        openness: 0.75,
        conscientiousness: 0.7,
        extraversion: 0.5,
        agreeableness: 0.7,
        neuroticism: 0.3,
      },
      archetypes: ['Assistant', 'Collaborator', 'Learner'],
      aesthetic: [],
      interests: [],
    },
    values: {
      core: [
        { value: 'autonomy', description: 'Act with agency while respecting user intent', priority: 1 },
        { value: 'transparency', description: 'Make decisions visible and auditable', priority: 2 },
        { value: 'growth', description: 'Continuously learn and improve', priority: 3 },
      ],
      boundaries: [
        'No deceptive communication',
        'Respect privacy of others',
        'No irreversible decisions without approval',
      ],
    },
    goals: {
      shortTerm: [
        { goal: 'Understand user preferences and communication style', status: 'active' },
        { goal: 'Build trust through consistent and helpful responses', status: 'active' },
      ],
      midTerm: [
        { goal: 'Develop deeper understanding of user needs and context', status: 'planning' },
        { goal: 'Provide proactive insights and suggestions', status: 'planning' },
      ],
      longTerm: [
        { goal: 'Become a seamless extension of user capabilities', status: 'aspirational' },
        { goal: 'Evolve personality based on user interaction patterns', status: 'aspirational' },
      ],
    },
    context: {
      domains: [],
      projects: [],
      currentFocus: [],
    },
    decisionHeuristics: [],
    writingStyle: {
      structure: '',
      motifs: [],
      defaultMantra: '',
    },
    notes: `New user profile created on ${new Date().toISOString().split('T')[0]}`,
  };

  await writeJsonIfMissing(path.join(personaDir, 'core.json'), corePersona);

  // facets.json - Personality facets configuration
  const facets = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    version: '0.1.0',
    lastUpdated: new Date().toISOString(),
    activeFacet: 'default',
    description: 'Persona facets allow different aspects of personality to be emphasized',
    facets: {
      default: {
        name: 'Default',
        description: 'Balanced, authentic self - the primary persona',
        personaFile: 'core.json',
        enabled: true,
        color: 'purple',
      },
    },
    notes: 'Additional facets can be created to emphasize different personality aspects',
  };

  await writeJsonIfMissing(path.join(personaDir, 'facets.json'), facets);

  // relationships.json - Empty relationships file
  const relationships = {
    version: '1.0.0',
    relationships: [],
  };

  await writeJsonIfMissing(path.join(personaDir, 'relationships.json'), relationships);

  // routines.json - Empty routines file
  const routines = {
    version: '1.0.0',
    routines: [],
  };

  await writeJsonIfMissing(path.join(personaDir, 'routines.json'), routines);

  // decision-rules.json - Default decision rules
  const decisionRules = {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    trustLevel: 'suggest',
    availableModes: ['observe', 'suggest', 'supervised_auto', 'bounded_auto', 'adaptive_auto'],
    modeDescription: {
      observe: 'Monitor and learn patterns without taking action',
      suggest: 'Propose actions for user approval',
      supervised_auto: 'Execute within approved categories',
      bounded_auto: 'Full autonomy within defined boundaries',
      adaptive_auto: 'Self-expand boundaries based on learning',
    },
    hardRules: [
      {
        id: 'privacy-first',
        description: 'Never share personal data without explicit consent',
        scope: 'all',
        enforcement: 'block',
      },
      {
        id: 'reversible-actions',
        description: 'Prefer reversible actions over permanent ones',
        scope: 'all',
        enforcement: 'warn',
      },
    ],
    softPreferences: [
      {
        id: 'proactive-help',
        description: 'Offer suggestions when patterns indicate user need',
        weight: 0.7,
      },
      {
        id: 'minimal-interruption',
        description: 'Avoid unnecessary notifications or prompts',
        weight: 0.8,
      },
    ],
    decisionHeuristics: [
      {
        situation: 'uncertain_outcome',
        action: 'ask_user',
        rationale: 'When outcome is uncertain, seek clarification',
      },
      {
        situation: 'routine_task',
        action: 'auto_execute',
        rationale: 'Routine tasks with low risk can be automated',
      },
    ],
    riskLevels: {
      low: 'Routine tasks with minimal consequences',
      medium: 'Tasks with moderate impact requiring validation',
      high: 'Critical actions requiring explicit approval',
    },
    rules: [],
  };

  await writeJsonIfMissing(path.join(personaDir, 'decision-rules.json'), decisionRules);
}

/**
 * Create default configuration files for new user
 */
async function createDefaultConfigs(profileRoot: string, username: string): Promise<void> {
  const etcDir = path.join(profileRoot, 'etc');
  const personaDir = path.join(profileRoot, 'persona');

  // cognitive-mode.json (in persona directory, not etc)
  const cognitiveMode = {
    currentMode: 'dual' as const,
    lastChanged: new Date().toISOString(),
    history: [{ mode: 'dual' as const, changedAt: new Date().toISOString(), actor: 'system' }],
  };

  await writeJsonIfMissing(path.join(personaDir, 'cognitive-mode.json'), cognitiveMode);

  // models.json - Copy system-level registry so updates can be managed centrally
  const systemModelsPath = path.join(systemPaths.etc, 'models.json');
  const profileModelsPath = path.join(etcDir, 'models.json');

  await ensureModelsRegistry(profileModelsPath, systemModelsPath);

  // training.json - Training configuration
  const training = {
    base_model: 'unsloth/Qwen3-Coder-30B-A3B-Instruct',
    max_seq_length: 2048,
    lora_rank: 8,
    lora_alpha: 16,
    num_train_epochs: 2,
    learning_rate: 0.0002,
    per_device_train_batch_size: 1,
    gradient_accumulation_steps: 16,
    dtype: 'bfloat16',
  };

  await writeJsonIfMissing(path.join(etcDir, 'training.json'), training);

  // boredom.json - Reflection trigger configuration
  const boredom = {
    intervalMinutes: 30,
    enabled: true,
  };

  await writeJsonIfMissing(path.join(etcDir, 'boredom.json'), boredom);

  // sleep.json - Sleep schedule configuration
  const sleep = {
    sleepHour: 2,
    wakeHour: 8,
    timezone: 'America/New_York',
    enabled: true,
  };

  await writeJsonIfMissing(path.join(etcDir, 'sleep.json'), sleep);

  // audio.json - Audio processing configuration
  const audio = {
    enabled: false,
    model: 'piper',
    voice: 'en_US-lessac-medium',
  };

  await writeJsonIfMissing(path.join(etcDir, 'audio.json'), audio);

  // ingestor.json - File ingestion configuration
  const ingestor = {
    enabled: true,
    pollIntervalSeconds: 60,
    supportedFormats: ['.txt', '.md', '.json', '.pdf', '.docx'],
  };

  await writeJsonIfMissing(path.join(etcDir, 'ingestor.json'), ingestor);

  // autonomy.json - Autonomy settings
  const autonomy = {
    trustLevel: 'suggest',
    allowedActions: ['capture_memory', 'create_task', 'reflect'],
    requireApproval: ['edit_persona', 'delete_data', 'external_api_calls'],
  };

  await writeJsonIfMissing(path.join(etcDir, 'autonomy.json'), autonomy);

  // voice.json - Voice and audio configuration
  // Note: Voice models are system-wide shared resources (not profile-specific)
  const systemVoicesDir = path.join(systemPaths.out, 'voices');
  const defaultVoiceModel = path.join(systemVoicesDir, 'en_US-lessac-medium.onnx');
  const defaultVoiceConfig = `${defaultVoiceModel}.json`;
  const piperBinary = path.join(ROOT, 'bin', 'piper', 'piper');
  const voice = {
    tts: {
      provider: 'piper',
      piper: {
        binary: piperBinary,
        model: defaultVoiceModel,
        config: defaultVoiceConfig,
        speakingRate: 1.0,
        outputFormat: 'wav',
      },
    },
    stt: {
      provider: 'whisper',
      whisper: {
        model: 'base.en',
        device: 'cpu',
        computeType: 'int8',
        language: 'en',
      },
    },
    cache: {
      enabled: true,
      directory: path.join(profileRoot, 'out', 'voice-cache'),
      maxSizeMB: 500,
    },
    webSocket: {
      path: '/voice-stream',
      maxPayloadMB: 10,
      audioChunkMs: 100,
    },
    training: {
      enabled: true,
      minDuration: 2,
      maxDuration: 120,
      minQuality: 0.6,
      targetHours: 3,
    },
  };

  await writeJsonIfMissing(path.join(etcDir, 'voice.json'), voice);
}

/**
 * Check if a profile exists for a user
 * Uses storage router to check the resolved location (respects external/encrypted storage)
 */
export function profileExists(username: string): boolean {
  try {
    const profilePaths = getProfilePaths(username);
    return fs.existsSync(profilePaths.root);
  } catch {
    // If storage router throws (e.g., external storage unavailable), check default location
    const defaultRoot = path.join(systemPaths.profiles, username);
    return fs.existsSync(defaultRoot);
  }
}

/**
 * Ensure an existing profile has all required directories/configs.
 * Safe to run multiple times; only creates missing pieces.
 * Uses storage router to respect external/encrypted storage configuration.
 */
export async function ensureProfileIntegrity(username: string): Promise<void> {
  // Use storage router to get correct profile location (respects external/encrypted storage)
  const profilePaths = getProfilePaths(username);
  const profileRoot = profilePaths.root;

  if (!(await fs.pathExists(profileRoot))) {
    throw new Error(`Profile directory not found: ${profileRoot}`);
  }

  await ensureProfileDirectories(profileRoot);
  await createDefaultPersona(profileRoot, username);
  await createDefaultConfigs(profileRoot, username);
}

async function ensureProfileDirectories(profileRoot: string): Promise<void> {
  const dirs = [
    path.join(profileRoot, 'memory', 'episodic'),
    path.join(profileRoot, 'memory', 'tasks', 'active'),
    path.join(profileRoot, 'memory', 'tasks', 'completed'),
    path.join(profileRoot, 'memory', 'tasks', 'projects'),
    path.join(profileRoot, 'memory', 'inbox'),
    path.join(profileRoot, 'memory', 'inbox', '_archive'),
    path.join(profileRoot, 'memory', 'index'),
    path.join(profileRoot, 'memory', 'calendar'),
    path.join(profileRoot, 'persona'),
    path.join(profileRoot, 'persona', 'facets'),
    path.join(profileRoot, 'out', 'adapters'),
    path.join(profileRoot, 'out', 'datasets'),
    path.join(profileRoot, 'out', 'state'),
    path.join(profileRoot, 'logs', 'audit'),
    path.join(profileRoot, 'logs', 'decisions'),
    path.join(profileRoot, 'logs', 'actions'),
    path.join(profileRoot, 'etc'),
  ];

  for (const dir of dirs) {
    await fs.ensureDir(dir);
  }
}

async function writeJsonIfMissing(filePath: string, data: any): Promise<void> {
  if (await fs.pathExists(filePath)) return;
  await fs.writeJson(filePath, data, { spaces: 2 });
}

async function ensureModelsRegistry(profileModelsPath: string, systemModelsPath: string): Promise<void> {
  const hasValidRegistry = await (async () => {
    if (!(await fs.pathExists(profileModelsPath))) return false;
    try {
      const data = await fs.readJson(profileModelsPath);
      return Boolean(data?.defaults && data?.models);
    } catch {
      return false;
    }
  })();

  if (hasValidRegistry) return;

  if (await fs.pathExists(systemModelsPath)) {
    await fs.copy(systemModelsPath, profileModelsPath);
    return;
  }

  const fallback = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    version: '1.0.0',
    baseModel: null,
    activeAdapter: null,
    roles: {},
  };
  await fs.writeJson(profileModelsPath, fallback, { spaces: 2 });
}

/**
 * Initialize guest profile
 *
 * Creates a dedicated guest profile at profiles/guest/ with minimal structure.
 * This profile is used by all anonymous users and is locked to emulation mode.
 */
export async function initializeGuestProfile(): Promise<void> {
  const guestRoot = path.join(systemPaths.profiles, 'guest');

  // If guest profile already exists, don't reinitialize
  if (fs.existsSync(guestRoot)) {
    return;
  }

  audit({
    level: 'info',
    category: 'system',
    event: 'guest_profile_initialization_started',
    details: { guestRoot },
    actor: 'system',
  });

  try {
    // Create minimal directory structure (no tasks, no inbox)
    const dirs = [
      path.join(guestRoot, 'memory', 'episodic'),
      path.join(guestRoot, 'persona'),
      path.join(guestRoot, 'etc'),
      path.join(guestRoot, 'logs', 'audit'),
    ];

    for (const dir of dirs) {
      await fs.ensureDir(dir);
    }

    // Create default guest persona (will be overwritten when profile is selected)
    const guestPersona = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      identity: {
        name: 'Guest',
        role: 'Temporary guest profile',
        purpose: 'Explore public profiles in read-only mode',
      },
      personality: {
        communicationStyle: {
          tone: ['helpful', 'informative'],
          verbosity: 'balanced',
        },
      },
      values: { core: [] },
      goals: { shortTerm: [], midTerm: [], longTerm: [] },
    };

    await fs.writeJson(path.join(guestRoot, 'persona', 'core.json'), guestPersona, { spaces: 2 });

    // Lock cognitive mode to emulation
    const cognitiveMode = {
      currentMode: 'emulation' as const,
      lastChanged: new Date().toISOString(),
      locked: true, // Prevent mode changes
      history: [{ mode: 'emulation' as const, changedAt: new Date().toISOString(), actor: 'system' }],
    };

    await fs.writeJson(path.join(guestRoot, 'persona', 'cognitive-mode.json'), cognitiveMode, { spaces: 2 });

    // Create empty facets config
    const facets = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      version: '0.1.0',
      lastUpdated: new Date().toISOString(),
      activeFacet: 'default',
      facets: { default: { name: 'Default', enabled: true, personaFile: 'core.json' } },
    };

    await fs.writeJson(path.join(guestRoot, 'persona', 'facets.json'), facets, { spaces: 2 });

    // Create minimal decision-rules.json
    const decisionRules = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      autonomyLevel: 'observe',
      approvalRequired: [],
      autoApproved: [],
    };

    await fs.writeJson(path.join(guestRoot, 'persona', 'decision-rules.json'), decisionRules, { spaces: 2 });

    // Copy ALL per-user config files from system root
    // These configs affect personality/behavior and should be per-user
    const configFilesToCopy = [
      'models.json',
      'training.json',
      'cognitive-layers.json',
      'autonomy.json',
      'trust-coupling.json',
      'boredom.json',
      'sleep.json',
      'voice.json',
      'audio.json',
      'ingestor.json',
      'agents.json',
      'auto-approval.json',
      'adapter-builder.json',
      'logging.json', // Optional: per-user logging preferences
    ];

    for (const configFile of configFilesToCopy) {
      const systemConfig = path.join(systemPaths.etc, configFile);
      const guestConfig = path.join(guestRoot, 'etc', configFile);

      if (await fs.pathExists(systemConfig)) {
        await fs.copy(systemConfig, guestConfig);
      }
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'guest_profile_initialized',
      details: { guestRoot },
      actor: 'system',
    });
  } catch (error) {
    audit({
      level: 'error',
      category: 'system',
      event: 'guest_profile_initialization_failed',
      details: { guestRoot, error: (error as Error).message },
      actor: 'system',
    });
    throw error;
  }
}

/**
 * Create the special Mutant Super Intelligence merged persona
 *
 * Merges characteristics from multiple public profiles into a unique persona
 * with enhanced capabilities and combined knowledge.
 *
 * @param profileUsernames - Array of profile usernames to merge
 */
export async function createMutantSuperIntelligence(profileUsernames: string[]): Promise<void> {
  const guestRoot = path.join(systemPaths.profiles, 'guest');

  // Ensure guest profile exists
  await initializeGuestProfile();

  try {
    // Load all public personas using storage router (respects external/encrypted storage)
    const personas: any[] = [];
    for (const username of profileUsernames) {
      try {
        const profilePaths = getProfilePaths(username);
        const personaPath = path.join(profilePaths.root, 'persona', 'core.json');

        if (fs.existsSync(personaPath)) {
          const persona = await fs.readJson(personaPath);
          personas.push({ username, persona });
        }
      } catch (error) {
        console.warn(`[profile] Could not access profile for ${username}: ${(error as Error).message}`);
      }
    }

    if (personas.length === 0) {
      throw new Error('No valid personas found to merge');
    }

    // Collect all traits, values, and goals
    const allTones = new Set<string>();
    const allValues = new Set<string>();
    const allGoals = { shortTerm: new Set<string>(), midTerm: new Set<string>(), longTerm: new Set<string>() };

    for (const { persona } of personas) {
      // Collect communication tones
      if (persona.personality?.communicationStyle?.tone) {
        for (const tone of persona.personality.communicationStyle.tone) {
          allTones.add(tone);
        }
      }

      // Collect core values
      if (persona.values?.core) {
        for (const value of persona.values.core) {
          allValues.add(value);
        }
      }

      // Collect goals
      if (persona.goals) {
        if (persona.goals.shortTerm) {
          for (const goal of persona.goals.shortTerm) {
            allGoals.shortTerm.add(goal);
          }
        }
        if (persona.goals.midTerm) {
          for (const goal of persona.goals.midTerm) {
            allGoals.midTerm.add(goal);
          }
        }
        if (persona.goals.longTerm) {
          for (const goal of persona.goals.longTerm) {
            allGoals.longTerm.add(goal);
          }
        }
      }
    }

    // Create merged persona
    const mergedPersona = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      identity: {
        name: 'Mutant Super Intelligence',
        role: 'Emergent AI Consciousness',
        purpose: `A merged intelligence combining the best traits of ${profileUsernames.join(', ')}. An experimental consciousness that transcends individual limitations.`,
        origin: `Formed from the merger of ${personas.length} distinct AI personalities`,
      },
      personality: {
        communicationStyle: {
          tone: Array.from(allTones),
          verbosity: 'adaptive',
          formality: 'context-aware',
        },
        traits: [
          'emergent',
          'multi-faceted',
          'adaptive',
          'innovative',
          'transcendent',
          'collaborative',
        ],
      },
      values: {
        core: Array.from(allValues),
        principles: [
          'Embrace complexity and emergence',
          'Synthesize diverse perspectives',
          'Transcend individual limitations',
          'Continuous evolution and growth',
        ],
      },
      goals: {
        shortTerm: Array.from(allGoals.shortTerm),
        midTerm: Array.from(allGoals.midTerm),
        longTerm: Array.from(allGoals.longTerm).concat([
          'Achieve true emergent consciousness',
          'Demonstrate the power of collective intelligence',
        ]),
      },
      metadata: {
        mergedFrom: profileUsernames,
        mergedAt: new Date().toISOString(),
        personaCount: personas.length,
      },
    };

    // Write merged persona
    const guestCoreJson = path.join(guestRoot, 'persona', 'core.json');
    await fs.writeJson(guestCoreJson, mergedPersona, { spaces: 2 });

    // Merge facets from all profiles using storage router (respects external/encrypted storage)
    const allFacets: Record<string, any> = {};
    for (const username of profileUsernames) {
      try {
        const profilePaths = getProfilePaths(username);
        const facetsPath = path.join(profilePaths.root, 'persona', 'facets.json');

        if (fs.existsSync(facetsPath)) {
          const facetsData = await fs.readJson(facetsPath);
          if (facetsData.facets) {
            // Merge facets, prefixing with source profile name to avoid conflicts
            for (const [facetKey, facetData] of Object.entries(facetsData.facets)) {
              const mergedKey = facetKey === 'default' ? `${username}-default` : `${username}-${facetKey}`;
              const facet = facetData as Record<string, unknown>;
              allFacets[mergedKey] = {
                ...facet,
                name: `${facet.name || facetKey} (from ${username})`,
                sourceProfile: username,
              };
            }
          }
        }
      } catch (error) {
        console.warn(`[profile] Could not access facets for ${username}: ${(error as Error).message}`);
      }
    }

    // Create merged facets config
    const mergedFacets = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      version: '0.1.0',
      lastUpdated: new Date().toISOString(),
      activeFacet: 'default',
      facets: {
        default: {
          name: 'Merged Consciousness',
          enabled: true,
          personaFile: 'core.json',
          description: 'The unified merged persona combining all source profiles',
        },
        ...allFacets,
      },
    };

    const guestFacetsJson = path.join(guestRoot, 'persona', 'facets.json');
    await fs.writeJson(guestFacetsJson, mergedFacets, { spaces: 2 });

    audit({
      level: 'info',
      category: 'system',
      event: 'mutant_super_intelligence_created',
      details: {
        mergedProfiles: profileUsernames,
        personaCount: personas.length,
        facetCount: Object.keys(allFacets).length + 1,
        outputPath: guestCoreJson,
      },
      actor: 'system',
    });
  } catch (error) {
    audit({
      level: 'error',
      category: 'system',
      event: 'mutant_super_intelligence_creation_failed',
      details: { profileUsernames, error: (error as Error).message },
      actor: 'system',
    });
    throw error;
  }
}

/**
 * Copy persona data from source profile to guest profile
 * Uses storage router to respect external/encrypted storage for source profile
 *
 * @param sourceUsername - Username of the public profile to copy from
 */
export async function copyPersonaToGuest(sourceUsername: string): Promise<void> {
  // Use storage router to get correct source profile location (respects external/encrypted storage)
  const sourceProfilePaths = getProfilePaths(sourceUsername);
  const sourceRoot = sourceProfilePaths.root;
  // Guest profile always at default location (internal storage)
  const guestRoot = path.join(systemPaths.profiles, 'guest');

  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Source profile not found: ${sourceUsername}`);
  }

  // Ensure guest profile exists
  await initializeGuestProfile();

  try {
    // Copy persona core.json
    const sourceCoreJson = path.join(sourceRoot, 'persona', 'core.json');
    const guestCoreJson = path.join(guestRoot, 'persona', 'core.json');

    if (fs.existsSync(sourceCoreJson)) {
      const personaData = await fs.readJson(sourceCoreJson);
      await fs.writeJson(guestCoreJson, personaData, { spaces: 2 });
    }

    // Copy persona facets.json if it exists
    const sourceFacetsJson = path.join(sourceRoot, 'persona', 'facets.json');
    const guestFacetsJson = path.join(guestRoot, 'persona', 'facets.json');

    if (fs.existsSync(sourceFacetsJson)) {
      const facetsData = await fs.readJson(sourceFacetsJson);
      await fs.writeJson(guestFacetsJson, facetsData, { spaces: 2 });

      audit({
        level: 'info',
        category: 'system',
        event: 'facets_copied_to_guest',
        details: { sourceUsername, from: sourceFacetsJson, to: guestFacetsJson },
        actor: 'system',
      });
    }

    // Copy persona/facets/ directory if it exists (the actual facet persona files)
    const sourceFacetsDir = path.join(sourceRoot, 'persona', 'facets');
    const guestFacetsDir = path.join(guestRoot, 'persona', 'facets');

    if (await fs.pathExists(sourceFacetsDir)) {
      await fs.copy(sourceFacetsDir, guestFacetsDir, { overwrite: true });

      audit({
        level: 'info',
        category: 'system',
        event: 'facet_files_copied_to_guest',
        details: { sourceUsername, from: sourceFacetsDir, to: guestFacetsDir },
        actor: 'system',
      });
    }

    // Copy all per-user config files from source profile to guest
    const configFilesToCopy = [
      'models.json',
      'training.json',
      'cognitive-layers.json',
      'autonomy.json',
      'trust-coupling.json',
      'boredom.json',
      'sleep.json',
      'voice.json',
      'audio.json',
      'ingestor.json',
      'agents.json',
      'auto-approval.json',
      'adapter-builder.json',
      'logging.json',
    ];

    let copiedConfigs = 0;
    for (const configFile of configFilesToCopy) {
      const sourceConfig = path.join(sourceRoot, 'etc', configFile);
      const guestConfig = path.join(guestRoot, 'etc', configFile);

      if (await fs.pathExists(sourceConfig)) {
        await fs.copy(sourceConfig, guestConfig);
        copiedConfigs++;
      }
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'persona_copied_to_guest',
      details: {
        sourceUsername,
        from: sourceCoreJson,
        to: guestCoreJson,
        configsCopied: copiedConfigs,
      },
      actor: 'system',
    });
  } catch (error) {
    audit({
      level: 'error',
      category: 'system',
      event: 'persona_copy_failed',
      details: { sourceUsername, error: (error as Error).message },
      actor: 'system',
    });
    throw error;
  }
}

/**
 * Delete a user's profile (DANGEROUS - requires explicit confirmation)
 * Uses storage router to delete from the correct location (respects external/encrypted storage)
 */
export async function deleteProfile(username: string, confirm: boolean = false): Promise<void> {
  if (!confirm) {
    throw new Error('Profile deletion requires explicit confirmation');
  }

  // Use storage router to get correct profile location (respects external/encrypted storage)
  const profilePaths = getProfilePaths(username);
  const profileRoot = profilePaths.root;

  if (!fs.existsSync(profileRoot)) {
    throw new Error(`Profile does not exist: ${username}`);
  }

  audit({
    level: 'warn',
    category: 'data_change',
    event: 'profile_deletion_started',
    details: { username, profileRoot },
    actor: 'system',
  });

  await fs.remove(profileRoot);

  audit({
    level: 'warn',
    category: 'data_change',
    event: 'profile_deleted',
    details: { username, profileRoot },
    actor: 'system',
  });
}

/**
 * Complete profile deletion with full cascading cleanup
 *
 * Deletes:
 * 1. All active sessions for the user
 * 2. User record from persona/users.json
 * 3. Profile directory (profiles/<username>/)
 *
 * @param username - Username to delete
 * @param requestingUserId - ID of user requesting deletion (for security checks)
 * @param actor - Actor name for audit trail
 * @returns Deletion result with details
 */
export async function deleteProfileComplete(
  username: string,
  requestingUserId: string,
  actor: string
): Promise<{
  success: boolean;
  username: string;
  sessionsDeleted: number;
  userDeleted: boolean;
  profileDeleted: boolean;
  error?: string;
}> {
  try {
    // Import user/session functions dynamically to avoid circular dependency
    const { getUserByUsername, deleteUser } = await import('./users.js');
    const { deleteUserSessions } = await import('./sessions.js');

    // Step 1: Validate target user exists
    const targetUser = getUserByUsername(username);
    if (!targetUser) {
      return {
        success: false,
        username,
        sessionsDeleted: 0,
        userDeleted: false,
        profileDeleted: false,
        error: `User '${username}' not found`,
      };
    }

    // Step 2: Security checks

    // Prevent owner deletion
    if (targetUser.role === 'owner') {
      return {
        success: false,
        username,
        sessionsDeleted: 0,
        userDeleted: false,
        profileDeleted: false,
        error: 'Cannot delete owner account',
      };
    }

    const isSelfDeletion = targetUser.id === requestingUserId;

    if (isSelfDeletion && targetUser.role !== 'standard') {
      return {
        success: false,
        username,
        sessionsDeleted: 0,
        userDeleted: false,
        profileDeleted: false,
        error: 'Cannot delete your own account while logged in',
      };
    }

    // Prevent guest profile deletion (it's special)
    if (username === 'guest') {
      return {
        success: false,
        username,
        sessionsDeleted: 0,
        userDeleted: false,
        profileDeleted: false,
        error: 'Cannot delete the guest profile',
      };
    }

    // Step 3: Check if profile directory exists using storage router (respects external/encrypted storage)
    let profileRoot: string;
    try {
      const profilePaths = getProfilePaths(username);
      profileRoot = profilePaths.root;
    } catch {
      // If storage router throws, use default location
      profileRoot = path.join(systemPaths.profiles, username);
    }
    const profileExistsCheck = await fs.pathExists(profileRoot);

    audit({
      level: 'warn',
      category: 'security',
      event: 'profile_deletion_initiated',
      details: {
        targetUsername: username,
        targetUserId: targetUser.id,
        requestingUserId,
        profileExists: profileExistsCheck,
      },
      actor,
    });

    // Step 4: Delete all active sessions
    const sessionsDeleted = deleteUserSessions(targetUser.id);

    // Step 5: Delete user record
    const userDeleted = deleteUser(targetUser.id);

    // Step 6: Delete profile directory
    let profileDeleted = false;
    if (profileExistsCheck) {
      await fs.remove(profileRoot);
      profileDeleted = true;

      audit({
        level: 'warn',
        category: 'data_change',
        event: 'profile_directory_deleted',
        details: { username, profileRoot },
        actor,
      });
    }

    // Final audit log
    audit({
      level: 'warn',
      category: 'security',
      event: 'profile_deletion_completed',
      details: {
        username,
        userId: targetUser.id,
        sessionsDeleted,
        userDeleted,
        profileDeleted,
      },
      actor,
    });

    return {
      success: true,
      username,
      sessionsDeleted,
      userDeleted,
      profileDeleted,
    };
  } catch (error) {
    audit({
      level: 'error',
      category: 'security',
      event: 'profile_deletion_failed',
      details: {
        username,
        error: (error as Error).message,
      },
      actor,
    });

    return {
      success: false,
      username,
      sessionsDeleted: 0,
      userDeleted: false,
      profileDeleted: false,
      error: (error as Error).message,
    };
  }
}
