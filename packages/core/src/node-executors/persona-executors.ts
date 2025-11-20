/**
 * Persona Node Executors
 * Handles persona core, trust levels, decision rules, identity extraction, value management, and goal management
 */

import type { NodeExecutor } from './types.js';

/**
 * Persona Loader Node
 * Loads persona core configuration
 */
export const personaLoaderExecutor: NodeExecutor = async (_inputs, _context, _properties) => {
  try {
    const { loadPersonaCore } = await import('../identity.js');
    const persona = loadPersonaCore();

    return {
      success: true,
      persona,
      identity: persona.identity,
      personality: persona.personality,
      values: persona.values,
      goals: persona.goals,
    };
  } catch (error) {
    console.error('[PersonaLoader] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Persona Saver Node
 * Saves persona core configuration
 */
export const personaSaverExecutor: NodeExecutor = async (inputs, _context, _properties) => {
  const persona = inputs[0];

  if (!persona) {
    return {
      success: false,
      error: 'Persona data required',
    };
  }

  try {
    const { savePersonaCore } = await import('../identity.js');
    savePersonaCore(persona);

    return {
      success: true,
      saved: true,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[PersonaSaver] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Trust Level Reader Node
 * Gets current trust level from decision rules
 */
export const trustLevelReaderExecutor: NodeExecutor = async (_inputs, _context, _properties) => {
  try {
    const { loadDecisionRules } = await import('../identity.js');
    const rules = loadDecisionRules();

    return {
      success: true,
      trustLevel: rules.trustLevel,
      availableModes: rules.availableModes,
      description: rules.modeDescription?.[rules.trustLevel] || '',
    };
  } catch (error) {
    console.error('[TrustLevelReader] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Trust Level Writer Node
 * Sets trust level in decision rules
 */
export const trustLevelWriterExecutor: NodeExecutor = async (inputs, _context, _properties) => {
  const trustLevel = inputs[0]?.trustLevel || inputs[0];

  if (!trustLevel) {
    return {
      success: false,
      error: 'Trust level required',
    };
  }

  try {
    const { setTrustLevel } = await import('../identity.js');
    setTrustLevel(trustLevel);

    return {
      success: true,
      trustLevel,
      updated: true,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[TrustLevelWriter] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Decision Rules Loader Node
 * Loads decision rules configuration
 */
export const decisionRulesLoaderExecutor: NodeExecutor = async (_inputs, _context, _properties) => {
  try {
    const { loadDecisionRules } = await import('../identity.js');
    const rules = loadDecisionRules();

    return {
      success: true,
      rules,
      trustLevel: rules.trustLevel,
      hardRules: rules.hardRules,
      softPreferences: rules.softPreferences,
    };
  } catch (error) {
    console.error('[DecisionRulesLoader] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Decision Rules Saver Node
 * Saves decision rules configuration
 */
export const decisionRulesSaverExecutor: NodeExecutor = async (inputs, _context, _properties) => {
  const rules = inputs[0];

  if (!rules) {
    return {
      success: false,
      error: 'Decision rules required',
    };
  }

  try {
    const { saveDecisionRules } = await import('../identity.js');
    saveDecisionRules(rules);

    return {
      success: true,
      saved: true,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[DecisionRulesSaver] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Identity Extractor Node
 * Extracts specific fields from persona identity
 */
export const identityExtractorExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const field = properties?.field || 'all';
  const persona = inputs[0];

  try {
    let source = persona;

    // If no input, load persona
    if (!persona) {
      const { loadPersonaCore } = await import('../identity.js');
      source = loadPersonaCore();
    }

    if (field === 'all') {
      return {
        success: true,
        ...source.identity,
      };
    } else {
      return {
        success: true,
        field,
        value: source.identity?.[field] || null,
      };
    }
  } catch (error) {
    console.error('[IdentityExtractor] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Value Manager Node
 * Manages core values (read, add, remove)
 */
export const valueManagerExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const operation = properties?.operation || 'get'; // get, add, remove, update
  const valueData = inputs[0];

  try {
    const { loadPersonaCore, savePersonaCore } = await import('../identity.js');
    const persona = loadPersonaCore();

    switch (operation) {
      case 'get':
        return {
          success: true,
          values: persona.values.core,
          count: persona.values.core.length,
        };

      case 'add':
        if (!valueData?.value) {
          return {
            success: false,
            error: 'Value data required for add operation',
          };
        }
        persona.values.core.push(valueData);
        savePersonaCore(persona);
        return {
          success: true,
          added: true,
          values: persona.values.core,
        };

      case 'remove':
        if (valueData?.value) {
          persona.values.core = persona.values.core.filter(
            (v: any) => v.value !== valueData.value
          );
          savePersonaCore(persona);
          return {
            success: true,
            removed: true,
            values: persona.values.core,
          };
        }
        return {
          success: false,
          error: 'Value identifier required for remove operation',
        };

      case 'update':
        if (!valueData?.value) {
          return {
            success: false,
            error: 'Value data required for update operation',
          };
        }
        const index = persona.values.core.findIndex(
          (v: any) => v.value === valueData.value
        );
        if (index !== -1) {
          persona.values.core[index] = { ...persona.values.core[index], ...valueData };
          savePersonaCore(persona);
          return {
            success: true,
            updated: true,
            values: persona.values.core,
          };
        }
        return {
          success: false,
          error: 'Value not found',
        };

      default:
        return {
          success: false,
          error: `Unknown operation: ${operation}`,
        };
    }
  } catch (error) {
    console.error('[ValueManager] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

/**
 * Goal Manager Node
 * Manages goals (short-term, long-term)
 */
export const goalManagerExecutor: NodeExecutor = async (inputs, _context, properties) => {
  const operation = properties?.operation || 'get'; // get, add, remove, update
  const scope = properties?.scope || 'shortTerm'; // shortTerm, longTerm
  const goalData = inputs[0];

  try {
    const { loadPersonaCore, savePersonaCore } = await import('../identity.js');
    const persona = loadPersonaCore();
    const goals = persona.goals[scope] || [];

    switch (operation) {
      case 'get':
        return {
          success: true,
          goals,
          scope,
          count: goals.length,
        };

      case 'add':
        if (!goalData?.goal) {
          return {
            success: false,
            error: 'Goal data required for add operation',
          };
        }
        goals.push(goalData);
        persona.goals[scope] = goals;
        savePersonaCore(persona);
        return {
          success: true,
          added: true,
          goals,
        };

      case 'remove':
        if (goalData?.goal) {
          const filtered = goals.filter((g: any) => g.goal !== goalData.goal);
          persona.goals[scope] = filtered;
          savePersonaCore(persona);
          return {
            success: true,
            removed: true,
            goals: filtered,
          };
        }
        return {
          success: false,
          error: 'Goal identifier required for remove operation',
        };

      case 'update':
        if (!goalData?.goal) {
          return {
            success: false,
            error: 'Goal data required for update operation',
          };
        }
        const index = goals.findIndex((g: any) => g.goal === goalData.goal);
        if (index !== -1) {
          goals[index] = { ...goals[index], ...goalData };
          persona.goals[scope] = goals;
          savePersonaCore(persona);
          return {
            success: true,
            updated: true,
            goals,
          };
        }
        return {
          success: false,
          error: 'Goal not found',
        };

      default:
        return {
          success: false,
          error: `Unknown operation: ${operation}`,
        };
    }
  } catch (error) {
    console.error('[GoalManager] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};
