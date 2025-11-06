import { writable } from 'svelte/store';

export const activeView = writable<string>('chat');
export const statusStore = writable(null);
export const statusRefreshTrigger = writable<number>(0); // Increment to trigger refresh

// YOLO mode store - shared between components
export const yoloModeStore = writable<boolean>(false);

// Load YOLO mode from localStorage on init
if (typeof localStorage !== 'undefined') {
  try {
    const prefs = localStorage.getItem('chatPrefs');
    if (prefs) {
      const parsed = JSON.parse(prefs);
      if (typeof parsed.yoloMode === 'boolean') {
        yoloModeStore.set(parsed.yoloMode);
      }
    }
  } catch {}
}
