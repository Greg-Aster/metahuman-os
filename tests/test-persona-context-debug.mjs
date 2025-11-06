#!/usr/bin/env node
/**
 * Debug test to see what persona context is being generated
 */

import { loadPersonaCore } from './packages/core/dist/identity.js';

function buildPersonaContext() {
  try {
    const persona = loadPersonaCore();

    console.log('=== Persona Data ===');
    console.log('Identity:', JSON.stringify(persona.identity, null, 2));
    console.log('\nValues:', JSON.stringify(persona.values, null, 2));
    console.log('\nGoals:', JSON.stringify(persona.goals, null, 2));

    // Build a concise summary of identity, values, and goals
    const parts = [];

    // Identity
    parts.push(`You are ${persona.identity.name}, ${persona.identity.role}.`);
    parts.push(persona.identity.purpose);

    // Core values (top 3)
    if (persona.values?.core && Array.isArray(persona.values.core)) {
      const topValues = persona.values.core.slice(0, 3);
      const valueNames = topValues.map((v) => v.value || v).filter(Boolean);
      if (valueNames.length > 0) {
        parts.push(`\nCore values: ${valueNames.join(', ')}.`);
      }
    }

    // Short-term goals
    if (persona.goals?.shortTerm && Array.isArray(persona.goals.shortTerm)) {
      parts.push(`\nCurrent goals:`);
      persona.goals.shortTerm.forEach((goal) => {
        const goalText = goal.goal || goal;
        parts.push(`- ${goalText}`);
      });
    }

    // Long-term goals (just titles or descriptions)
    if (persona.goals?.longTerm && Array.isArray(persona.goals.longTerm)) {
      const aspirations = persona.goals.longTerm
        .map((g) => g.goal || g.title || g.description || g)
        .filter(Boolean);
      if (aspirations.length > 0) {
        parts.push(`\nLong-term goals: ${aspirations.slice(0, 3).join(', ')}.`);
      }
    }

    // Communication style hints
    if (persona.personality?.communicationStyle?.tone) {
      const tone = Array.isArray(persona.personality.communicationStyle.tone)
        ? persona.personality.communicationStyle.tone.join(', ')
        : persona.personality.communicationStyle.tone;
      parts.push(`\nCommunication style: ${tone}.`);
    }

    console.log('\n=== Generated Persona Context ===');
    console.log(parts.join('\n'));

    return parts.join('\n');
  } catch (error) {
    console.error('Failed to load persona context:', error);
    return '';
  }
}

buildPersonaContext();
