/**
 * Chat Settings Management
 *
 * Configurable parameters that control how context, history, and personality
 * influence chat responses. Allows users to tune behavior without editing code.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getProfilePaths, systemPaths } from './paths.js';
import { getUserContext } from './context.js';
import { audit } from './audit.js';
import { storageClient } from './storage-client.js';

export interface ChatSettings {
  contextInfluence: number;
  historyInfluence: number;
  facetInfluence: number;
  temperature: number;
  semanticSearchThreshold: number;
  maxContextChars: number;
  conversationBufferLimit: number;
  innerBufferLimit: number;
  systemBufferLimit: number;
  robotBufferLimit: number;
  userInputPriority: boolean;
  unifiedConsciousness: boolean;
}

export interface ChatSettingsConfig {
  version: string;
  description: string;
  lastUpdated: string;
  settings: Record<string, {
    description: string;
    value: any;
    min?: number;
    max?: number;
    step?: number;
    notes?: string;
  }>;
  presets: Record<string, Partial<ChatSettings>>;
  activePreset: string;
}

const GLOBAL_SETTINGS_PATH = path.join(systemPaths.root, 'etc', 'chat-settings.json');

function cloneConfigValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Add settings introduced after a user profile was created without replacing
 * any saved values. This keeps old profiles writable as the settings schema grows.
 */
function hydrateMissingConfigEntries(config: ChatSettingsConfig): ChatSettingsConfig {
  if (!fs.existsSync(GLOBAL_SETTINGS_PATH)) return config;

  const template = JSON.parse(fs.readFileSync(GLOBAL_SETTINGS_PATH, 'utf-8')) as ChatSettingsConfig;
  config.settings ||= {};
  config.presets ||= {};

  const hadConversationLimit = Boolean(config.settings.conversationBufferLimit);
  const hadInnerLimit = Boolean(config.settings.innerBufferLimit);
  const hadSystemLimit = Boolean(config.settings.systemBufferLimit);
  const legacyHistoryLimit = Number(config.settings.maxHistoryMessages?.value);
  const legacyInnerLimit = Number(config.settings.innerDialogHistoryLimit?.value);

  for (const [key, definition] of Object.entries(template.settings || {})) {
    if (!config.settings[key]) {
      config.settings[key] = cloneConfigValue(definition);
    }
  }

  if (Number.isFinite(legacyHistoryLimit)) {
    if (!hadConversationLimit) {
      config.settings.conversationBufferLimit.value = legacyHistoryLimit;
    }
    if (!hadSystemLimit) {
      config.settings.systemBufferLimit.value = legacyHistoryLimit;
    }
  }
  if (Number.isFinite(legacyInnerLimit) && !hadInnerLimit) {
    config.settings.innerBufferLimit.value = legacyInnerLimit;
  }

  delete config.settings.maxHistoryMessages;
  delete config.settings.innerDialogHistoryLimit;
  delete config.settings.innerDialogHistoryDays;

  for (const [presetName, templatePreset] of Object.entries(template.presets || {})) {
    const preset = config.presets[presetName];
    if (!preset) continue;

    const legacyPreset = preset as Record<string, unknown>;
    const hadPresetConversationLimit = typeof legacyPreset.conversationBufferLimit === 'number';
    const hadPresetInnerLimit = typeof legacyPreset.innerBufferLimit === 'number';
    const hadPresetSystemLimit = typeof legacyPreset.systemBufferLimit === 'number';
    const legacyPresetHistoryLimit = legacyPreset.maxHistoryMessages;
    const legacyPresetInnerLimit = legacyPreset.innerDialogHistoryLimit;

    for (const [key, value] of Object.entries(templatePreset)) {
      if (!(key in preset)) {
        (preset as Record<string, unknown>)[key] = cloneConfigValue(value);
      }
    }

    if (typeof legacyPresetHistoryLimit === 'number') {
      if (!hadPresetConversationLimit) {
        legacyPreset.conversationBufferLimit = legacyPresetHistoryLimit;
      }
      if (!hadPresetSystemLimit) {
        legacyPreset.systemBufferLimit = legacyPresetHistoryLimit;
      }
    }
    if (typeof legacyPresetInnerLimit === 'number' && !hadPresetInnerLimit) {
      legacyPreset.innerBufferLimit = legacyPresetInnerLimit;
    }
    delete legacyPreset.maxHistoryMessages;
    delete legacyPreset.innerDialogHistoryLimit;
    delete legacyPreset.innerDialogHistoryDays;
  }

  return config;
}

