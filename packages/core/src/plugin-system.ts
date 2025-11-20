/**
 * Plugin System for Custom Cognitive Nodes
 *
 * Allows users to create custom node types by placing JavaScript/TypeScript
 * files in the plugins directory. Plugins are hot-reloadable and can extend
 * the cognitive system with new capabilities.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { NodeExecutor } from './node-executors/index.js';
import { audit } from './audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Plugin directory (can be customized)
const DEFAULT_PLUGINS_DIR = path.resolve(__dirname, '../../../plugins');

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  author?: string;
  description: string;
  category?: string;
  color?: string;
  bgColor?: string;
}

export interface PluginNodeDefinition {
  metadata: PluginMetadata;
  inputs: Array<{ name: string; type: string; optional?: boolean; description?: string }>;
  outputs: Array<{ name: string; type: string; description?: string }>;
  properties?: Record<string, any>;
  executor: NodeExecutor;
}

export interface LoadedPlugin {
  definition: PluginNodeDefinition;
  filePath: string;
  loadedAt: number;
  lastModified: number;
}

// Plugin registry
const pluginRegistry = new Map<string, LoadedPlugin>();

/**
 * Load a plugin from a file
 */
export async function loadPlugin(filePath: string): Promise<LoadedPlugin | null> {
  try {
    // Resolve to absolute path
    const absolutePath = path.resolve(filePath);
    const stats = fs.statSync(absolutePath);

    // Dynamic import with file:// protocol and cache-busting timestamp
    const moduleUrl = `file://${absolutePath}?t=${Date.now()}`;
    // @ts-ignore - Vite can't analyze this dynamic import, but it's intentional for hot-reloading
    /* @vite-ignore */
    const module = await import(moduleUrl);

    // Validate plugin structure
    if (!module.default || typeof module.default !== 'object') {
      throw new Error('Plugin must export a default object');
    }

    const definition = module.default as PluginNodeDefinition;

    // Validate required fields
    if (!definition.metadata?.id) {
      throw new Error('Plugin missing metadata.id');
    }
    if (!definition.metadata?.name) {
      throw new Error('Plugin missing metadata.name');
    }
    if (!definition.executor || typeof definition.executor !== 'function') {
      throw new Error('Plugin missing executor function');
    }

    const plugin: LoadedPlugin = {
      definition,
      filePath: absolutePath,
      loadedAt: Date.now(),
      lastModified: stats.mtimeMs,
    };

    // Register with node executor system
    try {
      const { registerPluginExecutor } = await import('./node-executors/index.js');
      registerPluginExecutor(definition.metadata.id, definition.executor);
    } catch (error) {
      console.warn('[PluginSystem] Could not register with node executor system:', error);
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'plugin_loaded',
      details: {
        pluginId: definition.metadata.id,
        name: definition.metadata.name,
        version: definition.metadata.version,
        filePath: absolutePath,
      },
    });

    return plugin;

  } catch (error) {
    console.error(`[PluginSystem] Failed to load plugin ${filePath}:`, error);

    audit({
      level: 'error',
      category: 'system',
      event: 'plugin_load_failed',
      details: {
        filePath,
        error: (error as Error).message,
      },
    });

    return null;
  }
}

/**
 * Load all plugins from a directory
 */
