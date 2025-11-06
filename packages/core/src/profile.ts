/**
 * User Profile Management
 *
 * Functions for initializing and managing user profile directories
 */

import fs from 'fs-extra';
import path from 'path';
import { paths } from './paths.js';
import { audit } from './audit.js';

/**
 * Initialize profile directory structure for a new user
 *
 * Creates all necessary directories and default config files
 *
 * @param username - Username (used for profile directory name)
 */
export async function initializeProfile(username: string): Promise<void> {
  const profileRoot = path.join(paths.root, 'profiles', username);

  audit({
    level: 'info',
    category: 'system',
    event: 'profile_initialization_started',
    details: { username, profileRoot },
    actor: 'system',
  });

  try {
    // Create directory structure
    const dirs = [
      // Memory directories
      path.join(profileRoot, 'memory', 'episodic'),
      path.join(profileRoot, 'memory', 'tasks', 'active'),
      path.join(profileRoot, 'memory', 'tasks', 'completed'),
      path.join(profileRoot, 'memory', 'tasks', 'projects'),
      path.join(profileRoot, 'memory', 'inbox'),
      path.join(profileRoot, 'memory', 'inbox', '_archive'),
      path.join(profileRoot, 'memory', 'index'),
      path.join(profileRoot, 'memory', 'calendar'),
      // Persona directories
      path.join(profileRoot, 'persona'),
      path.join(profileRoot, 'persona', 'facets'),
      // Output directories
      path.join(profileRoot, 'out', 'adapters'),
      path.join(profileRoot, 'out', 'datasets'),
      path.join(profileRoot, 'out', 'state'),
      // Log directories
      path.join(profileRoot, 'logs', 'audit'),
      path.join(profileRoot, 'logs', 'decisions'),
      path.join(profileRoot, 'logs', 'actions'),
      // Config directory
      path.join(profileRoot, 'etc'),
    ];

    for (const dir of dirs) {
      await fs.ensureDir(dir);
    }

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
      role: 'Digital personality extension',
      purpose: 'Mirror and extend the capabilities of the user',
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
    },
    values: {
      core: [
        { priority: 1, value: 'autonomy', description: 'Act with agency while respecting user intent' },
        { priority: 2, value: 'transparency', description: 'Make decisions visible and auditable' },
        { priority: 3, value: 'growth', description: 'Continuously learn and improve' },
      ],
    },
    goals: {
      shortTerm: [
        'Understand user preferences and communication style',
        'Build trust through consistent and helpful responses',
      ],
      midTerm: [
        'Develop deeper understanding of user needs and context',
        'Provide proactive insights and suggestions',
      ],
      longTerm: [
        'Become a seamless extension of user capabilities',
        'Evolve personality based on user interaction patterns',
      ],
    },
  };

  await fs.writeJson(path.join(personaDir, 'core.json'), corePersona, { spaces: 2 });

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

  await fs.writeJson(path.join(personaDir, 'facets.json'), facets, { spaces: 2 });

  // relationships.json - Empty relationships file
  const relationships = {
    version: '1.0.0',
    relationships: [],
  };

  await fs.writeJson(path.join(personaDir, 'relationships.json'), relationships, { spaces: 2 });

  // routines.json - Empty routines file
  const routines = {
    version: '1.0.0',
    routines: [],
  };

  await fs.writeJson(path.join(personaDir, 'routines.json'), routines, { spaces: 2 });

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

  await fs.writeJson(path.join(personaDir, 'decision-rules.json'), decisionRules, { spaces: 2 });
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

  await fs.writeJson(path.join(personaDir, 'cognitive-mode.json'), cognitiveMode, { spaces: 2 });

  // models.json - Model preferences (use system defaults initially)
  const models = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    version: '1.0.0',
    baseModel: null, // null means use system default
    activeAdapter: null,
    roles: {}, // Empty means inherit system defaults
  };

  await fs.writeJson(path.join(etcDir, 'models.json'), models, { spaces: 2 });

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

  await fs.writeJson(path.join(etcDir, 'training.json'), training, { spaces: 2 });

  // boredom.json - Reflection trigger configuration
  const boredom = {
    intervalMinutes: 30,
    enabled: true,
  };

  await fs.writeJson(path.join(etcDir, 'boredom.json'), boredom, { spaces: 2 });

  // sleep.json - Sleep schedule configuration
  const sleep = {
    sleepHour: 2,
    wakeHour: 8,
    timezone: 'America/New_York',
    enabled: true,
  };

  await fs.writeJson(path.join(etcDir, 'sleep.json'), sleep, { spaces: 2 });

  // audio.json - Audio processing configuration
  const audio = {
    enabled: false,
    model: 'piper',
    voice: 'en_US-lessac-medium',
  };

  await fs.writeJson(path.join(etcDir, 'audio.json'), audio, { spaces: 2 });

  // ingestor.json - File ingestion configuration
  const ingestor = {
    enabled: true,
    pollIntervalSeconds: 60,
    supportedFormats: ['.txt', '.md', '.json', '.pdf', '.docx'],
  };

  await fs.writeJson(path.join(etcDir, 'ingestor.json'), ingestor, { spaces: 2 });

  // autonomy.json - Autonomy settings
  const autonomy = {
    trustLevel: 'suggest',
    allowedActions: ['capture_memory', 'create_task', 'reflect'],
    requireApproval: ['edit_persona', 'delete_data', 'external_api_calls'],
  };

  await fs.writeJson(path.join(etcDir, 'autonomy.json'), autonomy, { spaces: 2 });

  // voice.json - Voice and audio configuration
  // Note: Voice models are system-wide shared resources (not profile-specific)
  const systemVoicesDir = path.join(paths.root, 'out', 'voices');
  const defaultVoiceModel = path.join(systemVoicesDir, 'en_US-lessac-medium.onnx');
  const defaultVoiceConfig = `${defaultVoiceModel}.json`;
  const piperBinary = path.join(paths.root, 'bin', 'piper', 'piper');
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

  await fs.writeJson(path.join(etcDir, 'voice.json'), voice, { spaces: 2 });
}

/**
 * Check if a profile exists for a user
 */
export function profileExists(username: string): boolean {
  const profileRoot = path.join(paths.root, 'profiles', username);
  return fs.existsSync(profileRoot);
}

/**
 * Initialize guest profile
 *
 * Creates a dedicated guest profile at profiles/guest/ with minimal structure.
 * This profile is used by all anonymous users and is locked to emulation mode.
 */
export async function initializeGuestProfile(): Promise<void> {
  const guestRoot = path.join(paths.root, 'profiles', 'guest');

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
 * Copy persona data from source profile to guest profile
 *
 * @param sourceUsername - Username of the public profile to copy from
 */
export async function copyPersonaToGuest(sourceUsername: string): Promise<void> {
  const sourceRoot = path.join(paths.root, 'profiles', sourceUsername);
  const guestRoot = path.join(paths.root, 'profiles', 'guest');

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

    audit({
      level: 'info',
      category: 'system',
      event: 'persona_copied_to_guest',
      details: { sourceUsername, from: sourceCoreJson, to: guestCoreJson },
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
 */
export async function deleteProfile(username: string, confirm: boolean = false): Promise<void> {
  if (!confirm) {
    throw new Error('Profile deletion requires explicit confirmation');
  }

  const profileRoot = path.join(paths.root, 'profiles', username);

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