/**
 * Get user-specific settings path
 */
function getUserSettingsPath(): string | null {
  const ctx = getUserContext();
  if (!ctx) {
    return null;
  }

  const result = storageClient.resolvePath({
    category: 'config',
    relativePath: 'chat-settings.json',
  });
  if (!result.success || !result.path) {
    return null;
  }

  return result.path;
}

/**
 * Load chat settings (merges global defaults with user overrides)
 */
export function loadChatSettings(): ChatSettings {
  try {
    // Start with global defaults
    let globalSettings = getDefaultSettings();

    if (fs.existsSync(GLOBAL_SETTINGS_PATH)) {
      const raw = fs.readFileSync(GLOBAL_SETTINGS_PATH, 'utf-8');
      const config: ChatSettingsConfig = JSON.parse(raw);
      globalSettings = extractSettings(config);
    }

    // Check for user-specific overrides
    const userPath = getUserSettingsPath();
    if (userPath && fs.existsSync(userPath)) {
      const raw = fs.readFileSync(userPath, 'utf-8');
      const userConfig: ChatSettingsConfig = JSON.parse(raw);
      const userSettings = extractSettings(userConfig);

      // Merge: user settings override global
      return { ...globalSettings, ...userSettings };
    }

    return globalSettings;
  } catch (error) {
    console.error('[chat-settings] Failed to load settings:', error);
    return getDefaultSettings();
  }
}

/**
 * Load settings for an explicit profile without relying on request context.
 * Background agents and graph nodes use this entry point so compatibility
 * migration and defaults remain owned by this module.
 */
export function loadChatSettingsForUser(username: string): ChatSettings {
  try {
    let globalSettings = getDefaultSettings();
    if (fs.existsSync(GLOBAL_SETTINGS_PATH)) {
      const config = hydrateMissingConfigEntries(
        JSON.parse(fs.readFileSync(GLOBAL_SETTINGS_PATH, 'utf-8')),
      );
      globalSettings = extractSettings(config);
    }

    const userPath = path.join(getProfilePaths(username).root, 'etc', 'chat-settings.json');
    if (!fs.existsSync(userPath)) return globalSettings;

    const userConfig = hydrateMissingConfigEntries(
      JSON.parse(fs.readFileSync(userPath, 'utf-8')),
    );
    return { ...globalSettings, ...extractSettings(userConfig) };
  } catch (error) {
    console.error(`[chat-settings] Failed to load settings for ${username}:`, error);
    return getDefaultSettings();
  }
}

/**
 * Extract settings object from config
 */
function extractSettings(config: ChatSettingsConfig): ChatSettings {
  return {
    contextInfluence: config.settings.contextInfluence?.value ?? 0.5,
    historyInfluence: config.settings.historyInfluence?.value ?? 0.6,
    facetInfluence: config.settings.facetInfluence?.value ?? 0.7,
    temperature: config.settings.temperature?.value ?? 0.6,
    semanticSearchThreshold: config.settings.semanticSearchThreshold?.value ?? 0.62,
    maxContextChars: config.settings.maxContextChars?.value ?? 900,
    conversationBufferLimit: config.settings.conversationBufferLimit?.value
      ?? config.settings.maxHistoryMessages?.value
      ?? 30,
    innerBufferLimit: config.settings.innerBufferLimit?.value
      ?? config.settings.innerDialogHistoryLimit?.value
      ?? 80,
    systemBufferLimit: config.settings.systemBufferLimit?.value
      ?? config.settings.maxHistoryMessages?.value
      ?? 100,
    robotBufferLimit: config.settings.robotBufferLimit?.value ?? 100,
    userInputPriority: config.settings.userInputPriority?.value ?? true,
    unifiedConsciousness: config.settings.unifiedConsciousness?.value ?? false,
  };
}

/**
 * Save chat settings to file (user-specific if logged in, global otherwise)
 */
