import { writable } from 'svelte/store';

export const activeView = writable<string>('chat');
export const statusStore = writable(null);
export const statusRefreshTrigger = writable<number>(0); // Increment to trigger refresh
