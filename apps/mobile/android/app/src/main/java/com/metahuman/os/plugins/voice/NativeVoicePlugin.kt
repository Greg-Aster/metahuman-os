package com.metahuman.os.plugins.voice

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.Locale
import java.util.UUID

@CapacitorPlugin(name = "NativeVoice")
class NativeVoicePlugin : Plugin() {

    companion object {
        private const val TAG = "NativeVoice"
    }

    private var speechRecognizer: SpeechRecognizer? = null
    private var textToSpeech: TextToSpeech? = null
    private var ttsReady = false
    private var currentSttCall: PluginCall? = null
    private var currentTtsCall: PluginCall? = null

    override fun load() {
        super.load()
        Log.d(TAG, "NativeVoice plugin loaded")
        initializeTTS()
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
        Log.d(TAG, "Plugin destroyed")
    }
}
