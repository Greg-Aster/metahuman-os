# Hardware Button (Earbud) Debugging Notes

**Status**: Work in Progress - Paused
**Date**: 2025-12-03
**Issue**: Earbud buttons only work once, then Google captures subsequent presses

## Problem Summary

After the first successful voice recording via earbud:
1. First earbud press → Recording starts ✅
2. Silence detection → Recording stops, audio sent ✅
3. TTS response plays (via Web Audio API) ✅
4. Reactivation completes ✅
5. Second earbud press → **Google Assistant intercepts** ❌

## What We Tried

### 1. Web Audio API for TTS (Implemented)
**File**: `apps/site/src/lib/client/composables/useTTS.ts`

Changed TTS playback from `new Audio()` to Web Audio API (`AudioBufferSourceNode`):
- `new Audio()` claims the media session and steals it from our silent audio
- `AudioBufferSourceNode` plays audio WITHOUT claiming media session

**Result**: TTS no longer steals session during playback, but Google still intercepts after.

### 2. Full Reset After TTS (Reverted)
Tried completely destroying and recreating the audio element after TTS:
- Clear all handlers
- Destroy audio element
- Create new Audio()
- Re-register handlers

**Result**: Failed because new Audio() created outside user gesture loses media session priority on mobile. Google intercepts.

### 3. Keep Original Audio Element (Current)
**File**: `apps/site/src/lib/client/composables/useMicrophone.ts`

Keep the original audio element that was created from user gesture:
- Just restart it with `.currentTime = 0; .play()`
- Re-register handlers in case they were overwritten

**Result**: Still doesn't work. Google intercepts second button press.

## Debug State Flow (Observed)

```
⏸️ PAUSED (ready)      - Initial setup from user gesture (tap mic button)
▶️ PLAY (recording)    - First earbud press triggers our handler
⏸️ PAUSED (silence)    - VAD detected silence, recording sent
[TTS plays via Web Audio API]
🔄 REACTIVATING...     - TTS finished, reactivating session
⏸️ PAUSED (reactivated) - Our code thinks it succeeded
[Second earbud press]  - Goes to Google, not our handler
```

## Key Insight: User Gesture Context

Mobile browsers are strict about media session priority. Audio elements created from user gestures get higher priority than those created programmatically.

The original audio is created when user taps mic button (user gesture). But something is happening that causes Chrome to decide Google Assistant should have priority over our session.

## Hypotheses to Explore

1. **TTS AudioContext is interfering**: Even though we use Web Audio API, creating/resuming an AudioContext might affect media session ownership

2. **Chrome's "meaningful playback" heuristic**: Chrome may detect our audio is silent/near-silent and deprioritize it

3. **Media Session API state machine**: There might be a required sequence of playbackState changes that we're not following

4. **Timing issue**: The 200ms delay before reactivation might be too short or too long

5. **Handler registration**: Chrome might require handlers to be registered BEFORE the audio plays, not after

## Files Modified

- `apps/site/src/lib/client/composables/useMicrophone.ts` - Media Session implementation
- `apps/site/src/lib/client/composables/useTTS.ts` - Web Audio API for TTS
- `apps/site/src/components/ChatInterface.svelte` - TTS finished reactive statement
- `apps/site/src/components/chat/InputArea.svelte` - Debug state display (removed)
- `docs/user-guide/advanced-features/23-voice-system.md` - Documentation

## Things NOT Tried Yet

1. **Louder/longer audio**: Use actual audible audio instead of near-silent
2. **Different audio format**: Try MP3 instead of WAV
3. **Continuous playback**: Never pause the silent audio, keep it looping
4. **Native app approach**: This might simply not be possible in a web browser
5. **Service Worker**: Register media session from a service worker
6. **Different playbackState flow**: Try staying in "playing" state always

## References

- [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API)
- [Chrome Media Session Spec](https://web.dev/media-session/)
- [User Activation requirements](https://developer.mozilla.org/en-US/docs/Web/Security/User_activation)

## To Resume

1. Read this document
2. Check if Chrome has updated Media Session behavior
3. Consider testing on different devices/browsers
4. Explore the "things not tried" list above
