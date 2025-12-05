package com.metahuman.os.plugins.voice

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import android.view.KeyEvent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.metahuman.os.receivers.MediaButtonReceiver
import com.metahuman.os.MainActivity
import java.util.Locale
import java.util.UUID

@CapacitorPlugin(name = "NativeVoice")
class NativeVoicePlugin : Plugin() {

    companion object {
        private const val TAG = "NativeVoice"
        private const val DOUBLE_CLICK_TIMEOUT = 400L // ms between clicks for double-click
        private const val LONG_PRESS_TIMEOUT = 600L // ms to consider a long press
    }

    private var speechRecognizer: SpeechRecognizer? = null
    private var textToSpeech: TextToSpeech? = null
    private var ttsReady = false
    private var currentSttCall: PluginCall? = null
    private var currentTtsCall: PluginCall? = null

    // Media button handling
    private var mediaSession: MediaSessionCompat? = null
    private var hardwareButtonsEnabled = false
    private var lastClickTime: Long = 0
    private var clickCount = 0
    private val handler = Handler(Looper.getMainLooper())
    private var pendingClickRunnable: Runnable? = null

    // Silent audio player - THIS IS KEY: we need to actually "play" something
    // so Android sees us as the active media source and routes buttons to us
    private var silentPlayer: MediaPlayer? = null
    private var audioFocusRequest: android.media.AudioFocusRequest? = null

    override fun load() {
        super.load()
        Log.d(TAG, "NativeVoice plugin loaded")
        initializeTTS()
        initializeMediaSession()
    }

    private fun initializeMediaSession() {
        try {
            mediaSession = MediaSessionCompat(context, "MetaHumanVoice").apply {
                // Set flags to handle media buttons
                setFlags(
                    MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
                )

                // Set playback state to receive button events
                setPlaybackState(
                    PlaybackStateCompat.Builder()
                        .setActions(
                            PlaybackStateCompat.ACTION_PLAY or
                            PlaybackStateCompat.ACTION_PAUSE or
                            PlaybackStateCompat.ACTION_PLAY_PAUSE
                        )
                        .setState(PlaybackStateCompat.STATE_PAUSED, 0, 1f)
                        .build()
                )

                // Handle media button callbacks
                setCallback(object : MediaSessionCompat.Callback() {
                    override fun onMediaButtonEvent(mediaButtonEvent: Intent?): Boolean {
                        val keyEvent = mediaButtonEvent?.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
                        if (keyEvent != null && hardwareButtonsEnabled) {
                            return handleMediaButtonEvent(keyEvent)
                        }
                        return super.onMediaButtonEvent(mediaButtonEvent)
                    }

                    override fun onPlay() {
                        Log.d(TAG, "MediaSession onPlay")
                        if (hardwareButtonsEnabled) {
                            emitButtonEvent("play")
                        }
                    }

                    override fun onPause() {
                        Log.d(TAG, "MediaSession onPause")
                        if (hardwareButtonsEnabled) {
                            emitButtonEvent("pause")
                        }
                    }
                })
            }
            Log.d(TAG, "MediaSession initialized")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize MediaSession", e)
        }
    }

    private fun handleMediaButtonEvent(keyEvent: KeyEvent): Boolean {
        val keyCode = keyEvent.keyCode
        val action = keyEvent.action

        Log.d(TAG, "Media button: keyCode=$keyCode, action=$action")

        // We only care about these key codes for headphone buttons
        if (keyCode != KeyEvent.KEYCODE_HEADSETHOOK &&
            keyCode != KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE &&
            keyCode != KeyEvent.KEYCODE_MEDIA_PLAY &&
            keyCode != KeyEvent.KEYCODE_MEDIA_PAUSE) {
            return false
        }

        when (action) {
            KeyEvent.ACTION_DOWN -> {
                // Track timing for long press detection
                lastClickTime = System.currentTimeMillis()
            }
            KeyEvent.ACTION_UP -> {
                val pressDuration = System.currentTimeMillis() - lastClickTime

                // Cancel any pending click processing
                pendingClickRunnable?.let { handler.removeCallbacks(it) }

                if (pressDuration >= LONG_PRESS_TIMEOUT) {
                    // Long press detected
                    Log.d(TAG, "Long press detected (${pressDuration}ms)")
                    clickCount = 0
                    emitButtonEvent("longPress")
                } else {
                    // Short press - could be single or start of double click
                    clickCount++

                    pendingClickRunnable = Runnable {
                        when (clickCount) {
                            1 -> {
                                Log.d(TAG, "Single click detected")
                                emitButtonEvent("singleClick")
                            }
                            2 -> {
                                Log.d(TAG, "Double click detected")
                                emitButtonEvent("doubleClick")
                            }
                            else -> {
                                Log.d(TAG, "Multi click detected: $clickCount")
                                emitButtonEvent("multiClick", clickCount)
                            }
                        }
                        clickCount = 0
                    }

                    handler.postDelayed(pendingClickRunnable!!, DOUBLE_CLICK_TIMEOUT)
                }
            }
        }

        return true // We handled the event
    }

