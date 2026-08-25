import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from './path-builder.js';
import { storageClient } from './storage-client.js';

export interface ActiveAdapterInfo {
  modelName: string;
  activatedAt: string;
  adapterPath?: string;
  dataset?: string;
  modelfilePath?: string;
  status?: string;
  date?: string;
  trainingMethod?: string;
  runLabel?: string;
  ggufAdapterPath?: string;
  baseModel?: string;
  activatedBy?: string;
}

function safeReadJSON<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getModelRegistry(): any {
  const cfgPath = path.join(systemPaths.etc, 'models.json');
  return safeReadJSON<any>(cfgPath) ?? null;
}

function writeModelRegistry(registry: any): void {
  const cfgPath = path.join(systemPaths.etc, 'models.json');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(registry, null, 2));
}

/**
 * Get active adapter info
 */
export function getActiveAdapter(): ActiveAdapterInfo | null {
  const registry = getModelRegistry();
  const globalSettings = registry?.globalSettings;

  if (globalSettings?.useAdapter && globalSettings?.activeAdapter) {
    const meta = globalSettings.activeAdapter;
    // Handle both string (model name) and object (full metadata) formats
    if (typeof meta === 'string') {
      return {
        modelName: meta,
        activatedAt: new Date().toISOString(),
        status: 'loaded',
      };
    }
    return {
      modelName: meta.modelName,
      activatedAt: meta.activatedAt || new Date().toISOString(),
      adapterPath: meta.adapterPath,
      dataset: meta.dataset,
      modelfilePath: meta.modelfilePath,
      status: meta.status || 'loaded',
      date: meta.date,
      trainingMethod: meta.trainingMethod,
      runLabel: meta.runLabel,
      ggufAdapterPath: meta.ggufAdapterPath,
      baseModel: meta.baseModel,
      activatedBy: meta.activatedBy,
    };
  }

  // Fallback to legacy active-adapter.json for backward compatibility
  // This requires user context, so wrap in try/catch
  try {
    const personaResult = storageClient.resolvePath({
      category: 'config',
      subcategory: 'persona',
    });
    if (!personaResult.success || !personaResult.path) {
      return null;
    }
    const legacyPath = path.join(personaResult.path, 'overrides', 'active-adapter.json');
    const legacy = safeReadJSON<ActiveAdapterInfo>(legacyPath);
    if (legacy) {
      // Upgrade legacy config into models.json and remove file to avoid future divergence
      if (!registry) return null;

      const upgraded: ActiveAdapterInfo = {
        ...legacy,
        baseModel: legacy.baseModel,
      };

      if (!registry.globalSettings) {
        registry.globalSettings = { includePersonaSummary: true, useAdapter: false, activeAdapter: null };
      }
      registry.globalSettings.useAdapter = true;
      registry.globalSettings.activeAdapter = upgraded;

      writeModelRegistry(registry);
      try { fs.rmSync(legacyPath); } catch {}
      return upgraded;
    }
  } catch {
    // No user context or legacy file not found - this is fine, config is in models.json now
  }

  return null;
}

/**
 * Set active adapter
 */
export function setActiveAdapter(info: ActiveAdapterInfo | null): void {
  const registry = getModelRegistry() || {};

  // Ensure globalSettings exists
  if (!registry.globalSettings) {
    registry.globalSettings = { includePersonaSummary: true, useAdapter: false, activeAdapter: null };
  }

  if (info) {
    const status = info.status ?? 'loaded';
    const enableAdapter = status === 'loaded' || status === 'active';
    registry.globalSettings.useAdapter = enableAdapter;
    registry.globalSettings.activeAdapter = { ...info, status };
  } else {
    registry.globalSettings.useAdapter = false;
    registry.globalSettings.activeAdapter = null;
  }

  writeModelRegistry(registry);

  // Remove legacy file if present to prevent stale overrides
  try {
    const personaResult = storageClient.resolvePath({
      category: 'config',
      subcategory: 'persona',
    });
    if (personaResult.success && personaResult.path) {
      const legacyPath = path.join(personaResult.path, 'overrides', 'active-adapter.json');
      fs.rmSync(legacyPath);
    }
  } catch {
    // No user context or file doesn't exist - this is fine
  }
}
