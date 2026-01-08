# Big Brother Terminal Discovery Fix

## Problem
The Big Brother terminal (Claude Code CLI running on port 3099) was not appearing as a tab in the MetaHuman OS terminal section. The user could see "service" and "terminal 1" tabs but not the Big Brother terminal.

## Root Cause
The terminal discovery system (`/api/terminal/list`) only looked for `ttyd` processes using `pgrep`. However, the Big Brother terminal runs using `node-pty` directly without `ttyd`, so it was never discovered by the terminal list API.

## Solution

### 1. Updated Terminal List API
Modified `/home/greggles/metahuman/apps/site/src/pages/api/terminal/list.ts` to:
- Import `bigBrotherTerminal` from `@metahuman/core`
- Check if Big Brother terminal is running using `bigBrotherTerminal.getState()`
- Add it to the terminal list with `isBigBrother: true` flag if running

### 2. Updated Terminal Manager Component
Modified `/home/greggles/metahuman/apps/site/src/components/TerminalManager.svelte` to:
- Add `isBigBrother?: boolean` to the `RunningTerminal` interface
- Check for the `isBigBrother` flag in `inferTerminalTitle()` function
- This ensures terminals marked as Big Brother get the correct title and icon

### 3. Added Terminal Tab Opening
Modified `/home/greggles/metahuman/packages/core/src/big-brother-terminal.ts` to:
- Added `openBigBrotherTab()` function that emits an 'open_tab' event
- This event is listened to by the TerminalManager component to automatically open/focus the tab

### 4. Updated Claude Code Backend
Modified `/home/greggles/metahuman/packages/core/src/backends/claude-code-backend.ts` to:
- Import and call `openBigBrotherTab()` when starting the terminal
- Call `openBigBrotherTab()` when executing prompts to ensure visibility

## How It Works Now

1. When Big Brother terminal is started (either manually or through Claude Code backend), it runs on port 3099
2. The terminal list API now checks for both `ttyd` processes AND the Big Brother terminal singleton
3. If Big Brother is running, it's included in the terminal list with a special flag
4. The TerminalManager component recognizes this flag and creates a "🤖 Big Brother" tab
5. When the backend needs to execute a prompt, it calls `openBigBrotherTab()` to ensure the tab is visible

## Testing

Created a test script at `/home/greggles/metahuman/scripts/test-big-brother-discovery.ts` to verify:
- Big Brother terminal can be started
- Terminal list API correctly returns the Big Brother terminal
- Tab opening events are properly emitted

## Usage

The Big Brother terminal should now automatically appear in the terminal tabs when:
1. Claude Code backend is started via Settings
2. Active Operator escalates to Big Brother
3. Any code uses the Claude Code backend for execution

The terminal tab will show "🤖 Big Brother" and connect to the WebSocket server at `http://localhost:3099`.