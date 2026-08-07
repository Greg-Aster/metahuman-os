/** Maintained local chat defaults shared by core runtime owners. */
export const DEFAULT_OLLAMA_CHAT_MODEL = 'qwen3.5:9b';
export const DEFAULT_VLLM_CHAT_MODEL = 'sanskar003/Qwen3.5-9B-AWQ';

/** System-owned specialist that emits the full Environment model-output contract. */
export const DEFAULT_ENVIRONMENT_ACTION_SELECTOR_MODEL = 'environment-action-selector-0.8b:v1';
export const DEFAULT_ENVIRONMENT_ACTION_SELECTOR_MODEL_ID = `ollama.${DEFAULT_ENVIRONMENT_ACTION_SELECTOR_MODEL}`;
export const LEGACY_ENVIRONMENT_ROUTER_ROLE = 'environmentRouter';

/** Maintained Qwen 3.5 training bases. */
export const DEFAULT_TRAINING_MODEL = 'unsloth/Qwen3.5-9B';
export const DEFAULT_VLLM_TRAINING_MODEL = 'Qwen/Qwen3.5-9B';
