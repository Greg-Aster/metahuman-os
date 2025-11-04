import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';

export interface AdapterDatasetInfo {
  date: string;
  pairCount: number;
  status: 'pending' | 'approved' | 'trained' | 'evaluated' | 'active';
  approvedAt?: string;
  approvedBy?: string;
  notes?: string;
  autoApproved?: boolean;
  qualityScore?: number;
  evalScore?: number;
  evalPassed?: boolean;
  evaluatedAt?: string;
  adapterPath?: string;
  modelfilePath?: string;
  dryRun?: boolean;
}

export interface ActiveAdapterInfo {
  modelName: string;
  activatedAt: string;
  adapterPath?: string;
  evalScore?: number;
  dataset?: string;
  modelfilePath?: string;
  status?: string;
  date?: string;
  trainingMethod?: string;
  runLabel?: string;
  ggufAdapterPath?: string;
  baseModel?: string;
  activatedBy?: string;
  isDualAdapter?: boolean;
  dual?: boolean;
  mergedPath?: string;
  adapters?: {
    historical?: string;
    recent?: string;
  };
}

export interface AutoApprovalConfig {
  enabled: boolean;
  dryRun: boolean;
  thresholds: {
    minPairs: number;
    minHighConfidence: number;
    minReflectionPct: number;
    maxLowConfidence: number;
  };
  alertEmail?: string | null;
}

