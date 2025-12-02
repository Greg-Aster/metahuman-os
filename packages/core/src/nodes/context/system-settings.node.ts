/**
 * System Settings Node
 *
 * Provides cognitive mode and system configuration
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { loadCognitiveMode } from '../../cognitive-mode.js';

export const SystemSettingsNode: NodeDefinition = defineNode({
  id: 'system_settings',
  name: 'System Settings',
  category: 'context',
  inputs: [],
  outputs: [
    { name: 'cognitiveMode', type: 'cognitiveMode', description: 'Current cognitive mode' },
    { name: 'chatSettings', type: 'object', description: 'Chat configuration' },
    { name: 'memoryPolicy', type: 'object', description: 'Memory write policy' },
    { name: 'trustLevel', type: 'string', description: 'Current trust level' },
  ],
  description: 'Provides cognitive mode and system configuration',

  execute: async (inputs, context) => {
    try {
      const cognitiveMode = loadCognitiveMode();
      const mode = cognitiveMode.currentMode || context.cognitiveMode || 'dual';

      let chatSettings = null;
      try {
        const { loadChatSettings } = await import('../../chat-settings.js');
        chatSettings = loadChatSettings();
      } catch (error) {
        console.warn('[SystemSettings] Could not load chat settings:', error);
      }

      let activeFacet = null;
      try {
        const { getActiveFacet } = await import('../../identity.js');
        activeFacet = getActiveFacet();
      } catch (error) {
        console.warn('[SystemSettings] Could not load active facet:', error);
      }

      let memoryPolicy = null;
      try {
        const { canWriteMemory } = await import('../../cognitive-mode.js');
        const canWrite = canWriteMemory(mode);
        memoryPolicy = {
          canWriteConversation: canWrite,
          canWriteInnerDialogue: canWrite,
        };
      } catch (error) {
        console.warn('[SystemSettings] Could not load memory policy:', error);
      }

      let trustLevel = 'supervised_auto';
      try {
        const { loadDecisionRules } = await import('../../identity.js');
        const rules = loadDecisionRules();
        trustLevel = rules.trustLevel;
      } catch (error) {
        console.warn('[SystemSettings] Could not load trust level:', error);
      }

      return {
        cognitiveMode: mode,
        chatSettings: chatSettings || {
          temperature: 0.7,
          maxContextChars: 8000,
          semanticSearchThreshold: 0.6,
        },
        activeFacet: activeFacet || 'default',
        memoryPolicy: memoryPolicy || {
          canWriteConversation: mode !== 'emulation',
          canWriteInnerDialogue: mode !== 'emulation',
        },
        trustLevel,
        settings: {
          recordingEnabled: mode !== 'emulation',
          proactiveAgents: mode === 'dual',
        },
      };
    } catch (error) {
      console.error('[SystemSettings] Error loading settings:', error);
      return {
        cognitiveMode: context.cognitiveMode || 'dual',
        chatSettings: {
          temperature: 0.7,
          maxContextChars: 8000,
          semanticSearchThreshold: 0.6,
        },
        activeFacet: 'default',
        memoryPolicy: {
          canWriteConversation: true,
          canWriteInnerDialogue: true,
        },
        trustLevel: 'supervised_auto',
        settings: {},
      };
    }
  },
});
