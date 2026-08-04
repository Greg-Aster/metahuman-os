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
