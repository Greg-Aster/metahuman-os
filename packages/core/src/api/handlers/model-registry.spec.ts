import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collapseModelInventory,
  isConfigurableCognitiveMode,
  isRetiredDevelopmentModelId,
  type AvailableRegistryModel,
  projectWorkflowModels,
} from './model-registry.js'
import { migrateModelRegistry, type ModelRegistry } from '../../model-resolver.js'
import type { SvelteFlowGraph } from '../../cognitive-graph-schema.js'
import { getAllSchemas } from '../../nodes/index.js'
import { MODEL_ROLE_OPTIONS, isModelRole } from '../../model-roles.js'

test('all configurable model nodes expose the same saved roles as the sidebar', () => {
  const modelNodes = getAllSchemas().filter(schema => isModelRole(schema.properties?.role))
  assert(modelNodes.some(schema => schema.id === 'orchestrator_llm'))
  assert(modelNodes.some(schema => schema.id === 'persona_llm'))
  assert(modelNodes.some(schema => schema.id === 'environment_task_planner'))
  for (const schema of modelNodes) {
    assert.deepEqual(schema.propertySchemas?.role?.options, [...MODEL_ROLE_OPTIONS], schema.id)
    assert.equal(schema.propertySchemas?.role?.type, 'select', schema.id)
    assert.equal(schema.propertySchemas?.modelId, undefined, schema.id)
  }
})

test('workflow projection follows saved roles and changes without editing the graph', () => {
  const graph = { nodes: [
    { id: 'intent', data: { label: 'Intent', nodeType: 'orchestrator_llm', properties: { role: 'orchestrator' } } },
    { id: 'task', data: { label: 'Task', nodeType: 'model_router', properties: { role: 'environmentActionSelector' } } },
    { id: 'conversation', data: { label: 'Conversation', nodeType: 'environment_conversation', properties: { role: 'persona' } } },
    { id: 'context', data: { label: 'Context', nodeType: 'environment_context_builder', properties: {} } },
  ], edges: [] } as unknown as SvelteFlowGraph
  const assignments: Record<string, string> = { orchestrator: 'trained.intent', environmentActionSelector: 'trained.task', persona: 'main-9b' }
  const calls: string[] = []
  const project = () => projectWorkflowModels(graph, role => {
    calls.push(role)
    return { id: assignments[role], model: assignments[role], provider: 'llama-cpp' }
  })
  const snapshot = JSON.stringify(graph)
  assert.deepEqual(project().map(row => row.model), ['trained.intent', 'trained.task', 'main-9b'])
  assert.deepEqual(calls, ['orchestrator', 'environmentActionSelector', 'persona'])
  assignments.orchestrator = 'trained.intent-new'
  assert.equal(project()[0].model, 'trained.intent-new')
  assert.equal(JSON.stringify(graph), snapshot)
  graph.edges.push({ target: 'conversation', targetHandle: 'role' } as any)
  assert.equal(project()[2].selection, 'runtime-role')
})

test('workflow projection reports an unresolved node model without substituting a default', () => {
  const graph = { nodes: [{ id: 'task', data: { nodeType: 'model_router', properties: { role: 'persona' } } }], edges: [] } as unknown as SvelteFlowGraph
  const result = projectWorkflowModels(graph, () => { throw new Error('Model missing') })
  assert.equal(result[0].error, 'Model missing')
  assert.equal(result[0].model, undefined)
})

function model(
  id: string,
  provider: string,
  name: string,
  roles: string[] = [],
): AvailableRegistryModel {
  return {
    id,
    provider,
    model: name,
    roles,
    capabilities: ['text'],
    description: '',
    adapters: [],
    baseModel: null,
    metadata: {},
    options: {},
    source: 'user-registry',
  }
}

