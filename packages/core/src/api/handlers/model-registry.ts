/**
 * Model Registry API Handlers
 *
 * Manages user's model registry for role assignments.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 *
 * CRITICAL: User's models.json is the ONLY source of truth.
 * System etc/models.json is ONLY used for one-time initialization of new users.
 * NEVER fall back to system config for existing users.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { assertTrainingModelApproved } from '../../adapters.js';
import { safeWriteJSON } from '../../safe-file.js';
import {
  getProfilePaths,
  systemPaths,
  audit,
  loadBackendConfig,
  storageClient,
  getBackendStatus,
  detectAvailableBackends,
  discoverVllmLoraAdapters,
  getVllmLoraConfig,
  enableVllmLoraAdapter,
  getVLLMLoadedLoras,
  listLocalModelArtifacts,
  ollama,
} from '../../index.js';
import {
  isModelRole,
  resolveModelById,
  resolveModelForCognitiveMode,
  invalidateModelCache,
  updateModelGlobalSettings,
  migrateModelRegistry,
  parseModelRegistry,
  type ModelRegistry,
} from '../../model-resolver.js';
import type { CognitiveModeId } from '../../cognitive-mode.js';
// NOTE: invalidateStatusCache was removed - statusCache no longer exists (was redundant)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getLlamaCppAdapters } from '../../providers/llama-cpp.js';
import { compareEnvironmentSpecialistReports,
  type EnvironmentSpecialistEvaluationReport } from '../../environment-training-promotion.js';
import { loadGraphForMode } from '../../graph-streaming.js';
import type { SvelteFlowGraph } from '../../cognitive-graph-schema.js';
import { getNodeSchema } from '../../nodes/index.js';
import { loadRobotOperatorConfig } from '../../robot-operator.js';

/** Project configured nodes through the same resolver used by model calls. */
export interface WorkflowModelBinding {
  nodeId: string; label: string; role: string; modelId: string; selection: string;
  resolvedModelId?: string; model?: string; provider?: string; error?: string;
}
export function projectWorkflowModels(
  graph: SvelteFlowGraph,
  resolve: (role: string) => { id: string; model: string; provider: string },
) {
  return graph.nodes.flatMap<WorkflowModelBinding>(node => {
    const schema = getNodeSchema(node.data.nodeType);
    if (!schema?.propertySchemas?.role || !isModelRole(schema.properties?.role)) return [];
    const properties = { ...schema.properties, ...node.data.properties };
    const role = String(properties.role || (node.data.nodeType === 'orchestrator_llm' ? 'orchestrator' : 'persona'));
    const connectedRole = graph.edges.some(edge => edge.target === node.id && edge.targetHandle === 'role');
    const binding = { nodeId: node.id, label: node.data.label || schema.name, role, modelId: '',
      selection: connectedRole ? 'runtime-role' : 'role' };
    if (connectedRole) return [{ ...binding, model: 'Selected at runtime' }];
    try {
      const resolved = resolve(role);
      return [{ ...binding, modelId: resolved.id, resolvedModelId: resolved.id, model: resolved.model, provider: resolved.provider }];
    } catch (error) {
      return [{ ...binding, error: (error as Error).message }];
    }
  });
}

async function workflowModelBindings(mode: CognitiveModeId, username: string) {
  const config = mode === 'environment' ? loadRobotOperatorConfig() : null;
  const keys = new Set([mode, ...(config ? Object.entries(config)
    .filter(([key]) => key.endsWith('Graph')).map(([, value]) => String(value)) : [])]);
  return Promise.all([...keys].map(async key => {
    try {
      const { graph } = await loadGraphForMode(key);
      const models = projectWorkflowModels(graph, role => {
        if (!isModelRole(role)) throw new Error(`Unknown model role: ${role}`);
        return resolveModelForCognitiveMode(mode, role, username);
      });
      return { key, name: graph.name, models };
    } catch (error) {
      return { key, name: key, models: [], error: (error as Error).message };
    }
  }));
}

function llamaAdapterModelId(model: string, endpoint: string, adapterPath: string): string {
  return `llama-cpp-lora.${createHash('sha256').update(JSON.stringify([model, endpoint, adapterPath])).digest('hex').slice(0, 16)}`;
}

export const isRetiredDevelopmentModelId = (modelId: string): boolean => (
  modelId.startsWith('environment-classifier.')
  || modelId.startsWith('ollama.environment-classifier')
  || modelId === 'ollama.environment-action-selector-0.8b:v1'
);

