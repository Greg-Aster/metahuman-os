import { writable } from 'svelte/store';

// Load saved active view from localStorage, default to 'chat'
const savedView = typeof localStorage !== 'undefined'
  ? localStorage.getItem('mh_active_view') || 'chat'
  : 'chat';

export const activeView = writable<string>(savedView);
export const statusStore = writable(null);
export const statusRefreshTrigger = writable<number>(0); // Increment to trigger refresh

// YOLO mode store - shared between components
export const yoloModeStore = writable<boolean>(false);

// Node editor mode toggle - when true, shows node-based visual editor instead of traditional interface
export const nodeEditorMode = writable<boolean>(false);

// Save active view to localStorage whenever it changes
if (typeof localStorage !== 'undefined') {
  activeView.subscribe(view => {
    try {
      localStorage.setItem('mh_active_view', view);
    } catch {}
  });
}

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