test('collapseModelInventory lists a provider model once across role aliases', () => {
  const inventory = collapseModelInventory([
    model('default.orchestrator', 'ollama', 'qwen3.5:9b', ['orchestrator']),
    model('default.persona', 'ollama', 'qwen3.5:9b', ['persona']),
    {
      ...model('ollama.qwen3.5:9b', 'ollama', 'qwen3.5:9b'),
      capabilities: ['text', 'image'],
      source: 'runtime-discovery',
    },
  ])

  assert.equal(inventory.length, 1)
  assert.equal(inventory[0]?.id, 'ollama.qwen3.5:9b')
  assert.deepEqual(inventory[0]?.aliases, [
    'default.orchestrator',
    'default.persona',
    'ollama.qwen3.5:9b',
  ])
  assert.deepEqual(inventory[0]?.roles, ['orchestrator', 'persona'])
  assert.deepEqual(inventory[0]?.capabilities, ['text', 'image'])
})

test('collapseModelInventory keeps the same model name from different providers distinct', () => {
  const inventory = collapseModelInventory([
    model('ollama.qwen3.5:9b', 'ollama', 'qwen3.5:9b'),
    model('remote.qwen3.5:9b', 'remote-server', 'qwen3.5:9b'),
  ])

  assert.equal(inventory.length, 2)
})

test('model inventory preserves distinct adapters and serving endpoints', () => {
  const base = model('base', 'llama-cpp', 'shared-base')
  assert.equal(collapseModelInventory([
    base,
    { ...base, id: 'adapter-a', adapters: ['a.gguf'], options: { lora: [{ id: 0, scale: 1 }] } },
    { ...base, id: 'adapter-b', adapters: ['b.gguf'], options: { lora: [{ id: 1, scale: 1 }] } },
    { ...base, id: 'other-server', options: { endpoint: 'http://localhost:8081' } },
  ]).length, 4)
})

test('production inventory rejects development folds and checkpoint tags', () => {
  assert.equal(isRetiredDevelopmentModelId('environment-classifier.run.fold-0.checkpoint-516'), true)
  assert.equal(isRetiredDevelopmentModelId('ollama.environment-classifier-2b:checkpoint-120'), true)
  assert.equal(isRetiredDevelopmentModelId('ollama.environment-classifier-0.8b:final'), true)
  assert.equal(isRetiredDevelopmentModelId('ollama.environment-action-selector-0.8b:v1'), true)
})

test('model mapping API accepts only maintained cognitive modes', () => {
  for (const mode of ['dual', 'agent', 'emulation', 'environment']) {
    assert.equal(isConfigurableCognitiveMode(mode), true)
  }
  assert.equal(isConfigurableCognitiveMode('default'), false)
  assert.equal(isConfigurableCognitiveMode('environment '), false)
  assert.equal(isConfigurableCognitiveMode(null), false)
})

test('registry migration removes environmentRouter instead of assigning its incompatible artifact to the new role', () => {
  const source = {
    version: '1.0.0',
    defaults: {
      persona: 'default.persona',
      environmentRouter: 'ollama.environment-classifier-0.8b:final',
    },
    models: {
      'default.persona': model('default.persona', 'ollama', 'qwen3.5:9b', ['persona']),
      'ollama.environment-classifier-0.8b:final': model(
        'ollama.environment-classifier-0.8b:final',
        'ollama',
        'environment-classifier-0.8b:final',
        ['environmentRouter'],
      ),
    },
    roleHierarchy: {
      environmentRouter: ['ollama.environment-classifier-0.8b:final'],
    },
    cognitiveModeMappings: {
      environment: {
        persona: 'default.persona',
        environmentRouter: 'ollama.environment-classifier-0.8b:final',
      },
    },
  } as unknown as ModelRegistry

  const migration = migrateModelRegistry(source)
  assert.equal(migration.changed, true)
  assert.equal((migration.registry.defaults as Record<string, string>).environmentRouter, undefined)
  assert.equal(
    migration.registry.defaults.environmentActionSelector,
    'default.orchestrator',
  )
  assert.equal(
    migration.registry.cognitiveModeMappings?.environment?.environmentRouter,
    undefined,
  )
  assert.equal(
    migration.registry.cognitiveModeMappings?.environment?.environmentActionSelector,
    'default.orchestrator',
  )
  assert.equal(
    migration.registry.models['ollama.environment-classifier-0.8b:final'],
    undefined,
  )
  assert.equal(migration.registry.models['default.orchestrator']?.roles.includes('environmentActionSelector'), true)
  assert.deepEqual(migration.registry.models['default.orchestrator']?.capabilities, ['text', 'image'])
})