function getAdaptersRoot(): string {
  return path.join(paths.out, 'adapters');
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

function countPairs(datasetDir: string): number {
  const metadata = safeReadJSON<{ pairCount: number }>(path.join(datasetDir, 'metadata.json'));
  if (metadata?.pairCount) {
    return metadata.pairCount;
  }

  const jsonlPath = path.join(datasetDir, 'instructions.jsonl');
  if (!fs.existsSync(jsonlPath)) return 0;
  const content = fs.readFileSync(jsonlPath, 'utf-8');
  return content.trim() === '' ? 0 : content.trim().split('\n').length;
}

function resolveStatus(datasetDir: string, activeDataset?: string | null): AdapterDatasetInfo['status'] {
  if (activeDataset && path.basename(datasetDir) === activeDataset) {
    return 'active';
  }
  if (fs.existsSync(path.join(datasetDir, 'eval.json'))) {
    return 'evaluated';
  }
  if (fs.existsSync(path.join(datasetDir, 'adapter_model.safetensors'))) {
    return 'trained';
  }
  if (fs.existsSync(path.join(datasetDir, 'approved.json'))) {
    return 'approved';
  }
  return 'pending';
}

export function listAdapterDatasets(): AdapterDatasetInfo[] {
  const root = getAdaptersRoot();
  if (!fs.existsSync(root)) return [];

  const active = getActiveAdapter();
  const activeDataset = active?.dataset || null;

  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const datasets: AdapterDatasetInfo[] = [];

  for (const date of entries) {
    const datasetDir = path.join(root, date);
    const pairCount = countPairs(datasetDir);

    const approved = safeReadJSON<{
      approvedAt?: string;
      approvedBy?: string;
      notes?: string;
      autoApproved?: boolean;
      qualityScore?: number;
      dryRun?: boolean;
    }>(path.join(datasetDir, 'approved.json'));

    const evalData = safeReadJSON<{
      score?: number;
      threshold?: number;
      passed?: boolean;
      evaluatedAt?: string;
    }>(path.join(datasetDir, 'eval.json'));

    const activeData = activeDataset === date ? active : null;

    datasets.push({
      date,
      pairCount,
      status: resolveStatus(datasetDir, activeDataset),
      approvedAt: approved?.approvedAt,
      approvedBy: approved?.approvedBy,
      notes: approved?.notes,
      autoApproved: approved?.autoApproved ?? false,
      qualityScore: approved?.qualityScore,
      dryRun: approved?.dryRun,
      evalScore: evalData?.score,
      evalPassed: evalData?.passed,
      evaluatedAt: evalData?.evaluatedAt,
      adapterPath: activeData?.adapterPath ?? (fs.existsSync(path.join(datasetDir, 'adapter_model.safetensors')) ? path.join(datasetDir, 'adapter_model.safetensors') : undefined),
      modelfilePath: activeData?.modelfilePath ?? (fs.existsSync(path.join(datasetDir, 'Modelfile')) ? path.join(datasetDir, 'Modelfile') : undefined),
    });
  }

  return datasets;
}

function getAgentConfig(): any {
  const cfgPath = path.join(paths.etc, 'agent.json');
  return safeReadJSON<any>(cfgPath) ?? null;
}

function writeAgentConfig(config: any): void {
  const cfgPath = path.join(paths.etc, 'agent.json');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
}

export function getActiveAdapter(): ActiveAdapterInfo | null {
  const agentCfg = getAgentConfig();
  if (agentCfg?.useAdapter && agentCfg.adapterModel) {
    const meta = agentCfg.adapterMeta || {};
    return {
      modelName: agentCfg.adapterModel,
      activatedAt: meta.activatedAt || new Date().toISOString(),
      adapterPath: meta.adapterPath,
      evalScore: meta.evalScore,
      dataset: meta.dataset,
      modelfilePath: meta.modelfilePath,
      status: meta.status || 'loaded',
      date: meta.date,
      trainingMethod: meta.trainingMethod,
      runLabel: meta.runLabel,
      ggufAdapterPath: meta.ggufAdapterPath,
      baseModel: agentCfg.baseModel || agentCfg.model,
      activatedBy: meta.activatedBy,
      isDualAdapter: meta.isDualAdapter ?? meta.dual ?? false,
      dual: meta.dual,
      mergedPath: meta.mergedPath,
      adapters: meta.adapters,
    };
  }

  // Fallback to legacy active-adapter.json for backward compatibility
  const legacyPath = path.join(paths.persona, 'overrides', 'active-adapter.json');
  const legacy = safeReadJSON<ActiveAdapterInfo>(legacyPath);
  if (legacy) {
    // Upgrade legacy config into agent.json and remove file to avoid future divergence
    const cfg = agentCfg || {};
    if (!cfg.baseModel && cfg.model) {
      cfg.baseModel = cfg.model;
    }
    const upgraded: ActiveAdapterInfo = {
      ...legacy,
      baseModel: cfg.baseModel || cfg.model || legacy.baseModel,
    };
    cfg.useAdapter = true;
    cfg.adapterModel = upgraded.modelName;
    cfg.adapterMeta = upgraded;
    writeAgentConfig(cfg);
    try { fs.rmSync(legacyPath); } catch {}
    return upgraded;
  }

  return null;
}

export function setActiveAdapter(info: ActiveAdapterInfo | null): void {
  const cfg = getAgentConfig() || {};

  const currentBase = cfg.baseModel || cfg.model || null;
  if (!cfg.baseModel && cfg.model) {
    cfg.baseModel = cfg.model;
  }

  const baseFromInfo = info?.baseModel || null;
  if (baseFromInfo) {
    cfg.baseModel = baseFromInfo;
    // If current model looks like a prior adapter, reset to the provided base
    if (!cfg.model || cfg.model.startsWith('greg-')) {
      cfg.model = baseFromInfo;
    }
  }

  if (info) {
    const status = info.status ?? 'loaded';
    const enableAdapter = status === 'loaded' || status === 'active';
    cfg.useAdapter = enableAdapter;
    cfg.adapterModel = info.modelName;
    cfg.adapterMeta = { ...info, status };
    // Preserve base model if present; if current model equals adapter name, reset to base
    if (cfg.model === info.modelName && cfg.baseModel) {
      cfg.model = cfg.baseModel;
    }
  } else {
    cfg.useAdapter = false;
    cfg.adapterModel = null;
    delete cfg.adapterMeta;
    if (cfg.baseModel) {
      cfg.model = cfg.baseModel;
    } else if (currentBase === null && cfg.model && cfg.model.startsWith('greg-')) {
      // No recorded base, fall back to qwen3-coder as a sane default
      cfg.model = 'qwen3-coder:30b';
    }
  }

  writeAgentConfig(cfg);

  // Remove legacy file if present to prevent stale overrides
  const legacyPath = path.join(paths.persona, 'overrides', 'active-adapter.json');
  try { fs.rmSync(legacyPath); } catch {}
}

export function readAutoApprovalConfig(): AutoApprovalConfig {
  const configPath = path.join(paths.etc, 'auto-approval.json');
  if (!fs.existsSync(configPath)) {
    const defaultConfig: AutoApprovalConfig = {
      enabled: true,
      dryRun: true,
      thresholds: {
        minPairs: 30,
        minHighConfidence: 0.6,
        minReflectionPct: 0.2,
        maxLowConfidence: 0.2,
      },
      alertEmail: null,
    };
    fs.mkdirSync(paths.etc, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AutoApprovalConfig;
}

export function writeAutoApprovalConfig(config: AutoApprovalConfig): void {
  const configPath = path.join(paths.etc, 'auto-approval.json');
  fs.mkdirSync(paths.etc, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