const CONFIGURABLE_COGNITIVE_MODES = new Set<CognitiveModeId>([
  'dual',
  'agent',
  'emulation',
  'environment',
]);

export function isConfigurableCognitiveMode(value: unknown): value is CognitiveModeId {
  return typeof value === 'string'
    && CONFIGURABLE_COGNITIVE_MODES.has(value as CognitiveModeId);
}

export interface AvailableRegistryModel {
  id: string
  aliases?: string[]
  provider: string
  model: string
  roles: string[]
  capabilities: string[]
  description: string
  adapters: string[]
  baseModel: string | null
  metadata: Record<string, unknown>
  options: Record<string, unknown>
  source: 'user-registry' | 'runtime-discovery'
}

/**
 * Collapse registry aliases to one inventory record per provider/model pair.
 * Role-specific IDs remain valid in the profile, but they are not distinct
 * installed models and must not multiply the production inventory.
 */
export function collapseModelInventory(models: AvailableRegistryModel[]): AvailableRegistryModel[] {
  const inventory = new Map<string, AvailableRegistryModel>()

  for (const model of models) {
    const key = JSON.stringify([model.provider, model.model, model.adapters || [], model.options?.endpoint || null, model.options?.lora ?? null])
    const existing = inventory.get(key)
    if (!existing) {
      inventory.set(key, {
        ...model,
        aliases: Array.from(new Set([...(model.aliases || []), model.id])),
        roles: [...model.roles],
        capabilities: [...model.capabilities],
        adapters: [...model.adapters],
        metadata: { ...model.metadata },
        options: { ...model.options },
      })
      continue
    }

    const previousId = existing.id
    existing.aliases = Array.from(new Set([
      ...(existing.aliases || []),
      previousId,
      ...(model.aliases || []),
      model.id,
    ]))
    existing.roles = Array.from(new Set([...existing.roles, ...model.roles]))
    existing.capabilities = Array.from(new Set([...existing.capabilities, ...model.capabilities]))
    existing.adapters = Array.from(new Set([...existing.adapters, ...model.adapters]))
    if (!existing.description && model.description) existing.description = model.description
    if (!existing.baseModel && model.baseModel) existing.baseModel = model.baseModel

    // Prefer the provider-native runtime ID over legacy role aliases such as
    // default.orchestrator when both identify the same installed model.
    if (model.id === `${model.provider}.${model.model}`) existing.id = model.id
  }

  return Array.from(inventory.values())
}

/**
 * Resolve models.json path for a user
 */
function resolveModelsPath(username: string): string {
  const result = storageClient.resolvePath({
    username,
    category: 'config',
    subcategory: 'etc',
    relativePath: 'models.json',
  });
  if (result.success && result.path) {
    return result.path;
  }
  // Fallback to profile path
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.etc, 'models.json');
}

/**
 * Ensure user has their own models.json registry.
 * If not, initialize from system defaults (ONE-TIME only).
 *
 * CRITICAL: After this initialization, NEVER read from system registry again.
 * User's models.json is the ONLY source of truth.
 */
function ensureUserRegistry(username: string): void {
  const userPath = resolveModelsPath(username);

  if (fs.existsSync(userPath)) {
    // User already has a registry - do nothing
    return;
  }

  // Copy from system registry ONE TIME
  const systemPath = path.join(systemPaths.etc, 'models.json');
  let userRegistry: ModelRegistry = {
    version: '1.0.0',
    description: 'User model registry',
    globalSettings: {},
    defaults: {},
    models: {},
    roleHierarchy: {},
    cognitiveModeMappings: {},
    providers: {}
  };

  if (fs.existsSync(systemPath)) {
    try {
      const systemRegistry = parseModelRegistry(JSON.parse(fs.readFileSync(systemPath, 'utf-8')));

      // Copy structure from system registry
      userRegistry = {
        version: systemRegistry.version || '1.0.0',
        description: systemRegistry.description,
        globalSettings: { ...(systemRegistry.globalSettings || {}) },
        defaults: { ...(systemRegistry.defaults || {}) },
        models: { ...(systemRegistry.models || {}) },
        roleHierarchy: { ...(systemRegistry.roleHierarchy || {}) },
        cognitiveModeMappings: { ...(systemRegistry.cognitiveModeMappings || {}) },
        providers: { ...(systemRegistry.providers || {}) }
      };
    } catch (err) {
      throw new Error('Cannot initialize model registry: ' + (err as Error).message);
    }
  }

  // Create directory and write user's registry
  fs.mkdirSync(path.dirname(userPath), { recursive: true });
  fs.writeFileSync(userPath, JSON.stringify(userRegistry, null, 2));
}