test('registry migration preserves an explicit selector assignment and unrelated model records', () => {
  const source = {
    version: '1.0.0',
    defaults: {
      persona: 'default.persona',
      environmentActionSelector: 'ollama.custom-selector',
    },
    models: {
      'default.persona': model('default.persona', 'ollama', 'qwen3.5:9b', ['persona']),
      'ollama.custom-selector': model('ollama.custom-selector', 'ollama', 'custom-selector', ['environmentActionSelector']),
      'ollama.environment-classifier-not-a-router': model(
        'ollama.environment-classifier-not-a-router',
        'ollama',
        'environment-classifier-not-a-router',
        ['summarizer'],
      ),
    },
    cognitiveModeMappings: {
      environment: { environmentActionSelector: 'ollama.custom-selector' },
    },
  } as unknown as ModelRegistry

  const migration = migrateModelRegistry(source)
  assert.equal(migration.registry.defaults.environmentActionSelector, 'ollama.custom-selector')
  assert.equal(
    migration.registry.cognitiveModeMappings?.environment?.environmentActionSelector,
    'ollama.custom-selector',
  )
  assert.ok(migration.registry.models['ollama.environment-classifier-not-a-router'])
})

test('registry migration replaces the known text-only selector with the vision-capable owner', () => {
  const source = {
    version: '1.0.0',
    defaults: { environmentActionSelector: 'ollama.environment-action-selector-0.8b:v1' },
    models: {
      'default.orchestrator': model('default.orchestrator', 'ollama', 'qwen3.5:9b', ['orchestrator']),
      'ollama.environment-action-selector-0.8b:v1': model(
        'ollama.environment-action-selector-0.8b:v1',
        'ollama',
        'environment-action-selector-0.8b:v1',
        ['environmentActionSelector'],
      ),
    },
    roleHierarchy: {
      environmentActionSelector: ['ollama.environment-action-selector-0.8b:v1'],
    },
    cognitiveModeMappings: {
      environment: { environmentActionSelector: 'ollama.environment-action-selector-0.8b:v1' },
    },
  } as unknown as ModelRegistry

  const migration = migrateModelRegistry(source)
  assert.equal(migration.registry.defaults.environmentActionSelector, 'default.orchestrator')
  assert.deepEqual(migration.registry.roleHierarchy?.environmentActionSelector, ['default.orchestrator'])
  assert.equal(migration.registry.models['ollama.environment-action-selector-0.8b:v1'], undefined)
  assert.equal(migration.registry.models['default.orchestrator']?.roles.includes('environmentActionSelector'), true)
  assert.equal(migration.registry.models['default.orchestrator']?.capabilities?.includes('image'), true)
})

test('adding an Environment intent role preserves general orchestration and explicit assignments', () => {
  const source = { version: '1.0.0', description: 'Role split', defaults: { orchestrator: 'general' },
    models: { general: model('general', 'llama-cpp', 'general-9b', ['orchestrator']),
      specialist: model('specialist', 'llama-cpp', 'intent-small', ['environmentIntent']) },
    cognitiveModeMappings: { environment: { orchestrator: 'general' } } } as unknown as ModelRegistry
  const first = migrateModelRegistry(source).registry
  assert.equal(first.defaults.environmentIntent, 'general')
  assert.equal(first.cognitiveModeMappings?.environment?.environmentIntent, 'general')
  first.cognitiveModeMappings!.environment!.environmentIntent = 'specialist'
  const next = migrateModelRegistry(first).registry
  assert.equal(next.cognitiveModeMappings?.environment?.environmentIntent, 'specialist')
  assert.equal(next.cognitiveModeMappings?.environment?.orchestrator, 'general')
  assert.equal(next.defaults.orchestrator, 'general')
})
