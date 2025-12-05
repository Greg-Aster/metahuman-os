/**
 * Cognitive Nodes
 *
 * Nodes for cognitive processing, planning, and reasoning.
 * These nodes are used in cognitive graphs for complex multi-step workflows.
 */

export { AuditLoggerNode } from './audit-logger.node.js';
export { ToolCatalogBuilderNode } from './tool-catalog-builder.node.js';
export { PlanValidatorNode } from './plan-validator.node.js';
export { PersonaFormatterNode } from './persona-formatter.node.js';
export { PolicyLoaderNode } from './policy-loader.node.js';
export { InnerDialogueSaverNode } from './inner-dialogue-saver.node.js';
export { ScratchpadWriterNode } from './scratchpad-writer.node.js';

// Re-export all nodes as an array for registration
import { AuditLoggerNode } from './audit-logger.node.js';
import { ToolCatalogBuilderNode } from './tool-catalog-builder.node.js';
import { PlanValidatorNode } from './plan-validator.node.js';
import { PersonaFormatterNode } from './persona-formatter.node.js';
import { PolicyLoaderNode } from './policy-loader.node.js';
import { InnerDialogueSaverNode } from './inner-dialogue-saver.node.js';
import { ScratchpadWriterNode } from './scratchpad-writer.node.js';

export const cognitiveNodes = [
  AuditLoggerNode,
  ToolCatalogBuilderNode,
  PlanValidatorNode,
  PersonaFormatterNode,
  PolicyLoaderNode,
  InnerDialogueSaverNode,
  ScratchpadWriterNode,
];