export function saveChatSettings(updates: Partial<ChatSettings>, actor = 'system'): void {
  try {
    // Determine target path (user-specific or global)
    const userPath = getUserSettingsPath();
    const targetPath = userPath || GLOBAL_SETTINGS_PATH;
    const scope = userPath ? 'user' : 'global';

    // Load or create config
    let config: ChatSettingsConfig;
    if (fs.existsSync(targetPath)) {
      const raw = fs.readFileSync(targetPath, 'utf-8');
      config = JSON.parse(raw);
    } else {
      // Create new user config from global template
      const globalRaw = fs.readFileSync(GLOBAL_SETTINGS_PATH, 'utf-8');
      config = JSON.parse(globalRaw);
    }
    config = hydrateMissingConfigEntries(config);

    // Update settings values
    for (const [key, value] of Object.entries(updates)) {
      if (config.settings[key]) {
        config.settings[key].value = value;
      }
    }

    // Update metadata
    config.lastUpdated = new Date().toISOString();
    config.activePreset = 'custom'; // Mark as custom when manually edited

    // Ensure directory exists (for user-specific path)
    if (userPath) {
      const dir = path.dirname(userPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Write back
    fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');

    audit({
      level: 'info',
      category: 'system',
      event: 'chat_settings_updated',
      details: {
        updates,
        scope,
        path: targetPath,
        timestamp: config.lastUpdated,
      },
      actor,
    });
  } catch (error) {
    console.error('[chat-settings] Failed to save settings:', error);
    throw error;
  }
}

/**
 * Apply a preset configuration
 */
export function applyPreset(presetName: string, actor = 'system'): ChatSettings {
  try {
    // Determine target path
    const userPath = getUserSettingsPath();
    const targetPath = userPath || GLOBAL_SETTINGS_PATH;
    const scope = userPath ? 'user' : 'global';

    // Load config
    let config: ChatSettingsConfig;
    if (fs.existsSync(targetPath)) {
      const raw = fs.readFileSync(targetPath, 'utf-8');
      config = JSON.parse(raw);
    } else {
      // Load global template for new user config
      const globalRaw = fs.readFileSync(GLOBAL_SETTINGS_PATH, 'utf-8');
      config = JSON.parse(globalRaw);
    }
    config = hydrateMissingConfigEntries(config);

    const preset = config.presets[presetName];
    if (!preset) {
      throw new Error(`Preset "${presetName}" not found`);
    }

    // Update settings from preset
    for (const [key, value] of Object.entries(preset)) {
      if (config.settings[key]) {
        config.settings[key].value = value;
      }
    }

    config.activePreset = presetName;
    config.lastUpdated = new Date().toISOString();

    // Ensure directory exists (for user-specific path)
    if (userPath) {
      const dir = path.dirname(userPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), 'utf-8');

    audit({
      level: 'info',
      category: 'system',
      event: 'chat_preset_applied',
      details: {
        preset: presetName,
        scope,
        path: targetPath,
        timestamp: config.lastUpdated,
      },
      actor,
    });

    return loadChatSettings();
  } catch (error) {
    console.error('[chat-settings] Failed to apply preset:', error);
    throw error;
  }
}

/**
 * Get default settings
 */
export function getDefaultSettings(): ChatSettings {
  return {
    contextInfluence: 0.5,
    historyInfluence: 0.6,
    facetInfluence: 0.7,
    temperature: 0.6,
    semanticSearchThreshold: 0.62,
    maxContextChars: 900,
    conversationBufferLimit: 30,
    innerBufferLimit: 80,
    systemBufferLimit: 100,
    robotBufferLimit: 100,
    userInputPriority: true,
    unifiedConsciousness: false,
  };
}

/**
 * Get full configuration (for UI display) - returns user config if available, else global
 */
export function getChatSettingsConfig(): ChatSettingsConfig {
  try {
    const userPath = getUserSettingsPath();
    const targetPath = userPath || GLOBAL_SETTINGS_PATH;

    if (!fs.existsSync(targetPath)) {
      throw new Error('Settings file not found');
    }

    const raw = fs.readFileSync(targetPath, 'utf-8');
    return hydrateMissingConfigEntries(JSON.parse(raw));
  } catch (error) {
    console.error('[chat-settings] Failed to load config:', error);
    throw error;
  }
}

/**
 * Get scope info (for UI display)
 */
export function getChatSettingsScope(): { scope: 'global' | 'user'; path: string; hasUserOverride: boolean } {
  const userPath = getUserSettingsPath();
  const hasUserOverride = userPath ? fs.existsSync(userPath) : false;

  if (hasUserOverride && userPath) {
    return { scope: 'user', path: userPath, hasUserOverride: true };
  }

  return { scope: 'global', path: GLOBAL_SETTINGS_PATH, hasUserOverride: false };
}

/**
 * Reset to default preset
 */
export function resetToDefaults(actor = 'system'): ChatSettings {
  return applyPreset('balanced', actor);
}
