/**
 * Node Executor Registry
 * Central registry for all node executors with plugin support
 */

import type { NodeExecutor } from './types.js';

// Import all executor modules
import { textInputExecutor, micInputExecutor, speechToTextExecutor, userInputExecutor } from './input-executors.js';
import { sessionContextExecutor, systemSettingsExecutor, semanticSearchExecutor, conversationHistoryExecutor, contextBuilderExecutor, authCheckExecutor } from './context-executors.js';
import { cognitiveModeRouterExecutor, operatorEligibilityExecutor } from './routing-executors.js';
import {
  reactPlannerExecutor,
  skillExecutorExecutor,
  observationFormatterExecutor,
  completionCheckerExecutor,
  responseSynthesizerExecutor,
  planParserExecutor,
  errorRecoveryExecutor,
  stuckDetectorExecutor,
} from './operator-executors.js';
import { personaLLMExecutor, modelResolverExecutor, modelRouterExecutor } from './llm-executors.js';
import { chainOfThoughtStripperExecutor, safetyValidatorExecutor, responseRefinerExecutor } from './safety-executors.js';
import { memoryCaptureExecutor, auditLoggerExecutor, streamWriterExecutor, chatViewExecutor, ttsExecutor } from './output-executors.js';
import { loopControllerExecutor, conditionalBranchExecutor, switchExecutor, forEachExecutor, conditionalRouterExecutor } from './control-flow-executors.js';
import {
  weightedSamplerExecutor,
  associativeChainExecutor,
  memoryFilterExecutor,
  jsonParserExecutor,
  textTemplateExecutor,
  dataTransformExecutor,
  cacheExecutor,
} from './data-executors.js';
import {
  scratchpadInitializerExecutor,
  scratchpadUpdaterExecutor,
  iterationCounterExecutor,
  scratchpadCompletionCheckerExecutor,
  scratchpadFormatterExecutor,
  scratchpadManagerExecutor,
} from './scratchpad-executors.js';
import { replyToHandlerExecutor, bufferManagerExecutor } from './emulation-executors.js';
import { createSkillExecutor } from './skill-executors.js';
import { memoryLoaderExecutor, memorySaverExecutor, llmEnricherExecutor, agentTimerExecutor } from './agent-executors.js';
import {
  personaLoaderExecutor,
  personaSaverExecutor,
  trustLevelReaderExecutor,
  trustLevelWriterExecutor,
  decisionRulesLoaderExecutor,
  decisionRulesSaverExecutor,
  identityExtractorExecutor,
  valueManagerExecutor,
  goalManagerExecutor,
} from './persona-executors.js';

/**
 * Master registry of all node executors
 */
