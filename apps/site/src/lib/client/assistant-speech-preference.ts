export const CHAT_PREFS_STORAGE_KEY = 'chatPrefs';

export function assistantSpeechEnabledFromPrefs(prefs: unknown): boolean {
  return !(
    prefs
    && typeof prefs === 'object'
    && 'speechDisabled' in prefs
    && (prefs as { speechDisabled?: unknown }).speechDisabled === true
  );
}

export function readAssistantSpeechEnabled(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): boolean {
  try {
    const raw = storage.getItem(CHAT_PREFS_STORAGE_KEY);
    return raw ? assistantSpeechEnabledFromPrefs(JSON.parse(raw)) : true;
  } catch {
    return true;
  }
}

export type SpeechOutputState = 'off' | 'browser' | 'body-control';

export function speechOutputState(settings: { speechDisabled?: boolean; outputTarget?: string }): SpeechOutputState {
  return settings.speechDisabled === true ? 'off' : settings.outputTarget === 'robot' ? 'body-control' : 'browser';
}

export function nextSpeechOutputState(current: SpeechOutputState): SpeechOutputState {
  return current === 'off' ? 'browser' : current === 'browser' ? 'body-control' : 'off';
}

export function speechOutputSettings(state: SpeechOutputState): { speechDisabled: boolean; outputTarget?: 'local' | 'robot' } {
  return state === 'off' ? { speechDisabled: true } : {
    speechDisabled: false,
    outputTarget: state === 'browser' ? 'local' : 'robot',
  };
}
