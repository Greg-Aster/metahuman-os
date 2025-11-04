import { writable } from 'svelte/store';

export const activeView = writable<string>('chat');