export const nodeExecutors: Record<string, NodeExecutor> = {
  // Input nodes
  'text_input': textInputExecutor,
  'mic_input': micInputExecutor,
  'speech_to_text': speechToTextExecutor,
  'user_input': userInputExecutor,
  'session_context': sessionContextExecutor,
  'system_settings': systemSettingsExecutor,

  // Router nodes
  'cognitive_mode_router': cognitiveModeRouterExecutor,
  'operator_eligibility': operatorEligibilityExecutor,
  'auth_check': authCheckExecutor,

  // Context nodes
  'semantic_search': semanticSearchExecutor,
  'conversation_history': conversationHistoryExecutor,
  'context_builder': contextBuilderExecutor,

  // Control Flow nodes
  'loop_controller': loopControllerExecutor,
  'conditional_branch': conditionalBranchExecutor,
  'conditional_router': conditionalRouterExecutor,
  'switch': switchExecutor,
  'for_each': forEachExecutor,

  // Memory Curation nodes
  'weighted_sampler': weightedSamplerExecutor,
  'associative_chain': associativeChainExecutor,
  'memory_filter': memoryFilterExecutor,

  // Utility nodes
  'json_parser': jsonParserExecutor,
  'text_template': textTemplateExecutor,
  'data_transform': dataTransformExecutor,
  'cache': cacheExecutor,

  // Advanced Operator nodes
  'plan_parser': planParserExecutor,
  'scratchpad_manager': scratchpadManagerExecutor,
  'error_recovery': errorRecoveryExecutor,
  'stuck_detector': stuckDetectorExecutor,

  // Operator nodes
  'react_planner': reactPlannerExecutor,
  'skill_executor': skillExecutorExecutor,
  'observation_formatter': observationFormatterExecutor,
  'completion_checker': completionCheckerExecutor,
  'response_synthesizer': responseSynthesizerExecutor,

  // Chat nodes
  'persona_llm': personaLLMExecutor,
  'chain_of_thought_stripper': chainOfThoughtStripperExecutor,
  'cot_stripper': chainOfThoughtStripperExecutor, // Alias for chain_of_thought_stripper
  'safety_validator': safetyValidatorExecutor,
  'response_refiner': responseRefinerExecutor,

  // Model nodes
  'model_resolver': modelResolverExecutor,
  'model_router': modelRouterExecutor,

  // Output nodes
  'memory_capture': memoryCaptureExecutor,
  'audit_logger': auditLoggerExecutor,
  'stream_writer': streamWriterExecutor,
  'chat_view': chatViewExecutor,
  'tts': ttsExecutor,

  // ReAct scratchpad nodes (modular components)
  'scratchpad_initializer': scratchpadInitializerExecutor,
  'scratchpad_updater': scratchpadUpdaterExecutor,
  'iteration_counter': iterationCounterExecutor,
  'scratchpad_completion_checker': scratchpadCompletionCheckerExecutor,
  'scratchpad_formatter': scratchpadFormatterExecutor,

  // Emulation mode specific nodes
  'reply_to_handler': replyToHandlerExecutor,
  'buffer_manager': bufferManagerExecutor,

  // Skill nodes (dynamically created)
  'skill_conversational_response': createSkillExecutor('conversational_response'),
  'skill_fs_read': createSkillExecutor('fs_read'),
  'skill_fs_write': createSkillExecutor('fs_write'),
  'skill_fs_list': createSkillExecutor('fs_list'),
  'skill_task_list': createSkillExecutor('task_list'),
  'skill_task_create': createSkillExecutor('task_create'),
  'skill_task_update': createSkillExecutor('task_update'),
  'skill_search_index': createSkillExecutor('search_index'),
  'skill_memory_search': createSkillExecutor('memory_search'),

  // Agent nodes (for autonomous agent workflows)
  'memory_loader': memoryLoaderExecutor,
  'memory_saver': memorySaverExecutor,
  'llm_enricher': llmEnricherExecutor,
  'agent_timer': agentTimerExecutor,

  // Configuration nodes (persona management)
  'persona_loader': personaLoaderExecutor,
  'persona_saver': personaSaverExecutor,
  'trust_level_reader': trustLevelReaderExecutor,
  'trust_level_writer': trustLevelWriterExecutor,
  'decision_rules_loader': decisionRulesLoaderExecutor,
  'decision_rules_saver': decisionRulesSaverExecutor,
  'identity_extractor': identityExtractorExecutor,
  'value_manager': valueManagerExecutor,
  'goal_manager': goalManagerExecutor,
};

/**
 * Register a plugin executor (called by plugin system)
 */
export function registerPluginExecutor(pluginId: string, executor: NodeExecutor): void {
  nodeExecutors[pluginId] = executor;
  console.log(`[NodeExecutors] Registered plugin executor: ${pluginId}`);
}

/**
 * Unregister a plugin executor (called when plugin is unloaded)
 */
export function unregisterPluginExecutor(pluginId: string): void {
  delete nodeExecutors[pluginId];
  console.log(`[NodeExecutors] Unregistered plugin executor: ${pluginId}`);
}

/**
 * Get executor for a node type
 * Checks both built-in executors and registered plugins
 */
export function getNodeExecutor(nodeType: string): NodeExecutor | null {
  // Remove 'cognitive/' or 'plugin/' prefix if present
  const cleanType = nodeType.replace(/^(cognitive|plugin)\//, '');

  // Check registry (includes both built-in and plugin executors)
  return nodeExecutors[cleanType] || null;
}

/**
 * Check if a node type has a real implementation
 */
export function hasRealImplementation(nodeType: string): boolean {
  return getNodeExecutor(nodeType) !== null;
}
