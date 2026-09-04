import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js'

const execute: NodeExecutor = async (_inputs, context) => {
  const reflection = context.reflection
  if (!reflection || typeof reflection !== 'object' || Array.isArray(reflection)) {
    throw new Error('Reflection Input requires a reflection in graph context')
  }
  const record = reflection as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id.trim()
    || typeof record.content !== 'string' || !record.content.trim()) {
    throw new Error('Reflection Input requires a typed reflection id and content')
  }
  return { reflection: record, content: record.content.trim() }
}

export const ReflectionInputNode: NodeDefinition = defineNode({
  id: 'reflection_input',
  name: 'Reflection Input',
  category: 'input',
  inputs: [],
  outputs: [
    { name: 'reflection', type: 'object' },
    { name: 'content', type: 'string' },
  ],
  properties: {},
  description: 'Admits one validated reflection supplied by the task-suggestion owner',
  execute,
})
