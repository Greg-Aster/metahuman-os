import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collapseModelInventory,
  isRetiredDevelopmentModelId,
  type AvailableRegistryModel,
} from './model-registry.js'
import { migrateModelRegistry, type ModelRegistry } from '../../model-resolver.js'

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
    model('ollama.qwen3.5:2b', 'ollama', 'qwen3.5:2b'),
    model('remote.qwen3.5:2b', 'remote-server', 'qwen3.5:2b'),
  ])

  assert.equal(inventory.length, 2)
})

test('production inventory rejects development folds and checkpoint tags', () => {
  assert.equal(isRetiredDevelopmentModelId('environment-classifier.run.fold-0.checkpoint-516'), true)
  assert.equal(isRetiredDevelopmentModelId('ollama.environment-classifier-2b:checkpoint-120'), true)
  assert.equal(isRetiredDevelopmentModelId('ollama.environment-classifier-0.8b:final'), true)
  assert.equal(isRetiredDevelopmentModelId('ollama.environment-action-selector-0.8b:v1'), false)
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
    'ollama.environment-action-selector-0.8b:v1',
  )
  assert.equal(
    migration.registry.cognitiveModeMappings?.environment?.environmentRouter,
    undefined,
  )
  assert.equal(
    migration.registry.cognitiveModeMappings?.environment?.environmentActionSelector,
    'ollama.environment-action-selector-0.8b:v1',
  )
  assert.equal(
    migration.registry.models['ollama.environment-classifier-0.8b:final'],
    undefined,
  )
  assert.deepEqual(
    migration.registry.models['ollama.environment-action-selector-0.8b:v1']?.roles,
    ['environmentActionSelector'],
  )
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
