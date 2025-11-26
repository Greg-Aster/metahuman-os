import { writable } from 'svelte/store';

/**
 * Store to track Big Brother terminal state
 */
export interface BigBrotherTerminalState {
  shouldOpen: boolean;
  port: number;
  url: string;
}

const initialState: BigBrotherTerminalState = {
  shouldOpen: false,
  port: 3099,
  url: 'http://localhost:3099'
};

export const bigBrotherTerminal = writable<BigBrotherTerminalState>(initialState);

/**
 * Request to open the Big Brother terminal
 */
export function openBigBrotherTerminal() {
  bigBrotherTerminal.set({
    shouldOpen: true,
    port: 3099,
    url: 'http://localhost:3099'
  });
}

/**
 * Mark the terminal as opened (called by TerminalManager after opening)
 */
export function bigBrotherTerminalOpened() {
  bigBrotherTerminal.update(state => ({
    ...state,
    shouldOpen: false
  }));
}

/**
 * Reset the store
 */
export function closeBigBrotherTerminal() {
  bigBrotherTerminal.set(initialState);
}