/**
 * Read model registry from user's profile
 */
function readModelRegistry(username: string): ModelRegistry {
  // Ensure user has their own registry (one-time initialization)
  ensureUserRegistry(username);

  try {
    const p = resolveModelsPath(username);
    if (fs.existsSync(p)) {
      const parsed = parseModelRegistry(JSON.parse(fs.readFileSync(p, 'utf-8')));
      const migration = migrateModelRegistry(parsed);
      if (migration.changed) {
        const temporaryPath = `${p}.migration-${process.pid}`;
        fs.writeFileSync(temporaryPath, `${JSON.stringify(migration.registry, null, 2)}\n`, 'utf8');
        fs.renameSync(temporaryPath, p);
        invalidateModelCache();
      }
      return migration.registry;
    }
  } catch (e) {
    throw new Error('Cannot read the profile model registry; existing assignments were preserved: ' + (e as Error).message);
  }

  throw new Error('Profile model registry is unavailable after initialization');
}

/**
 * Write model registry to user's profile
 */
function writeModelRegistry(username: string, registry: ModelRegistry): void {
  const p = resolveModelsPath(username);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  safeWriteJSON(p, registry);
  // Invalidate model cache to force reload
  invalidateModelCache();
}

/** Commit an evaluated Environment LoRA through the profile's existing role owner. */
export async function promoteEnvironmentSpecialist(input: {
  username: string;
  specialist: 'intent' | 'task';
  previousModelId: string;
  artifactPath: string;
  run: string;
  currentReport: string;
  evaluationReport: string;
}): Promise<string> {
  const currentEvidence = JSON.parse(fs.readFileSync(input.currentReport, 'utf8')) as EnvironmentSpecialistEvaluationReport;
  const candidateEvidence = JSON.parse(fs.readFileSync(input.evaluationReport, 'utf8')) as EnvironmentSpecialistEvaluationReport;
  if (candidateEvidence.specialist !== input.specialist
    || !compareEnvironmentSpecialistReports(currentEvidence, candidateEvidence).promote) {
    throw new Error('Environment candidate does not beat the current adapter under the approved comparison rule');
  }
  const role = input.specialist === 'intent' ? 'environmentIntent' : 'environmentActionSelector';
  const registry = readModelRegistry(input.username);
  const assigned = registry.cognitiveModeMappings?.environment?.[role];
  if (assigned !== input.previousModelId) throw new Error('Environment model role changed during training');
  const previous = registry.models[input.previousModelId];
  if (!previous || previous.provider !== 'llama-cpp' || typeof previous.options.endpoint !== 'string') {
    throw new Error('Active Environment specialist is not a configured llama.cpp model');
  }
  const loaded = await getLlamaCppAdapters({ ...loadBackendConfig().llamaCpp,
    endpoint: previous.options.endpoint, model: previous.model });
  if (!loaded.some(adapter => adapter.path === input.artifactPath)) {
    throw new Error('New Environment LoRA is not loaded by the selected llama.cpp service');
  }
  const modelId = llamaAdapterModelId(previous.model, previous.options.endpoint, input.artifactPath);
  registry.models[modelId] = {
    ...previous,
    adapters: [input.artifactPath],
    roles: [role],
    description: `Environment ${input.specialist} specialist from ${input.run}`,
    options: { ...previous.options, lora: [{ path: input.artifactPath, scale: 1 }] },
    metadata: { ...previous.metadata, specialist: input.specialist, run: input.run,
      artifactPath: input.artifactPath, evaluationReport: input.evaluationReport,
      activatedAt: new Date().toISOString() },
  };
  registry.cognitiveModeMappings ??= {};
  registry.cognitiveModeMappings.environment ??= {};
  registry.cognitiveModeMappings.environment[role] = modelId;
  writeModelRegistry(input.username, registry);
  return modelId;
}

function normalizeProviderCapabilities(value: unknown): Array<'text' | 'image'> {
  if (!Array.isArray(value)) return []
  const capabilities = new Set<'text' | 'image'>()
  for (const capability of value) {
    const normalized = String(capability).toLowerCase()
    if (normalized === 'completion' || normalized === 'text') capabilities.add('text')
    if (normalized === 'vision' || normalized === 'image') capabilities.add('image')
  }
  return [...capabilities]
}

/**
 * GET /api/model-registry - Get model registry (owner or standard)
 */
