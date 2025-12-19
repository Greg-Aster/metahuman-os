import { writable } from 'svelte/store';

// Views that shouldn't be restored (trigger expensive operations on mount)
const HEAVY_VIEWS = ['training'];

// URL hash-based navigation persistence - most reliable across dev server reloads
function createNavigationStore(defaultValue: string) {
  const globalKey = '__MH_ACTIVE_VIEW_STORE__';

  // Reuse existing store during HMR
  if (typeof window !== 'undefined' && (window as any)[globalKey]) {
    return (window as any)[globalKey];
  }

  // Priority: URL hash > localStorage > default
  const getInitialValue = (): string => {
    if (typeof window === 'undefined') return defaultValue;

    // Check URL hash first (e.g., #view=memory)
    const hash = window.location.hash;
    if (hash) {
      const match = hash.match(/view=([^&]+)/);
      if (match && match[1] && !HEAVY_VIEWS.includes(match[1])) {
        return match[1];
      }
    }

    // Fall back to localStorage
    try {
      const saved = localStorage.getItem('mh_active_view');
      if (saved && !HEAVY_VIEWS.includes(saved)) {
        return saved;
      }
    } catch {}

    return defaultValue;
  };

  const store = writable<string>(getInitialValue());

  if (typeof window !== 'undefined') {
    // Sync store changes to URL hash and localStorage
    store.subscribe(value => {
      // Update URL hash without triggering navigation
      const newHash = `view=${value}`;
      if (window.location.hash !== `#${newHash}`) {
        history.replaceState(null, '', `#${newHash}`);
      }
      // Also persist to localStorage as backup
      try {
        localStorage.setItem('mh_active_view', value);
      } catch {}
    });

    // Listen for browser back/forward navigation
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash;
      const match = hash.match(/view=([^&]+)/);
      if (match && match[1] && !HEAVY_VIEWS.includes(match[1])) {
        store.set(match[1]);
      }
    });

    // Cache store for HMR
    (window as any)[globalKey] = store;
  }

  return store;
}

// Navigation store with URL hash persistence - survives dev server reloads
export const activeView = createNavigationStore('chat');

// Check for bootstrap data from index.astro inline script
const bootstrapStatus = typeof window !== 'undefined'
  ? (window as any).__MH_BOOTSTRAP_STATUS__ || null
  : null;

export const statusStore = writable(bootstrapStatus);
export const statusRefreshTrigger = writable<number>(0); // Increment to trigger refresh

// YOLO mode store - shared between components
export const yoloModeStore = writable<boolean>(false);

// Node editor mode toggle - when true, shows node-based visual editor instead of traditional interface
export const nodeEditorMode = writable<boolean>(false);

// Right sidebar open state - shared between ChatLayout and RightSidebar
// Used to pause polling in ServerStatus when sidebar is collapsed
const savedRightSidebar = typeof localStorage !== 'undefined'
  ? localStorage.getItem('rightSidebarOpen') === 'true'
  : false;
export const rightSidebarOpen = writable<boolean>(savedRightSidebar);

// Auto-persist rightSidebarOpen to localStorage
if (typeof localStorage !== 'undefined') {
  rightSidebarOpen.subscribe(open => {
    try {
      localStorage.setItem('rightSidebarOpen', String(open));
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
