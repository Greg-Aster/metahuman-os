/**
 * Card System Type Definitions
 * Shared interfaces for message card components
 */

import type { ChatMessage } from '../../lib/client/composables/useMessages';

// Card component identifiers
export type CardComponent =
  | 'UserMessageCard'
  | 'AssistantMessageCard'
  | 'ReflectionCard'
  | 'OperatorProposalCard'
  | 'AgencyCard'
  | 'DreamCard'
  | 'CuriosityCard'
  | 'ReasoningCard'
  | 'SystemMessageCard';

// Base props all cards receive
export interface BaseCardProps {
  message: ChatMessage;
  index: number;
  isSelected: boolean;
  mode: 'conversation' | 'inner' | 'combined';
}

// Events that cards can emit
export interface CardEvents {
  messageClick: { message: ChatMessage; index: number };
  deleteMessage: { relPath: string };
  validateMessage: { relPath: string; status: 'correct' | 'incorrect' };
  speakMessage: { content: string };
}

// Agency-specific events (extends base events)
export interface AgencyCardEvents extends CardEvents {
  desireApproved: { desireId: string };
  desireRejected: { desireId: string };
  desireFeedback: { desireId: string; feedback: string };
}

// Goal label configuration by type
export interface GoalLabelConfig {
  label: string;
  cssClass: string;
  icon: string;
}

// Card styling configuration
export interface CardStyleConfig {
  bgColor: string;
  borderColor: string;
  accentColor: string;
}
