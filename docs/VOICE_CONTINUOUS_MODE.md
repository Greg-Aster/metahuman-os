# Continuous Listening Mode - Voice Conversations

## Overview

MetaHuman OS now supports **continuous listening** mode for natural, hands-free voice conversations. No more button pressing - just talk naturally!

## How It Works

### Voice Activity Detection (VAD)

The system uses a lightweight, browser-based VAD algorithm that:

1. **Monitors audio volume** in real-time (50ms intervals)
2. **Detects speech** when volume exceeds threshold (15/100)
3. **Starts recording** automatically when speech begins
4. **Detects silence** when volume drops below threshold
5. **Stops recording** after 1.5 seconds of silence
6. **Processes the audio** (transcribe → LLM → TTS)
7. **Resumes listening** after AI finishes speaking

### Two Modes Available

#### 🎙️ Push-to-Talk (Default)
- Click and hold "Talk" button
- Speak your message
- Release button when done
- Good for noisy environments

#### 🔄 Continuous (Hands-Free)
- Always listening for speech
- Auto-detects when you start/stop talking
- Natural conversation flow
- Best for quiet environments

## Usage

### Starting Continuous Mode

1. Click **🎤 Voice** in ChatInterface
2. Click **Start Voice Conversation**
3. Click **🔄 Continuous** button
4. Start speaking naturally!

### How to Have a Conversation

**In Continuous Mode:**
1. Just start talking - no button needed
2. Pause when finished (1.5s silence triggers processing)
3. Wait for AI response
4. Speak again when ready
5. Repeat indefinitely!

**Example Conversation:**
```
You: "What tasks do I have today?"
[1.5s pause - auto-detected]
[Processing... Thinking...]
AI: "You have 3 active tasks: Review PR, Update docs, and Fix bug #42"
[Auto-resumes listening]

You: "Tell me more about the first one"
[1.5s pause]
[Processing... Thinking...]
AI: "The PR review is for the new authentication system..."
[Auto-resumes listening]
```

## Configuration

### Adjusting VAD Sensitivity

Edit `apps/site/src/components/VoiceInteraction.svelte`:

```typescript
// Line 27-28: VAD thresholds
const SPEECH_THRESHOLD = 15;        // Increase for less sensitivity
const SILENCE_DURATION = 1500;      // Increase for longer pauses
```

**Recommendations:**
- **Quiet room**: `SPEECH_THRESHOLD = 10-15`
- **Normal environment**: `SPEECH_THRESHOLD = 15-20`
- **Noisy environment**: `SPEECH_THRESHOLD = 25-30` (or use Push-to-Talk)

- **Fast talkers**: `SILENCE_DURATION = 1000` (1 second)
- **Normal speech**: `SILENCE_DURATION = 1500` (1.5 seconds)
- **Slow/thoughtful speech**: `SILENCE_DURATION = 2000` (2 seconds)

## Visual Feedback

### States

**Ready (Continuous Mode):**
- Blue pulsing microphone icon
- "Listening continuously..."
- "Just start speaking!"

**Listening:**
- Red microphone with pulse ring
- Volume meter shows speech level
- "Listening..."

**Processing:**
- Spinner animation
- "Thinking..."
- Transcript shown: "You: '...'"

**Speaking:**
- Sound wave animation
- "Speaking..."
- Response shown: "Me: '...'"

**Back to Listening:**
- Auto-resumes after speaking
- Blue icon reappears
- Ready for next input

## Tips for Best Results

### Do's ✅
- **Speak clearly** at normal volume
- **Pause naturally** between thoughts
- **Wait for responses** before speaking again
- **Use quiet environment** for continuous mode
- **Watch volume meter** to see if you're being heard

### Don'ts ❌
- **Don't interrupt** while AI is speaking (it won't hear you)
- **Don't speak too quietly** (adjust SPEECH_THRESHOLD if needed)
- **Avoid background noise** (TV, music, etc.)
- **Don't pause mid-sentence** (it might trigger early)
- **Don't expect instant response** (normal 4-8s latency)

## Troubleshooting