export async function handleGetModelRegistry(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, query } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    // Allow authenticated users (owner or standard) to view model registry
    // Note: isAuthenticated check above already excludes guest/anonymous

    // CRITICAL: Read ONLY from user's registry (initialized from system on first access)
    // DO NOT fall back to system registry here
    const registry = readModelRegistry(user.username);

    // Get ACTUAL backend status (checks if servers are running)
    const backendStatus = await getBackendStatus();

    // Process user registry models - this is the ONLY source of truth
    let availableModels = collapseModelInventory(
      Object.entries(registry.models || {})
        .filter(([id]) => !isRetiredDevelopmentModelId(id))
        .map(([id, config]) => ({
          id,
          provider: config.provider,
          model: config.model,
          roles: Array.from(new Set<string>(config.roles || [])),
          capabilities: Array.from(new Set<string>(config.capabilities || [])),
          description: config.description || '',
          adapters: config.adapters || [],
          baseModel: config.baseModel || null,
          metadata: config.metadata || {},
          options: config.options || {},
          source: 'user-registry' as const
        }))
    )


    // Extract base role assignments (defaults)
    const defaults = registry.defaults || {};
    const cognitiveModeMappings = registry.cognitiveModeMappings || {};

    // Get current cognitive mode from query param
    const currentModeValue = query?.cognitiveMode;
    if (currentModeValue !== undefined && !isConfigurableCognitiveMode(currentModeValue)) {
      return { status: 400, error: `Unsupported cognitive mode: ${String(currentModeValue)}` };
    }
    const currentMode = currentModeValue;

    // Compute EFFECTIVE role assignments:
    // Start with defaults, then overlay cognitive mode specific mappings
    // This ensures the UI shows what will ACTUALLY be used
    let roleAssignments = { ...defaults };
    if (currentMode && cognitiveModeMappings[currentMode]) {
      roleAssignments = { ...defaults, ...cognitiveModeMappings[currentMode] };
    }
    const globalSettings = registry.globalSettings || {};

    // Use RESOLVED backend (what's actually running), not just configured
    const activeBackend = backendStatus.backend;
    const resolvedBackend = backendStatus.resolvedBackend;
    const availableBackends = await detectAvailableBackends();
    const isVLLMRunning = availableBackends.vllm.running;
    const isOllamaRunning = availableBackends.ollama.running;

    // vllm.active represents the backend's one loaded/configured model. Overlay
    // its runtime identity for display without replacing the user's persisted
    // roles, capabilities, or options.
    if (activeBackend === 'vllm') {
      const backendConfig = loadBackendConfig()
      const configuredModel = backendStatus.model
        || backendConfig.vllm.servedModelName
        || backendConfig.vllm.model
      const activeVllmModel = availableModels.find(model => model.id === 'vllm.active')
      if (activeVllmModel && configuredModel) {
        activeVllmModel.model = configuredModel
        activeVllmModel.description = `Active vLLM backend model: ${configuredModel}`
      }
    }

    // Inventory retains registered deployments. Role assignments are resolved
    // separately; applying the preferred backend here hides resident specialists.
    if (activeBackend === 'llama-cpp') {
      availableModels = collapseModelInventory(availableModels.map(model => {
        const resolved = resolveModelById(model.id, user.username, model.provider !== 'llama-cpp');
        return resolved.provider === 'llama-cpp'
          ? { ...model, provider: resolved.provider, model: resolved.model, capabilities: resolved.capabilities,
              options: resolved.options, adapters: resolved.adapters, baseModel: resolved.baseModel || null,
              description: `Configured llama.cpp model: ${resolved.model}` }
          : model;
      }));
    }

    // Runtime discovery feeds the existing registry UI; it does not become a
    // second configuration source. A discovered model is persisted only when
    // the user assigns or edits it through this handler.
    let installedOllamaModels: AvailableRegistryModel[] = []
    if (isOllamaRunning) {
      try {
        const installed = await ollama.listModels()
        const productionModels = installed.filter(installedModel => (
          !isRetiredDevelopmentModelId(`ollama.${installedModel.name}`)
        ))
        const discovered = await Promise.all(productionModels.map(async installedModel => {
          const details = await ollama.showModel(installedModel.name).catch(() => ({})) as { capabilities?: string[] }
          return {
            id: `ollama.${installedModel.name}`,
            provider: 'ollama',
            model: installedModel.name,
            roles: [] as string[],
            capabilities: normalizeProviderCapabilities(details.capabilities),
            description: `Installed Ollama model ${installedModel.name}`,
            adapters: [] as string[],
            baseModel: null,
            metadata: { source: 'ollama-runtime-discovery' },
            options: {},
            source: 'runtime-discovery' as const,
          }
        }))

        availableModels = collapseModelInventory([...availableModels, ...discovered])

        const installedNames = new Set(discovered.map(model => model.model))
        installedOllamaModels = collapseModelInventory([
          ...availableModels.filter(model => model.provider === 'ollama' && installedNames.has(model.model)),
          ...discovered,
        ])
      } catch (error) {
        console.warn('[model-registry] Failed to discover Ollama models:', error)
      }
    }

    // Local model info - ONLY for vLLM since it runs ONE model at a time
    // Ollama doesn't need this since users can select any model
    let localModel: {
      id: string;
      name: string;
      provider: 'ollama' | 'vllm' | 'llama-cpp';
      locked: boolean;
    } | null = null;

    if (activeBackend === 'vllm' && isVLLMRunning && backendStatus.model) {
      localModel = {
        id: 'vllm.active',
        name: backendStatus.model,
        provider: 'vllm',
        locked: true
      };
    }

    // Registered llama.cpp deployments remain selectable independently of server state.
    const cloudProviderSet = new Set(['runpod_serverless', 'huggingface', 'openai', 'openrouter', 'remote-server']);
    const bigBrotherProviders = new Set(['claude-code', 'anthropic']);

    // Discover vLLM LoRA adapters for the user
    let vllmLoras: Array<{
      id: string;
      name: string;
      path: string;
      createdAt: string;
      loaded: boolean;
      valid: boolean;
    }> = [];

    if (activeBackend === 'vllm' && isVLLMRunning) {
      try {
        const profilePaths = getProfilePaths(user.username);
        const adapters = await discoverVllmLoraAdapters(profilePaths.out);

        // Get currently loaded LoRAs
        let loadedLoras: string[] = [];
        try {
          loadedLoras = await getVLLMLoadedLoras();
        } catch { /* vLLM might not be running */ }

        vllmLoras = adapters.map(a => ({
          id: `vllm-lora.${a.name}`,
          name: a.name,
          path: a.path,
          createdAt: a.createdAt,
          loaded: loadedLoras.includes(a.name),
          valid: a.valid,
        }));
      } catch (error) {
        console.warn('[model-registry] Failed to discover vLLM LoRAs:', error);
      }
    }

    const llamaConfig = loadBackendConfig().llamaCpp;
    if (llamaConfig.model) availableModels.push({
      id: `llama-cpp.${llamaConfig.model}`, provider: 'llama-cpp', model: llamaConfig.model,
      roles: [], capabilities: llamaConfig.capabilities, adapters: [], baseModel: null,
      description: 'Configured llama.cpp model', options: { ...llamaConfig, lora: [] },
      metadata: {}, source: 'user-registry',
    });
    if (availableBackends.llamaCpp?.running) {
      const adapters = await getLlamaCppAdapters(llamaConfig);
      for (const adapter of adapters) availableModels.push({
        id: llamaAdapterModelId(llamaConfig.model, llamaConfig.endpoint, adapter.path), provider: 'llama-cpp', model: llamaConfig.model,
        roles: [], capabilities: llamaConfig.capabilities, adapters: [adapter.path], baseModel: llamaConfig.model,
        description: `${llamaConfig.model} + ${path.basename(adapter.path)}`,
        options: { ...llamaConfig, lora: [{ path: adapter.path, scale: 1 }] },
        metadata: {}, source: 'user-registry',
      });
    }

    availableModels = collapseModelInventory(availableModels);
    const llamaModels = availableModels.filter(model => model.provider === 'llama-cpp');
    if (resolvedBackend === 'llama-cpp' && llamaModels.length) {
      localModel = { id: `llama-cpp.${llamaConfig.model}`, name: backendStatus.model!, provider: 'llama-cpp', locked: true };
    }

    const modelCategories = {
      local: [...llamaModels, ...(activeBackend === 'vllm' && isVLLMRunning
        ? [{ id: 'vllm.active', model: backendStatus.model || 'unknown', provider: 'vllm', locked: true }]
        : activeBackend !== 'llama-cpp' && isOllamaRunning
          ? installedOllamaModels
          : []), ...availableModels.filter(model => model.provider === 'local-models')],
      lora: vllmLoras,  // vLLM LoRA adapters
      remote: availableModels.filter(m => cloudProviderSet.has(m.provider)),
      bigBrother: availableModels.filter(m => bigBrotherProviders.has(m.provider))
    };

    await audit({
      category: 'action',
      level: 'info',
      action: 'model_registry_view',
      actor: user.username,
      details: {
        userId: user.id ?? user.userId,
        activeBackend
      }
    });

    return successResponse({
      success: true,
      availableModels,
      roleAssignments,
      resolvedRoles: Object.fromEntries(Object.keys(roleAssignments).filter(isModelRole).map(role => {
        try { return [role, resolveModelForCognitiveMode(currentMode || 'dual', role, user.username)]; }
        catch (error) { return [role, { error: (error as Error).message }]; }
      })),
      workflowModels: currentMode ? await workflowModelBindings(currentMode, user.username) : [],
      cognitiveModeMappings,
      globalSettings,
      version: registry.version || '1.0.0',
      activeBackend,
      resolvedBackend,
      localModel,
      sharedArtifacts: listLocalModelArtifacts(),
      modelCategories
    });
  } catch (error) {
    console.error('[model-registry] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/model-registry - Assign model to role (owner or standard)
 */
export async function handleAssignModelRole(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    // Allow authenticated users (owner or standard) to modify their model registry
    // Note: isAuthenticated check above already excludes guest/anonymous

    const { role, modelId, cognitiveMode } = body || {};

    if (!role || !modelId) {
      return { status: 400, error: 'role and modelId are required' };
    }
    if (role === 'environmentRouter') {
      return {
        status: 400,
        error: 'environmentRouter is retired; assign the environmentActionSelector role instead',
      };
    }
    if (!isModelRole(role)) {
      return { status: 400, error: `Unsupported model role: ${String(role)}` };
    }
    if (typeof modelId !== 'string') {
      return { status: 400, error: 'modelId must be a string' };
    }
    if (cognitiveMode !== undefined && !isConfigurableCognitiveMode(cognitiveMode)) {
      return { status: 400, error: `Unsupported cognitive mode: ${String(cognitiveMode)}` };
    }
    if (isRetiredDevelopmentModelId(modelId)) {
      return {
        status: 400,
        error: 'The retired Environment Router artifact cannot serve the Environment action-selector contract',
      };
    }

    // CRITICAL: User's registry is the ONLY source of truth (initialized from system on first access)
    const registry = readModelRegistry(user.username);
    registry.models = registry.models || {};

    // Auto-register runtime-discovered models that aren't in user's registry
    // NO SYSTEM REGISTRY FALLBACK - only dynamic discovery types
    if (!registry.models[modelId]) {

      if (modelId.startsWith('llama-cpp-lora.')) {
        const config = loadBackendConfig().llamaCpp;
        const adapters = await getLlamaCppAdapters(config);
        const adapter = adapters.find(value => modelId === llamaAdapterModelId(config.model, config.endpoint, value.path));
        if (!adapter) return { status: 400, error: 'Unknown loaded llama.cpp adapter' };
        registry.models[modelId] = { provider: 'llama-cpp', model: config.model,
          roles: role ? [role] : [], capabilities: config.capabilities, adapters: [adapter.path], baseModel: config.model,
          description: `${config.model} + ${path.basename(adapter.path)}`,
          options: { ...config, lora: [{ path: adapter.path, scale: 1 }] } };
      } else if (modelId.startsWith('llama-cpp.')) {
        const config = loadBackendConfig().llamaCpp;
        if (modelId !== `llama-cpp.${config.model}`) return { status: 400, error: 'Unknown llama.cpp model' };
        registry.models[modelId] = { provider: 'llama-cpp', model: config.model,
          roles: role ? [role] : [], capabilities: config.capabilities, adapters: [],
          description: 'Configured llama.cpp model', options: { ...config, lora: [] } };
      } else if (modelId.startsWith('vllm.')) {
        // vLLM model - runtime discovery
        const backendConfig = loadBackendConfig();
        registry.models[modelId] = {
          provider: 'vllm',
          model: backendConfig.vllm?.model || 'unknown',
          roles: role ? [role] : [],
          capabilities: [],
          adapters: [],
          description: `vLLM backend model`,
          options: {},
          metadata: { source: 'vllm-backend', locked: true }
        };
      } else if (modelId.startsWith('vllm-lora.')) {
        // vLLM LoRA adapter - runtime discovery
        const adapterName = modelId.replace(/^vllm-lora\./, '');
        const backendConfig = loadBackendConfig();
        registry.models[modelId] = {
          provider: 'vllm',  // Use vllm provider, LoRA name is the model
          model: adapterName,  // vLLM routes to LoRA based on model name
          baseModel: backendConfig.vllm?.model,
          roles: role ? [role] : [],
          capabilities: [],
          adapters: [],
          description: `vLLM LoRA adapter: ${adapterName}`,
          options: {},
          metadata: { source: 'vllm-lora-discovery', isLora: true }
        };
      } else if (modelId.startsWith('lora.')) {
        // LoRA adapter - runtime discovery
        const adapterName = modelId.replace(/^lora\./, '');
        const backendConfig = loadBackendConfig();
        const useVllm = backendConfig.activeBackend === 'vllm';
        const baseModel = useVllm
          ? backendConfig.vllm?.model
          : backendConfig.ollama?.defaultModel;

        registry.models[modelId] = {
          provider: useVllm ? 'vllm' : 'ollama',
          model: adapterName,
          baseModel: baseModel,
          roles: role ? [role] : [],
          capabilities: [],
          adapters: [],
          description: `LoRA adapter: ${adapterName}`,
          options: {},
          metadata: { source: 'lora-discovery' }
        };
      } else if (modelId.startsWith('ollama.')) {
        // Ollama model - runtime discovery
        const inferredName = modelId.replace(/^ollama\./, '');
        const details = await ollama.showModel(inferredName).catch(() => ({})) as { capabilities?: string[] };
        registry.models[modelId] = {
          provider: 'ollama',
          model: inferredName,
          roles: role ? [role] : [],
          capabilities: normalizeProviderCapabilities(details.capabilities),
          adapters: [],
          description: `Ollama model ${inferredName}`,
          options: {},
          metadata: { source: 'ollama-discovery' }
        };
      } else if (modelId.startsWith('remote-server:')) {
        // Remote server model - runtime discovery from connected remote server
        // ID format: remote-server:remote-ollama-modelname or remote-server:remote-vllm-modelname
        const remoteId = modelId.replace(/^remote-server:/, '');
        // Extract model name: remote-ollama-qwen3.5:9b -> qwen3.5:9b
        const modelName = remoteId.replace(/^remote-(ollama|vllm)-/, '');
        const remoteProvider = remoteId.startsWith('remote-ollama') ? 'remote-ollama' : 'remote-vllm';

        registry.models[modelId] = {
          provider: 'remote-server',
          model: modelName,
          roles: role ? [role] : [],
          capabilities: [],
          adapters: [],
          description: `Remote server model (${remoteProvider}): ${modelName}`,
          options: {},
          metadata: {
            source: 'remote-server-discovery',
            remoteProvider
          }
        };
      } else {
        // Unknown model ID - should already be in user's registry
        // User's registry was initialized from system, so cloud models should be there
        console.error(`[model-registry] Model ${modelId} not found in user registry`);
        return { status: 400, error: `Model ${modelId} not found in your model registry` };
      }
    }

    // Ensure role list includes this role
    const entry = registry.models[modelId];
    const trainingCandidate = await assertTrainingModelApproved(user.username, entry.provider, entry.model);
    if (trainingCandidate) {
      entry.metadata = { ...entry.metadata, trainingRunLabel: trainingCandidate.runLabel,
        trainingActivatedAt: new Date().toISOString() };
    }
    if (!Array.isArray(entry.roles)) {
      entry.roles = [];
    }
    if (!entry.roles.includes(role)) {
      entry.roles.push(role);
    }

    // Update cognitive mode mapping or default role assignment
    if (cognitiveMode) {
      registry.cognitiveModeMappings = registry.cognitiveModeMappings || {};
      registry.cognitiveModeMappings[cognitiveMode] = registry.cognitiveModeMappings[cognitiveMode] || {};
      registry.cognitiveModeMappings[cognitiveMode][role] = modelId;
    } else if (isModelRole(role)) {
      registry.defaults = registry.defaults || {};
      registry.defaults[role] = modelId;
    }

    writeModelRegistry(user.username, registry);

    // Handle vLLM LoRA - enable adapter and check if restart needed
    let needsRestart = false;
    if (modelId.startsWith('vllm-lora.')) {
      const loraName = modelId.replace('vllm-lora.', '');
      const profilePaths = getProfilePaths(user.username);

      // Enable the adapter in user's LoRA config
      const wasAdded = enableVllmLoraAdapter(profilePaths.etc, loraName, user.username);

      // Check if LoRA is currently loaded in vLLM
      if (wasAdded) {
        try {
          const loadedLoras = await getVLLMLoadedLoras();
          needsRestart = !loadedLoras.includes(loraName);
        } catch {
          // vLLM might not be running - restart will be needed when it starts
          needsRestart = true;
        }
      }
    }

    await audit({
      category: 'data_change',
      level: 'info',
      event: 'model_role_updated',
      action: 'model_role_updated',
      actor: user.username,
      userId: user.userId,
      metadata: {
        role,
        modelId,
        cognitiveMode: cognitiveMode || 'default',
        profilePath: resolveModelsPath(user.username),
        needsRestart
      }
    });

    return successResponse({
      success: true,
      message: `Role ${role} assigned to model ${modelId}`,
      needsRestart,
      registry: {
        availableModels: Object.keys(registry.models || {}),
        roleAssignments: registry.defaults,
        cognitiveModeMappings: registry.cognitiveModeMappings
      }
    });
  } catch (error) {
    console.error('[model-registry] POST error:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * PUT /api/model-registry - Update global settings (owner or standard)
 */
export async function handleUpdateModelSettings(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    // Allow authenticated users (owner or standard) to modify their own settings
    // Note: isAuthenticated check above already excludes guest/anonymous

    const registry = readModelRegistry(user.username);

    const { globalSettings, modelId, capabilities, options } = body || {};
    if (modelId !== undefined) {
      if (typeof modelId !== 'string' || !modelId) {
        return { status: 400, error: 'modelId must be a non-empty string' };
      }
      const model = registry.models?.[modelId];
      if (!model) {
        return { status: 404, error: `Model ${modelId} is not registered. Assign it to a role before editing its options.` };
      }

      if (capabilities !== undefined) {
        if (!Array.isArray(capabilities)
          || capabilities.some((value: unknown) => value !== 'text' && value !== 'image')) {
          return { status: 400, error: 'capabilities may contain only text and image' };
        }
        model.capabilities = Array.from(new Set(capabilities));
      }

      if (options !== undefined) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
          return { status: 400, error: 'options must be an object' };
        }

        const nextOptions: Record<string, unknown> = {};
        if (options.contextWindow !== undefined) {
          if (!Number.isInteger(options.contextWindow) || options.contextWindow < 512) {
            return { status: 400, error: 'options.contextWindow must be an integer of at least 512' };
          }
          nextOptions.contextWindow = options.contextWindow;
        }
        if (options.enableThinking !== undefined) {
          if (typeof options.enableThinking !== 'boolean') {
            return { status: 400, error: 'options.enableThinking must be a boolean' };
          }
          nextOptions.enableThinking = options.enableThinking;
        }
        if (options.maxImages !== undefined) {
          if (!Number.isInteger(options.maxImages) || options.maxImages < 1 || options.maxImages > 16) {
            return { status: 400, error: 'options.maxImages must be an integer between 1 and 16' };
          }
          nextOptions.maxImages = options.maxImages;
        }
        if (options.maxImageBytes !== undefined) {
          if (!Number.isInteger(options.maxImageBytes) || options.maxImageBytes < 1 || options.maxImageBytes > 20 * 1024 * 1024) {
            return { status: 400, error: 'options.maxImageBytes must be an integer between 1 and 20971520' };
          }
          nextOptions.maxImageBytes = options.maxImageBytes;
        }
        if (options.allowedImageMimeTypes !== undefined) {
          if (!Array.isArray(options.allowedImageMimeTypes)
            || options.allowedImageMimeTypes.length === 0
            || options.allowedImageMimeTypes.some((value: unknown) => typeof value !== 'string' || !value.startsWith('image/'))) {
            return { status: 400, error: 'options.allowedImageMimeTypes must contain image MIME types' };
          }
          nextOptions.allowedImageMimeTypes = Array.from(new Set(options.allowedImageMimeTypes));
        }

        model.options = { ...(model.options || {}), ...nextOptions };
      }

      writeModelRegistry(user.username, registry);
      await audit({
        category: 'data_change',
        level: 'info',
        event: 'model_options_updated',
        action: 'model_options_updated',
        actor: user.username,
        userId: user.userId,
        metadata: { modelId, capabilities: model.capabilities, options: model.options },
      });

      return successResponse({
        success: true,
        message: `Model ${modelId} options updated`,
        model: {
          id: modelId,
          capabilities: model.capabilities || [],
          options: model.options || {},
        },
      });
    }

    if (!globalSettings) {
      return { status: 400, error: 'globalSettings or modelId is required' };
    }

    const savedSettings = updateModelGlobalSettings(user.username, globalSettings);

    await audit({
      category: 'data_change',
      level: 'info',
      action: 'model_global_settings_updated',
      actor: user.username,
      details: {
        userId: user.id ?? user.userId,
        settings: globalSettings,
        profilePath: resolveModelsPath(user.username)
      }
    });

    return successResponse({
      success: true,
      message: 'Global settings updated',
      globalSettings: savedSettings
    });
  } catch (error) {
    console.error('[model-registry] PUT error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