export async function loadPluginsFromDirectory(pluginsDir: string = DEFAULT_PLUGINS_DIR): Promise<void> {
  try {
    if (!fs.existsSync(pluginsDir)) {
      console.log(`[PluginSystem] Plugins directory not found: ${pluginsDir}`);
      console.log(`[PluginSystem] Creating directory...`);
      fs.mkdirSync(pluginsDir, { recursive: true });

      // Create a README
      fs.writeFileSync(
        path.join(pluginsDir, 'README.md'),
        `# MetaHuman Plugins

Place custom node plugins here as .js or .ts files.

## Plugin Structure

\`\`\`javascript
export default {
  metadata: {
    id: 'my_custom_node',
    name: 'My Custom Node',
    version: '1.0.0',
    description: 'Does something custom',
    category: 'custom',
    color: '#ff6b6b',
    bgColor: '#c92a2a',
  },
  inputs: [
    { name: 'input1', type: 'string', description: 'Input description' }
  ],
  outputs: [
    { name: 'output1', type: 'string', description: 'Output description' }
  ],
  properties: {
    myProperty: 'default value',
  },
  executor: async (inputs, context, properties) => {
    // Your node logic here
    return {
      output1: 'result',
    };
  },
};
\`\`\`

See the \`examples/\` directory for more examples.
`,
        'utf-8'
      );
      return;
    }

    const files = fs.readdirSync(pluginsDir);
    const pluginFiles = files.filter(f =>
      (f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.ts')) &&
      !f.startsWith('_') &&
      f !== 'README.md'
    );

    console.log(`[PluginSystem] Scanning ${pluginsDir}...`);
    console.log(`[PluginSystem] Found ${pluginFiles.length} plugin files`);

    let loadedCount = 0;

    for (const file of pluginFiles) {
      const filePath = path.join(pluginsDir, file);
      const plugin = await loadPlugin(filePath);

      if (plugin) {
        pluginRegistry.set(plugin.definition.metadata.id, plugin);
        loadedCount++;
        console.log(`[PluginSystem] ✓ Loaded: ${plugin.definition.metadata.name}`);
      } else {
        console.log(`[PluginSystem] ✗ Failed: ${file}`);
      }
    }

    console.log(`[PluginSystem] Loaded ${loadedCount}/${pluginFiles.length} plugins`);

    audit({
      level: 'info',
      category: 'system',
      event: 'plugins_loaded',
      details: {
        directory: pluginsDir,
        totalFiles: pluginFiles.length,
        loadedCount,
        pluginIds: Array.from(pluginRegistry.keys()),
      },
    });

  } catch (error) {
    console.error('[PluginSystem] Error loading plugins:', error);

    audit({
      level: 'error',
      category: 'system',
      event: 'plugins_load_failed',
      details: {
        directory: pluginsDir,
        error: (error as Error).message,
      },
    });
  }
}

/**
 * Get a loaded plugin by ID
 */
export function getPlugin(pluginId: string): LoadedPlugin | undefined {
  return pluginRegistry.get(pluginId);
}

/**
 * Get all loaded plugins
 */
export function getAllPlugins(): LoadedPlugin[] {
  return Array.from(pluginRegistry.values());
}

/**
 * Get plugin executor (for integration with node executor system)
 */
export function getPluginExecutor(pluginId: string): NodeExecutor | null {
  const plugin = pluginRegistry.get(pluginId);
  return plugin?.definition.executor || null;
}

/**
 * Reload a specific plugin
 */
export async function reloadPlugin(pluginId: string): Promise<boolean> {
  const existing = pluginRegistry.get(pluginId);

  if (!existing) {
    console.error(`[PluginSystem] Plugin ${pluginId} not found`);
    return false;
  }

  console.log(`[PluginSystem] Reloading plugin: ${existing.definition.metadata.name}`);

  const reloaded = await loadPlugin(existing.filePath);

  if (reloaded) {
    pluginRegistry.set(pluginId, reloaded);

    audit({
      level: 'info',
      category: 'system',
      event: 'plugin_reloaded',
      details: {
        pluginId,
        name: reloaded.definition.metadata.name,
      },
    });

    return true;
  }

  return false;
}

/**
 * Unload a plugin
 */
export async function unloadPlugin(pluginId: string): Promise<boolean> {
  const plugin = pluginRegistry.get(pluginId);

  if (!plugin) {
    return false;
  }

  // Unregister from node executor system
  try {
    const { unregisterPluginExecutor } = await import('./node-executors/index.js');
    unregisterPluginExecutor(pluginId);
  } catch (error) {
    console.warn('[PluginSystem] Could not unregister from node executor system:', error);
  }

  pluginRegistry.delete(pluginId);

  audit({
    level: 'info',
    category: 'system',
    event: 'plugin_unloaded',
    details: {
      pluginId,
      name: plugin.definition.metadata.name,
    },
  });

  console.log(`[PluginSystem] Unloaded plugin: ${plugin.definition.metadata.name}`);
  return true;
}

/**
 * Watch plugins directory for changes (hot-reload)
 */
export function watchPlugins(pluginsDir: string = DEFAULT_PLUGINS_DIR): fs.FSWatcher | null {
  try {
    if (!fs.existsSync(pluginsDir)) {
      console.log('[PluginSystem] Plugins directory does not exist, skipping watch');
      return null;
    }

    console.log(`[PluginSystem] Watching ${pluginsDir} for changes...`);

    const watcher = fs.watch(pluginsDir, { recursive: false }, async (eventType, filename) => {
      if (!filename || (!filename.endsWith('.js') && !filename.endsWith('.mjs') && !filename.endsWith('.ts'))) {
        return;
      }

      console.log(`[PluginSystem] File changed: ${filename} (${eventType})`);

      // Find plugin by filename
      const filePath = path.join(pluginsDir, filename);
      const plugin = Array.from(pluginRegistry.values()).find(p => p.filePath === filePath);

      if (plugin) {
        // Reload existing plugin
        console.log(`[PluginSystem] Hot-reloading: ${plugin.definition.metadata.name}`);
        await reloadPlugin(plugin.definition.metadata.id);
      } else if (eventType === 'rename' && fs.existsSync(filePath)) {
        // New plugin added
        console.log(`[PluginSystem] New plugin detected: ${filename}`);
        const newPlugin = await loadPlugin(filePath);
        if (newPlugin) {
          pluginRegistry.set(newPlugin.definition.metadata.id, newPlugin);
        }
      }
    });

    return watcher;

  } catch (error) {
    console.error('[PluginSystem] Error setting up plugin watcher:', error);
    return null;
  }
}

/**
 * Get plugin metadata for display/listing
 */
export function getPluginMetadata(): Array<PluginMetadata & { filePath: string; loadedAt: number }> {
  return Array.from(pluginRegistry.values()).map(plugin => ({
    ...plugin.definition.metadata,
    filePath: plugin.filePath,
    loadedAt: plugin.loadedAt,
  }));
}

/**
 * Validate plugin structure (for development)
 */
export function validatePlugin(plugin: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!plugin.metadata) errors.push('Missing metadata');
  if (!plugin.metadata?.id) errors.push('Missing metadata.id');
  if (!plugin.metadata?.name) errors.push('Missing metadata.name');
  if (!plugin.metadata?.description) errors.push('Missing metadata.description');
  if (!plugin.executor) errors.push('Missing executor function');
  if (plugin.executor && typeof plugin.executor !== 'function') {
    errors.push('executor must be a function');
  }
  if (!plugin.inputs || !Array.isArray(plugin.inputs)) {
    errors.push('inputs must be an array');
  }
  if (!plugin.outputs || !Array.isArray(plugin.outputs)) {
    errors.push('outputs must be an array');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