    private fun emitButtonEvent(eventType: String, clickCount: Int = 1) {
        val data = JSObject().apply {
            put("type", eventType)
            put("clickCount", clickCount)
            put("timestamp", System.currentTimeMillis())
        }
        Log.d(TAG, "Emitting hardware button event: $eventType")
        notifyListeners("hardwareButton", data)
    }

    @PluginMethod
    fun enableHardwareButtons(call: PluginCall) {
        Log.d(TAG, "=== ENABLING HARDWARE BUTTONS (MUSIC PLAYER MODE) ===")
        hardwareButtonsEnabled = true

        // STEP 1: Request audio focus like a music player
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            audioFocusRequest = android.media.AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(audioAttributes)
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener { focusChange ->
                    Log.d(TAG, "Audio focus changed: $focusChange")
                }
                .build()
            val result = audioManager.requestAudioFocus(audioFocusRequest!!)
            Log.d(TAG, "Audio focus request result: $result (SUCCESS=${AudioManager.AUDIOFOCUS_REQUEST_GRANTED})")
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                null,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            )
        }

        // STEP 2: Create and start a silent MediaPlayer - THIS MAKES US THE "NOW PLAYING" APP
        try {
            silentPlayer?.release()
            silentPlayer = MediaPlayer().apply {
                // Create a "null" audio source - we'll generate silence programmatically
                setAudioAttributes(audioAttributes)

                // Use a data source that produces silence
                // We'll set up the media session as if we're playing
                setVolume(0f, 0f)  // Silent

                // We don't actually need to play anything - just having the player
                // and the MediaSession in PLAYING state is enough
            }
            Log.d(TAG, "Silent player created")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to create silent player: ${e.message}")
        }

        // STEP 3: Set MediaSession to PLAYING state - THIS IS CRITICAL
        // Android routes media buttons to the session that is "playing"
        mediaSession?.apply {
            isActive = true
            setPlaybackState(
                PlaybackStateCompat.Builder()
                    .setActions(
                        PlaybackStateCompat.ACTION_PLAY or
                        PlaybackStateCompat.ACTION_PAUSE or
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or
                        PlaybackStateCompat.ACTION_STOP
                    )
                    .setState(
                        PlaybackStateCompat.STATE_PLAYING,  // PLAYING, not PAUSED!
                        0,
                        1f
                    )
                    .build()
            )
            Log.d(TAG, "MediaSession set to PLAYING state")
        }

        // STEP 4: Register with MainActivity for direct key capture
        MainActivity.keyEventCallback = MainActivity.KeyEventCallback { event ->
            Log.d(TAG, "MainActivity forwarded key event: ${event.keyCode}")
            handleMediaButtonEvent(event)
        }

        // STEP 5: Register with broadcast receiver as fallback
        MediaButtonReceiver.onMediaButtonEvent = { keyEvent ->
            handleMediaButtonEvent(keyEvent)
        }

        // STEP 6: Set media button receiver for the MediaSession
        val mediaButtonReceiver = ComponentName(context, MediaButtonReceiver::class.java)
        mediaSession?.setMediaButtonReceiver(
            android.app.PendingIntent.getBroadcast(
                context,
                0,
                Intent(Intent.ACTION_MEDIA_BUTTON).setComponent(mediaButtonReceiver),
                android.app.PendingIntent.FLAG_IMMUTABLE
            )
        )

        Log.d(TAG, "=== HARDWARE BUTTONS ENABLED - MUSIC PLAYER MODE ACTIVE ===")
        Log.d(TAG, "MediaSession is now the 'Now Playing' source - wired headphone buttons should work")

        val result = JSObject()
        result.put("enabled", true)
        call.resolve(result)
    }

    @PluginMethod
    fun disableHardwareButtons(call: PluginCall) {
        Log.d(TAG, "=== DISABLING HARDWARE BUTTONS ===")
        hardwareButtonsEnabled = false

        // Release silent player
        silentPlayer?.release()
        silentPlayer = null

        // Set MediaSession back to PAUSED/STOPPED
        mediaSession?.apply {
            setPlaybackState(
                PlaybackStateCompat.Builder()
                    .setState(PlaybackStateCompat.STATE_STOPPED, 0, 0f)
                    .build()
            )
            isActive = false
            setMediaButtonReceiver(null)
        }

        // Clear callbacks
        MainActivity.keyEventCallback = null
        MediaButtonReceiver.onMediaButtonEvent = null

        // Release audio focus properly
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest!!)
            audioFocusRequest = null
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(null)
        }

        Log.d(TAG, "=== HARDWARE BUTTONS DISABLED ===")
        call.resolve(JSObject().put("enabled", false))
    }

    @PluginMethod
    fun isHardwareButtonsEnabled(call: PluginCall) {
        call.resolve(JSObject().put("enabled", hardwareButtonsEnabled))
    }

    private fun initializeTTS() {
        textToSpeech = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val result = textToSpeech?.setLanguage(Locale.US)
                ttsReady = result != TextToSpeech.LANG_MISSING_DATA &&
                          result != TextToSpeech.LANG_NOT_SUPPORTED
                Log.d(TAG, "TTS initialized: ready=$ttsReady")

                // Set up progress listener
                textToSpeech?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {
                        Log.d(TAG, "TTS started: $utteranceId")
                        notifyListeners("ttsStart", JSObject().put("utteranceId", utteranceId))
                    }

                    override fun onDone(utteranceId: String?) {
                        Log.d(TAG, "TTS done: $utteranceId")
                        notifyListeners("ttsEnd", JSObject().put("utteranceId", utteranceId))
                        currentTtsCall?.resolve(JSObject().put("success", true))
                        currentTtsCall = null
                    }

                    override fun onError(utteranceId: String?) {
                        Log.e(TAG, "TTS error: $utteranceId")
                        notifyListeners("ttsError", JSObject().put("utteranceId", utteranceId))
                        currentTtsCall?.reject("TTS error")
                        currentTtsCall = null
                    }
                })
            } else {
                Log.e(TAG, "TTS initialization failed: $status")
                ttsReady = false
            }
        }
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val sttAvailable = SpeechRecognizer.isRecognitionAvailable(context)
        val result = JSObject()
        result.put("stt", sttAvailable)
        result.put("tts", ttsReady)
        Log.d(TAG, "isAvailable: stt=$sttAvailable, tts=$ttsReady")
        call.resolve(result)
    }

    @PluginMethod
    fun startListening(call: PluginCall) {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            call.reject("Speech recognition not available on this device")
            return
        }

        currentSttCall = call

        activity?.runOnUiThread {
            try {
                // Clean up any existing recognizer
                speechRecognizer?.destroy()

                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context)
                speechRecognizer?.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {
                        Log.d(TAG, "STT ready for speech")
                        notifyListeners("sttReady", JSObject())
                    }

                    override fun onBeginningOfSpeech() {
                        Log.d(TAG, "STT speech started")
                        notifyListeners("sttStart", JSObject())
                    }

                    override fun onRmsChanged(rmsdB: Float) {
                        // Volume level - can use for visualization
                        notifyListeners("sttVolume", JSObject().put("volume", rmsdB))
                    }

                    override fun onBufferReceived(buffer: ByteArray?) {}

                    override fun onEndOfSpeech() {
                        Log.d(TAG, "STT speech ended")
                        notifyListeners("sttEnd", JSObject())
                    }

                    override fun onError(error: Int) {
                        val errorMsg = when (error) {
                            SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
                            SpeechRecognizer.ERROR_CLIENT -> "Client side error"
                            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Insufficient permissions"
                            SpeechRecognizer.ERROR_NETWORK -> "Network error"
                            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
                            SpeechRecognizer.ERROR_NO_MATCH -> "No speech detected"
                            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognition service busy"
                            SpeechRecognizer.ERROR_SERVER -> "Server error"
                            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech input"
                            else -> "Unknown error: $error"
                        }
                        Log.e(TAG, "STT error: $errorMsg")
                        notifyListeners("sttError", JSObject().put("error", errorMsg).put("code", error))
                        currentSttCall?.reject(errorMsg)
                        currentSttCall = null
                    }

                    override fun onResults(results: Bundle?) {
                        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val transcript = matches?.firstOrNull() ?: ""
                        val confidence = results?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)?.firstOrNull() ?: 0f

                        Log.d(TAG, "STT result: $transcript (confidence: $confidence)")

                        val result = JSObject()
                        result.put("transcript", transcript)
                        result.put("confidence", confidence)
                        result.put("isFinal", true)

                        notifyListeners("sttResult", result)
                        currentSttCall?.resolve(result)
                        currentSttCall = null
                    }

                    override fun onPartialResults(partialResults: Bundle?) {
                        val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val transcript = matches?.firstOrNull() ?: ""

                        Log.d(TAG, "STT partial: $transcript")

                        val result = JSObject()
                        result.put("transcript", transcript)
                        result.put("isFinal", false)

                        notifyListeners("sttPartialResult", result)
                    }

                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })

                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "en-US"))
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                }

                speechRecognizer?.startListening(intent)
                Log.d(TAG, "STT listening started")

            } catch (e: Exception) {
                Log.e(TAG, "Failed to start STT", e)
                call.reject("Failed to start speech recognition: ${e.message}")
                currentSttCall = null
            }
        }
    }

    @PluginMethod
    fun stopListening(call: PluginCall) {
        activity?.runOnUiThread {
            try {
                speechRecognizer?.stopListening()
                Log.d(TAG, "STT stopped")
                call.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to stop STT", e)
                call.reject("Failed to stop: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun cancelListening(call: PluginCall) {
        activity?.runOnUiThread {
            try {
                speechRecognizer?.cancel()
                speechRecognizer?.destroy()
                speechRecognizer = null
                currentSttCall = null
                Log.d(TAG, "STT cancelled")
                call.resolve()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to cancel STT", e)
                call.reject("Failed to cancel: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun speak(call: PluginCall) {
        val text = call.getString("text")
        if (text.isNullOrEmpty()) {
            call.reject("Text is required")
            return
        }

        if (!ttsReady) {
            call.reject("TTS not ready")
            return
        }

        currentTtsCall = call
        val utteranceId = UUID.randomUUID().toString()

        val pitch = call.getFloat("pitch", 1.0f) ?: 1.0f
        val rate = call.getFloat("rate", 1.0f) ?: 1.0f

        textToSpeech?.setPitch(pitch)
        textToSpeech?.setSpeechRate(rate)

        val result = textToSpeech?.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId)

        if (result != TextToSpeech.SUCCESS) {
            Log.e(TAG, "TTS speak failed: $result")
            call.reject("Failed to speak")
            currentTtsCall = null
        } else {
            Log.d(TAG, "TTS speaking: $text")
        }
    }

    @PluginMethod
    fun stopSpeaking(call: PluginCall) {
        textToSpeech?.stop()
        currentTtsCall = null
        Log.d(TAG, "TTS stopped")
        call.resolve()
    }

    @PluginMethod
    fun getVoices(call: PluginCall) {
        if (!ttsReady) {
            call.reject("TTS not ready")
            return
        }

        val voices = textToSpeech?.voices?.map { voice ->
            JSObject().apply {
                put("name", voice.name)
                put("locale", voice.locale.toString())
                put("quality", voice.quality)
                put("isNetworkConnectionRequired", voice.isNetworkConnectionRequired)
            }
        } ?: emptyList()

        val result = JSObject()
        result.put("voices", voices)
        call.resolve(result)
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        speechRecognizer?.destroy()
        speechRecognizer = null
        textToSpeech?.shutdown()
        textToSpeech = null
        silentPlayer?.release()
        silentPlayer = null
        mediaSession?.release()
        mediaSession = null
        // Clear all callbacks
        MainActivity.keyEventCallback = null
        MediaButtonReceiver.onMediaButtonEvent = null
        pendingClickRunnable?.let { handler.removeCallbacks(it) }
        Log.d(TAG, "Plugin destroyed - all resources released")
    }
}