### Problem: Stops recording too early

**Solution:** Increase `SILENCE_DURATION`:
```typescript
const SILENCE_DURATION = 2000; // 2 seconds instead of 1.5
```

### Problem: Doesn't detect speech

**Solution:** Lower `SPEECH_THRESHOLD`:
```typescript
const SPEECH_THRESHOLD = 10; // More sensitive
```

**OR** check volume meter while speaking - should show green/yellow/red bars.

### Problem: Picks up background noise

**Solution:** Increase `SPEECH_THRESHOLD`:
```typescript
const SPEECH_THRESHOLD = 25; // Less sensitive
```

**OR** switch to Push-to-Talk mode.

### Problem: Doesn't resume after AI speaks

**Check:** Browser console for errors
**Fix:** Likely WebSocket disconnection - restart session

### Problem: Volume meter always maxed out

**Fix:** Microphone gain too high - adjust in system settings

## Technical Details

### VAD Algorithm

```typescript
function runVAD(currentVolume: number) {
  // Ignore during processing/speaking
  if (state === 'processing' || state === 'speaking') return;

  if (currentVolume > SPEECH_THRESHOLD) {
    // Speech detected
    if (!isSpeaking) {
      isSpeaking = true;
      startListening(); // Begin recording
    }
    clearTimeout(silenceTimeout); // Reset silence timer
  } else {
    // Silence detected
    if (isSpeaking && state === 'listening') {
      if (!silenceTimeout) {
        // Start countdown
        silenceTimeout = setTimeout(() => {
          isSpeaking = false;
          stopListening(); // Stop recording, process audio
        }, SILENCE_DURATION);
      }
    }
  }
}
```

### Execution Flow

```
1. User enables Continuous mode
2. startListening() called immediately
3. MediaRecorder starts capturing audio chunks
4. Volume meter + VAD run in parallel (50ms intervals)
5. When speech detected: clear silence timer
6. When silence detected: start 1.5s countdown
7. After 1.5s silence: stopListening() called
8. MediaRecorder.onstop → send "stop_recording" to server
9. Server processes buffered audio chunks
10. Transcription → LLM → TTS → send audio back
11. Browser plays TTS audio
12. Audio.onended → restart listening
13. Loop continues indefinitely
```

### Performance Impact

**CPU Usage:**
- VAD algorithm: ~0.1% (very lightweight)
- Volume analysis: Built-in Web Audio API
- Total overhead: Negligible

**Latency:**
- Detection time: <50ms (real-time)
- Silence detection: 1.5s (configurable)
- Processing: Same as before (4-8s)

## Comparison: Push-to-Talk vs Continuous

| Feature | Push-to-Talk | Continuous |
|---------|--------------|------------|
| Hands required | Yes (hold button) | No |
| Background noise | Immune | Affected |
| Conversation flow | Manual | Natural |
| Accuracy | Perfect timing | Good (VAD-based) |
| Best for | Noisy environments | Quiet environments |
| Latency | None (instant start) | +50ms (detection) |
| User control | Explicit | Automatic |

## Future Enhancements

Potential improvements (not yet implemented):

1. **Wake Word Detection**
   - "Hey MetaHuman" to activate
   - Requires additional ML model

2. **Barge-In Support**
   - Interrupt AI while speaking
   - Requires audio cancellation

3. **Adaptive Thresholds**
   - Auto-adjust based on environment
   - Learn from user patterns

4. **Visual Waveform**
   - Real-time speech visualization
   - Better feedback

5. **Multi-Speaker Detection**
   - Distinguish user from AI playback
   - Prevent feedback loops

## Summary

Continuous listening makes voice conversations with MetaHuman OS feel natural and effortless. The lightweight VAD algorithm runs entirely in the browser, adding minimal overhead while enabling hands-free interaction.

**Key Benefits:**
✅ Natural conversation flow
✅ Hands-free operation
✅ Auto-detects speech start/stop
✅ Configurable sensitivity
✅ Zero external dependencies
✅ Runs in browser

🎉 **Enjoy your continuous conversations!**
