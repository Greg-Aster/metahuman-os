/**
 * Message Discriminator
 * Maps message metadata to appropriate card component
 */

import type { ChatMessage } from '../../lib/client/composables/useMessages';
import type { CardComponent, GoalLabelConfig } from './card-types';

/**
 * Determines which card component to render for a given message.
 * Priority order matters - more specific matches come first.
 */
export function getCardComponent(message: ChatMessage): CardComponent {
  const { role, meta } = message;

  // Reasoning messages always use ReasoningCard
  if (role === 'reasoning') {
    return 'ReasoningCard';
  }

  // Dream messages
  if (role === 'dream') {
    return 'DreamCard';
  }

  // Reflection messages - check dialogueSource for specificity
  if (role === 'reflection') {
    if (meta?.dialogueSource === 'lizard-brain') {
      return 'LizardBrainCard';
    }
    if (meta?.dialogueSource === 'agency-system') {
      return 'AgencyCard';
    }
    // Default reflection (idle thoughts, general inner dialogue)
    return 'ReflectionCard';
  }

  // Assistant messages with special types
  if (role === 'assistant') {
    if (meta?.isCuriosityQuestion) {
      return 'CuriosityCard';
    }
    return 'AssistantMessageCard';
  }

  // User messages
  if (role === 'user') {
    return 'UserMessageCard';
  }

  // System messages - check dialogueSource for special handling
  if (role === 'system') {
    if (meta?.dialogueSource === 'lizard-brain') {
      return 'LizardBrainCard';
    }
    if (meta?.dialogueSource === 'agency-system') {
      return 'AgencyCard';
    }
    return 'SystemMessageCard';
  }

  // Fallback
  return 'AssistantMessageCard';
}

/**
 * Check if a card needs interactive features (approval buttons, etc.)
 */
export function needsInteractiveFeatures(message: ChatMessage): boolean {
  return message.meta?.type === 'approval_request' && !!message.meta?.desireId;
}

/**
 * Check if message should be visible in current mode
 */
export function isVisibleInMode(
  message: ChatMessage,
  mode: 'conversation' | 'inner' | 'combined',
  showSystemMessages: boolean = false
): boolean {
  if (mode === 'combined') return true;

  const { role } = message;
  const isInnerContent = role === 'reflection' || role === 'dream' || role === 'reasoning';

  if (mode === 'inner') {
    return isInnerContent || (showSystemMessages && role === 'system');
  }

  // conversation mode
  return !isInnerContent;
}

/**
 * Get goal label configuration based on message type
 */
export function getGoalLabelConfig(type?: string): GoalLabelConfig {
  switch (type) {
    case 'approval_request':
      return { label: 'Goal (Awaiting Approval)', cssClass: 'goal-approval', icon: '🎯' };
    case 'desire_plan_complete':
    case 'plan_generated':
      return { label: 'Goal Plan', cssClass: 'goal-planned', icon: '🎯' };
    case 'desire_planning_start':
    case 'task_start':
      return { label: 'Planning Goal', cssClass: 'goal-planning', icon: '🎯' };
    case 'desire_approved':
      return { label: 'Goal Approved', cssClass: 'goal-approved', icon: '🎯' };
    case 'desire_executing':
      return { label: 'Goal Executing', cssClass: 'goal-executing', icon: '🎯' };
    default:
      return { label: 'Agency', cssClass: 'goal-default', icon: '📋' };
  }
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Parse think blocks from assistant messages
 */
export function parseThinkBlocks(content: string): { thinking: string; response: string } {
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    const thinking = thinkMatch[1].trim();
    const response = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    return { thinking, response };
  }
  return { thinking: '', response: content };
}
