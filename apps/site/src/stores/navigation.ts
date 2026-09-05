import { writable, derived } from 'svelte/store';
import {
  GRAPH_EDITOR_WORKSPACE,
  graphEditorLocation,
  isGraphEditorLocation,
} from '../lib/client/flow-editor/graph-editor-location';

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

export type DashboardSection = 'overview' | 'tasks' | 'approvals' | 'operator' | 'sleep' | 'agent-catalog' | 'trigger-manager';
export type SystemSection = 'chat' | 'settings' | 'backend' | 'security' | 'network' | 'storage' | 'addons' | 'agent-catalog' | 'trigger-manager' | 'terminal';

export const dashboardSection = writable<DashboardSection>('overview');
export const systemSection = writable<SystemSection>('settings');

export function openTriggerManagerDashboard(): void {
  dashboardSection.set('trigger-manager');
  activeView.set('dashboard');
}

export function openTriggerManagerSettings(): void {
  systemSection.set('trigger-manager');
  activeView.set('system');
}

export function openAgentCatalogDashboard(): void {
  dashboardSection.set('agent-catalog');
  activeView.set('dashboard');
}

export function openAgentCatalogSettings(): void {
  systemSection.set('agent-catalog');
  activeView.set('system');
}

// Check for bootstrap data from index.astro inline script
const bootstrapStatus = typeof window !== 'undefined'
  ? (window as any).__MH_BOOTSTRAP_STATUS__ || null
  : null;

export const statusStore = writable(bootstrapStatus);
export const statusRefreshTrigger = writable<number>(0); // Increment to trigger refresh

// Derived persona name from status store (for chat cards)
export const personaNameStore = derived(
  statusStore,
  ($status) => $status?.identity?.name || 'MetaHuman'
);

// User display name store (set by ChatLayout when user is loaded)
export const userDisplayNameStore = writable<string>('You');

// YOLO mode store - shared between components
export const yoloModeStore = writable<boolean>(false);

function createNodeEditorModeStore() {
  const globalKey = '__MH_NODE_EDITOR_MODE_STORE__';

  if (typeof window !== 'undefined' && (window as any)[globalKey]) {
    return (window as any)[globalKey];
  }

  const store = writable<boolean>(
    typeof window !== 'undefined' && isGraphEditorLocation(window.location.href),
  );

  if (typeof window !== 'undefined') {
    let syncingFromHistory = false;

    store.subscribe(enabled => {
      if (syncingFromHistory) return;
      const nextUrl = graphEditorLocation(window.location.href, enabled);
      if (nextUrl !== window.location.href) {
        window.history.replaceState(window.history.state, '', nextUrl);
      }
    });

    window.addEventListener('popstate', () => {
      syncingFromHistory = true;
      store.set(isGraphEditorLocation(window.location.href));
      syncingFromHistory = false;
    });

    (window as any)[globalKey] = store;
  }

  return store;
}

// The editor workspace is URL-scoped so separate tabs can independently show Chat and Graph Editor.
export const nodeEditorMode = createNodeEditorModeStore();

export function graphEditorHref(): string {
  if (typeof window === 'undefined') return `?workspace=${GRAPH_EDITOR_WORKSPACE}`;
  return graphEditorLocation(window.location.href, true);
}

// Right sidebar open state - shared between ChatLayout and RightSidebar
// Used to pause polling in ServerStatus when sidebar is collapsed
const savedRightSidebar = typeof localStorage !== 'undefined'
  ? localStorage.getItem('rightSidebarOpen') === 'true'
  : false;
export const rightSidebarOpen = writable<boolean>(savedRightSidebar);

// Auto-persist rightSidebarOpen to localStorage
if (typeof localStorage !== 'undefined') {
  let rightSidebarPreferenceReady = false;
  rightSidebarOpen.subscribe(open => {
    if (!rightSidebarPreferenceReady) {
      rightSidebarPreferenceReady = true;
      return;
    }
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
