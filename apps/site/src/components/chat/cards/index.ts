/**
 * Card Components Barrel Export
 * Re-exports all message card components for easy importing
 */

export { default as BaseMessageCard } from './BaseMessageCard.svelte';
export { default as UserMessageCard } from './UserMessageCard.svelte';
export { default as AssistantMessageCard } from './AssistantMessageCard.svelte';
export { default as ReflectionCard } from './ReflectionCard.svelte';
export { default as LizardBrainCard } from './LizardBrainCard.svelte';
export { default as AgencyCard } from './AgencyCard.svelte';
export { default as DreamCard } from './DreamCard.svelte';
export { default as CuriosityCard } from './CuriosityCard.svelte';
export { default as ReasoningCard } from './ReasoningCard.svelte';
export { default as SystemMessageCard } from './SystemMessageCard.svelte';

// Component map for dynamic rendering
import UserMessageCard from './UserMessageCard.svelte';
import AssistantMessageCard from './AssistantMessageCard.svelte';
import ReflectionCard from './ReflectionCard.svelte';
import LizardBrainCard from './LizardBrainCard.svelte';
import AgencyCard from './AgencyCard.svelte';
import DreamCard from './DreamCard.svelte';
import CuriosityCard from './CuriosityCard.svelte';
import ReasoningCard from './ReasoningCard.svelte';
import SystemMessageCard from './SystemMessageCard.svelte';

import type { CardComponent } from '../card-types';
import type { SvelteComponent } from 'svelte';

export const cardComponents: Record<CardComponent, typeof SvelteComponent> = {
  UserMessageCard,
  AssistantMessageCard,
  ReflectionCard,
  LizardBrainCard,
  AgencyCard,
  DreamCard,
  CuriosityCard,
  ReasoningCard,
  SystemMessageCard,
};
