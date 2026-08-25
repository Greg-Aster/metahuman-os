/**
 * TTS Node
 *
 * Delivers text through the configured Text-to-Speech output.
 * Has two input handles: conversation and innerDialogue
 * Local playback uses the client queue; Environment Mode robot playback is
 * rendered server-side and sent through the existing Environment Bridge.
 *
 * The main ChatInterface speaker control owns global enablement. The shared
 * playback consumer additionally gates Inner Dialogue by visible UI state.
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { audit } from '../../audit.js';
import { queueTTS, type TTSQueueItem } from '../../tts/delivery-queue.js';
import {
  getSpeechOutputSettings,
  renderRobotSpeech,
  type RobotSpeechDelivery,
  type SpeechOutputSettings,
} from '../../tts/robot-speech.js';

export interface TTSOutputDelivery {
  accepted: boolean;
  deliveryId: string;
  route: 'local' | 'robot';
  reason?: string;
}

interface TTSOutputDependencies {
  getSettings: (username: string) => SpeechOutputSettings;
  queue: typeof queueTTS;
  renderRobot: (options: {
    username: string;
    text: string;
    requestId: string;
  }) => Promise<RobotSpeechDelivery>;
  createRequestId: () => string;
}

const ROBOT_SPEECH_WORKFLOW_SOURCES = new Set([
  'environment-mode',
  'boredom-autonomy',
]);

const defaultTTSOutputDependencies: TTSOutputDependencies = {
  getSettings: getSpeechOutputSettings,
  queue: queueTTS,
  renderRobot: renderRobotSpeech,
  createRequestId: () => `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
};

export async function deliverTTSOutput(
  request: {
    username: string;
    text: string;
    mode: 'conversation' | 'inner';
    source: string;
    generation?: number;
  },
  dependencyOverrides: Partial<TTSOutputDependencies> = {},
): Promise<TTSOutputDelivery> {
  const dependencies = { ...defaultTTSOutputDependencies, ...dependencyOverrides };
  const settings = dependencies.getSettings(request.username);
  const route = request.mode === 'inner' ? 'local' : settings.outputTarget;

  if (settings.speechDisabled) {
    return {
      accepted: false,
      deliveryId: '',
      route,
      reason: 'Speech is disabled by the main chat speaker control',
    };
  }

  // Inner Dialogue is a local interface surface whose audible state is gated
  // by the visible Inner view. Outward robot speech remains limited to the two
  // explicit robot execution workflows rather than becoming a general TTS path.
  if (route === 'robot') {
    if (!ROBOT_SPEECH_WORKFLOW_SOURCES.has(request.source)) {
      return {
        accepted: false,
        deliveryId: '',
        route: 'robot',
        reason: 'Robot speech is limited to robot execution workflows',
      };
    }
    if (settings.provider !== 'kokoro') {
      return {
        accepted: false,
        deliveryId: '',
        route: 'robot',
        reason: 'Robot speech currently requires Kokoro',
      };
    }

    try {
      const delivery = await dependencies.renderRobot({
        username: request.username,
        text: request.text,
        requestId: dependencies.createRequestId(),
      });
      return {
        accepted: true,
        deliveryId: delivery.actionId,
        route: 'robot',
      };
    } catch (error) {
      return {
        accepted: false,
        deliveryId: '',
        route: 'robot',
        reason: (error as Error).message,
      };
    }
  }

  const item = dependencies.queue(
    request.username,
    request.text,
    request.mode,
    request.source,
    request.generation,
  );
  return {
    accepted: Boolean(item),
    deliveryId: item?.id || '',
    route: 'local',
    reason: item ? undefined : 'TTS queue rejected the item',
  };
}

// ============================================================================
// TTS Node Definition
// ============================================================================

export const TTSNode: NodeDefinition = defineNode({
  id: 'tts',
  name: 'TTS Output',
  category: 'output',
  inputs: [
    { name: 'conversation', type: 'string', optional: true, description: 'Text to speak in conversation mode' },
    { name: 'innerDialogue', type: 'string', optional: true, description: 'Text to speak in inner dialogue mode' },
    { name: 'text', type: 'string', optional: true, description: 'Text to speak (defaults to conversation mode)' },
  ],
  outputs: [
    { name: 'queued', type: 'boolean', description: 'Whether text was accepted for TTS delivery' },
    { name: 'itemId', type: 'string', description: 'ID of the TTS queue item or robot speech action' },
    { name: 'text', type: 'string', description: 'Text accepted for TTS delivery' },
  ],
  properties: {
    source: '',
    defaultMode: 'conversation',
  },
  propertySchemas: {
    source: {
      type: 'text',
      default: '',
      label: 'Source',
      description: 'Source identifier (e.g., curiosity, dreamer, reflector)',
    },
    defaultMode: {
      type: 'select',
      default: 'conversation',
      label: 'Default Mode',
      description: 'Mode to use when text input is connected instead of specific handles',
      options: [
        { value: 'conversation', label: 'Conversation' },
        { value: 'inner', label: 'Inner Dialogue' },
      ],
    },
  },
  description: 'Delivers text through local playback or the Environment Mode robot speaker.',

  execute: async (inputs, context, properties) => {
    // Use username (human-readable) for profile path resolution, not userId (UUID)
    const username = context.username || context.userId;

    console.log('[TTS Node] Execute called:', {
      username,
      contextUsername: context.username,
      contextUserId: context.userId,
      inputKeys: Object.keys(inputs || {}),
      hasInnerDialogue: !!inputs?.innerDialogue,
      hasConversation: !!inputs?.conversation,
      hasText: !!inputs?.text,
      innerDialogueType: typeof inputs?.innerDialogue,
    });

    if (!username || username === 'anonymous') {
      console.log('[TTS Node] Skipping - no authenticated user');
      return {
        queued: false,
        reason: 'No authenticated user',
      };
    }

    // Check for conversation input
    const conversationText = inputs['conversation'] || inputs.conversation;
    const conversationStr = typeof conversationText === 'string'
      ? conversationText
      : conversationText?.response || conversationText?.question || conversationText?.content || '';

    // Check for inner dialogue input
    const innerText = inputs['innerDialogue'] || inputs.innerDialogue;
    const innerStr = typeof innerText === 'string'
      ? innerText
      : innerText?.reflection || innerText?.dream || innerText?.response || innerText?.content || '';

    // Check for generic text input (backward compatibility)
    const genericText = inputs['text'] || inputs.text || inputs[0];
    const genericStr = typeof genericText === 'string'
      ? genericText
      : genericText?.response || genericText?.content || '';

    const source = properties?.source || context.cognitiveMode || 'graph';
    const defaultMode = properties?.defaultMode || 'conversation';
    let queued = false;
    let itemId = '';
    let spokenText = '';

    console.log('[TTS Node] Parsed inputs:', {
      conversationLength: conversationStr?.length || 0,
      innerLength: innerStr?.length || 0,
      genericLength: genericStr?.length || 0,
      source,
      defaultMode,
    });

    const deliver = async (
      text: string,
      mode: 'conversation' | 'inner',
    ): Promise<TTSOutputDelivery> => {
      const delivery = await deliverTTSOutput({
        username,
        text,
        mode,
        source,
        generation: typeof context.ttsGeneration === 'number'
          ? context.ttsGeneration
          : undefined,
      });
      if (!delivery.accepted) {
        console.warn(`[TTS Node] ${delivery.route} delivery skipped: ${delivery.reason}`);
        return delivery;
      }
      audit({
        category: 'action',
        level: 'info',
        event: delivery.route === 'robot' ? 'tts_robot_dispatched' : 'tts_queued',
        actor: 'tts-node',
        details: {
          mode,
          textLength: text.length,
          source,
          itemId: delivery.deliveryId,
          route: delivery.route,
        },
        metadata: { username },
      });
      return delivery;
    };

    // A response generated for an explicit Inner compose turn remains inner
    // dialogue even when an older graph connects it to the conversation handle.
    if (context.composeTarget === 'inner' && conversationStr?.trim()) {
      const delivery = await deliver(conversationStr, 'inner');
      return {
        queued: delivery.accepted,
        itemId: delivery.deliveryId,
        text: conversationStr,
        conversationQueued: false,
        innerQueued: delivery.accepted,
      };
    }

    // Deliver conversation text
    if (conversationStr?.trim()) {
      const delivery = await deliver(conversationStr, 'conversation');
      if (delivery.accepted) {
        queued = true;
        itemId = delivery.deliveryId;
        spokenText = conversationStr;
      }
    }

    // Deliver inner dialogue text
    if (innerStr?.trim()) {
      const delivery = await deliver(innerStr, 'inner');
      if (delivery.accepted) {
        queued = true;
        itemId = delivery.deliveryId;
        spokenText = innerStr;
      }
    }

    // Deliver generic text if no specific inputs were accepted
    if (!queued && genericStr?.trim()) {
      const mode = defaultMode as 'conversation' | 'inner';
      const delivery = await deliver(genericStr, mode);
      if (delivery.accepted) {
        queued = true;
        itemId = delivery.deliveryId;
        spokenText = genericStr;
      }
    }

    return {
      queued,
      itemId,
      text: spokenText,
      conversationQueued: !!conversationStr?.trim(),
      innerQueued: !!innerStr?.trim(),
    };
  },
});
