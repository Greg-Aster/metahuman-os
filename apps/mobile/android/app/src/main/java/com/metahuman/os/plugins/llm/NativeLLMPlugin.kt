package com.metahuman.os.plugins.llm

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * NativeLLM Capacitor Plugin
 *
 * Provides on-device LLM inference using llama.cpp via JNI.
 * This enables offline AI capabilities for the MetaHuman mobile app.
 *
 * Key features:
 * - Model loading/unloading from device storage
 * - Text generation with streaming support
 * - Chat completion API
 * - Model download with progress tracking
 *
 * Models are stored in: {app_files}/models/
 * Supported format: GGUF (llama.cpp quantized format)
 */
@CapacitorPlugin(name = "NativeLLM")
class NativeLLMPlugin : Plugin() {

    companion object {
        private const val TAG = "NativeLLM"
        private const val MODELS_DIR = "models"

        // JNI library name (will be loaded when llama.cpp is integrated)
        private const val LLAMA_LIB = "llama"

        // Default inference parameters
        private const val DEFAULT_CONTEXT_SIZE = 2048
        private const val DEFAULT_MAX_TOKENS = 512
        private const val DEFAULT_TEMPERATURE = 0.7f
        private const val DEFAULT_TOP_P = 0.9f

        // Initialization status
        private var libraryLoaded = false
    }

    // Coroutine scope for async operations
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val mainHandler = Handler(Looper.getMainLooper())

    // Current model state
    private var currentModelPath: String? = null
    private var currentModelName: String? = null
    private var isModelLoaded = false
    private var isInferring = false
    private var shouldCancelInference = false

    // Memory tracking
    private var modelMemoryUsageMB: Int = 0

    // Native context pointer (will be used with JNI)
    private var nativeContextPtr: Long = 0

    override fun load() {
        super.load()
        Log.d(TAG, "NativeLLM plugin loaded")

        // Ensure models directory exists
        getModelsDirectory().mkdirs()

        // Try to load llama.cpp native library
        tryLoadNativeLibrary()
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        scope.cancel()

        // Unload model if loaded
        if (isModelLoaded) {
            unloadModelInternal()
        }
    }

    private fun tryLoadNativeLibrary() {
        try {
            System.loadLibrary(LLAMA_LIB)
            libraryLoaded = true
            Log.d(TAG, "llama.cpp native library loaded successfully")
        } catch (e: UnsatisfiedLinkError) {
            Log.w(TAG, "llama.cpp native library not available: ${e.message}")
            libraryLoaded = false
        }
    }

    private fun getModelsDirectory(): File {
        return File(context.filesDir, MODELS_DIR)
    }

    // =========================================================================
    // Plugin Methods
    // =========================================================================

    /**
     * Check if a model is currently loaded
     */
    @PluginMethod
    fun isModelLoaded(call: PluginCall) {
        val result = JSObject().apply {
            put("loaded", isModelLoaded)
            put("modelName", currentModelName)
            put("memoryUsageMB", modelMemoryUsageMB)
        }
        call.resolve(result)
    }

    /**
     * Load a GGUF model into memory
     *
     * @param modelPath Path to the model file (relative to models dir or absolute)
     * @param contextSize Optional context size (default 2048)
     * @param gpuLayers Optional number of GPU layers (default 0 for CPU-only)
     */
    @PluginMethod
    fun loadModel(call: PluginCall) {
        val modelPath = call.getString("modelPath")
        if (modelPath.isNullOrBlank()) {
            call.reject("modelPath is required")
            return
        }

        val contextSize = call.getInt("contextSize", DEFAULT_CONTEXT_SIZE)
        val gpuLayers = call.getInt("gpuLayers", 0)

        scope.launch {
            try {
                val startTime = System.currentTimeMillis()

                // Unload existing model if any
                if (isModelLoaded) {
                    unloadModelInternal()
                }

                // Resolve model path
                val modelFile = resolveModelPath(modelPath)
                if (!modelFile.exists()) {
                    mainHandler.post {
                        call.reject("Model file not found: ${modelFile.absolutePath}")
                    }
                    return@launch
                }

                Log.d(TAG, "Loading model: ${modelFile.absolutePath}")

                // Load model via JNI (or simulate for now)
                val success = loadModelInternal(modelFile.absolutePath, contextSize!!, gpuLayers!!)

                val loadTimeMs = System.currentTimeMillis() - startTime

                if (success) {
                    currentModelPath = modelFile.absolutePath
                    currentModelName = modelFile.nameWithoutExtension
                    isModelLoaded = true

                    // Estimate memory usage (rough: ~0.5-1GB per 1B parameters for Q4)
                    modelMemoryUsageMB = estimateModelMemory(modelFile)

                    mainHandler.post {
                        call.resolve(JSObject().apply {
                            put("success", true)
                            put("loadTimeMs", loadTimeMs)
                            put("modelName", currentModelName)
                            put("memoryUsageMB", modelMemoryUsageMB)
                        })
                    }
                } else {
                    mainHandler.post {
                        call.reject("Failed to load model")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error loading model", e)
                mainHandler.post {
                    call.reject("Error loading model: ${e.message}")
                }
            }
        }
    }

    /**
     * Unload the current model from memory
     */
    @PluginMethod
    fun unloadModel(call: PluginCall) {
        scope.launch {
            try {
                unloadModelInternal()

                mainHandler.post {
                    call.resolve(JSObject().apply {
                        put("success", true)
                    })
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error unloading model", e)
                mainHandler.post {
                    call.reject("Error unloading model: ${e.message}")
                }
            }
        }
    }

    /**
     * Generate text completion
     *
     * @param prompt The input prompt
     * @param maxTokens Maximum tokens to generate (default 512)
     * @param temperature Sampling temperature (default 0.7)
     * @param topP Top-p sampling (default 0.9)
     * @param stopSequences Optional array of stop sequences
     */
    @PluginMethod
    fun generate(call: PluginCall) {
        val prompt = call.getString("prompt")
        if (prompt.isNullOrBlank()) {
            call.reject("prompt is required")
            return
        }

        if (!isModelLoaded) {
            call.reject("No model loaded")
            return
        }

        if (isInferring) {
            call.reject("Inference already in progress")
            return
        }

        val maxTokens = call.getInt("maxTokens", DEFAULT_MAX_TOKENS)
        val temperature = call.getFloat("temperature", DEFAULT_TEMPERATURE)
        val topP = call.getFloat("topP", DEFAULT_TOP_P)
        val stopSequences = call.getArray("stopSequences")?.toList<String>() ?: emptyList()

        scope.launch {
            try {
                isInferring = true
                shouldCancelInference = false

                val startTime = System.currentTimeMillis()
                var tokensGenerated = 0

                // Generate text (JNI call or simulation)
                val result = generateInternal(
                    prompt,
                    maxTokens!!,
                    temperature!!,
                    topP!!,
                    stopSequences
                ) { token, index ->
                    // Emit token event for streaming
                    if (!shouldCancelInference) {
                        tokensGenerated = index + 1
                        notifyListeners("inferenceToken", JSObject().apply {
                            put("token", token)
                            put("tokenIndex", index)
                        })
                    }
                    !shouldCancelInference // Continue if not cancelled
                }

                val durationMs = System.currentTimeMillis() - startTime
                val tokensPerSecond = if (durationMs > 0) {
                    (tokensGenerated * 1000.0 / durationMs).toFloat()
                } else 0f

                isInferring = false

                val finishReason = when {
                    shouldCancelInference -> "cancelled"
                    result.reachedStopSequence -> "stop"
                    result.reachedMaxTokens -> "length"
                    else -> "stop"
                }

                mainHandler.post {
                    call.resolve(JSObject().apply {
                        put("text", result.text)
                        put("tokensGenerated", tokensGenerated)
                        put("tokensPerSecond", tokensPerSecond)
                        put("finishReason", finishReason)
                    })
                }
            } catch (e: Exception) {
                isInferring = false
                Log.e(TAG, "Error during generation", e)
                mainHandler.post {
                    call.reject("Error during generation: ${e.message}")
                }
            }
        }
    }

    /**
     * Generate chat completion from messages
     *
     * @param messages Array of {role, content} message objects
     * @param maxTokens Maximum tokens to generate
     * @param temperature Sampling temperature
     */
    @PluginMethod
    fun chat(call: PluginCall) {
        val messagesArray = call.getArray("messages")
        if (messagesArray == null || messagesArray.length() == 0) {
            call.reject("messages array is required")
            return
        }

        if (!isModelLoaded) {
            call.reject("No model loaded")
            return
        }

        if (isInferring) {
            call.reject("Inference already in progress")
            return
        }

        val maxTokens = call.getInt("maxTokens", DEFAULT_MAX_TOKENS)
        val temperature = call.getFloat("temperature", DEFAULT_TEMPERATURE)

        scope.launch {
            try {
                isInferring = true
                shouldCancelInference = false

                // Convert messages to chat template format
                val messages = mutableListOf<ChatMessage>()
                for (i in 0 until messagesArray.length()) {
                    val msg = messagesArray.getJSONObject(i)
                    messages.add(ChatMessage(
                        role = msg.getString("role"),
                        content = msg.getString("content")
                    ))
                }

                val prompt = formatChatPrompt(messages)
                val startTime = System.currentTimeMillis()
                var tokensGenerated = 0

                val result = generateInternal(
                    prompt,
                    maxTokens!!,
                    temperature!!,
                    DEFAULT_TOP_P,
                    listOf("<|im_end|>", "<|endoftext|>")
                ) { token, index ->
                    if (!shouldCancelInference) {
                        tokensGenerated = index + 1
                        notifyListeners("inferenceToken", JSObject().apply {
                            put("token", token)
                            put("tokenIndex", index)
                        })
                    }
                    !shouldCancelInference
                }

                val durationMs = System.currentTimeMillis() - startTime
                val tokensPerSecond = if (durationMs > 0) {
                    (tokensGenerated * 1000.0 / durationMs).toFloat()
                } else 0f

                isInferring = false

                mainHandler.post {
                    call.resolve(JSObject().apply {
                        put("response", result.text.trim())
                        put("tokensGenerated", tokensGenerated)
                        put("tokensPerSecond", tokensPerSecond)
                    })
                }
            } catch (e: Exception) {
                isInferring = false
                Log.e(TAG, "Error during chat", e)
                mainHandler.post {
                    call.reject("Error during chat: ${e.message}")
                }
            }
        }
    }

    /**
     * List available model files on device
     */
    @PluginMethod
    fun listModels(call: PluginCall) {
        val modelsDir = getModelsDirectory()
        val models = JSArray()

        modelsDir.listFiles()?.filter { it.extension == "gguf" }?.forEach { file ->
            models.put(JSObject().apply {
                put("name", file.nameWithoutExtension)
                put("path", file.absolutePath)
                put("sizeMB", file.length() / (1024 * 1024))
                put("quantization", extractQuantization(file.name))
            })
        }

        call.resolve(JSObject().apply {
            put("models", models)
        })
    }

    /**
     * Download a model from URL
     *
     * @param url URL to download from
     * @param filename Target filename
     */
    @PluginMethod
    fun downloadModel(call: PluginCall) {
        val url = call.getString("url")
        val filename = call.getString("filename")

        if (url.isNullOrBlank() || filename.isNullOrBlank()) {
            call.reject("url and filename are required")
            return
        }

        scope.launch {
            try {
                val targetFile = File(getModelsDirectory(), filename)
                Log.d(TAG, "Downloading model from $url to ${targetFile.absolutePath}")

                val connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 30000
                connection.readTimeout = 60000
                connection.connect()

                val totalBytes = connection.contentLengthLong
                var downloadedBytes = 0L

                connection.inputStream.use { input ->
                    FileOutputStream(targetFile).use { output ->
                        val buffer = ByteArray(8192)
                        var bytesRead: Int

                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            output.write(buffer, 0, bytesRead)
                            downloadedBytes += bytesRead

                            // Report progress
                            val progress = if (totalBytes > 0) {
                                (downloadedBytes * 100.0 / totalBytes).toInt()
                            } else 0

                            notifyListeners("downloadProgress", JSObject().apply {
                                put("progress", progress)
                                put("bytesDownloaded", downloadedBytes)
                                put("totalBytes", totalBytes)
                            })
                        }
                    }
                }

                mainHandler.post {
                    call.resolve(JSObject().apply {
                        put("success", true)
                        put("path", targetFile.absolutePath)
                    })
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error downloading model", e)
                mainHandler.post {
                    call.reject("Error downloading model: ${e.message}")
                }
            }
        }
    }

    /**
     * Get current inference status
     */
    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("inferring", isInferring)
            put("modelLoaded", isModelLoaded)
            put("modelName", currentModelName)
            put("memoryUsageMB", modelMemoryUsageMB)
            put("cpuUsagePercent", 0) // TODO: Implement CPU monitoring
        })
    }

    /**
     * Cancel ongoing inference
     */
    @PluginMethod
    fun cancelInference(call: PluginCall) {
        if (isInferring) {
            shouldCancelInference = true
            call.resolve(JSObject().apply {
                put("cancelled", true)
            })
        } else {
            call.resolve(JSObject().apply {
                put("cancelled", false)
            })
        }
    }

    // =========================================================================
    // Internal Methods
    // =========================================================================

    private fun resolveModelPath(path: String): File {
        val file = File(path)
        return if (file.isAbsolute) {
            file
        } else {
            File(getModelsDirectory(), path)
        }
    }

    private fun loadModelInternal(path: String, contextSize: Int, gpuLayers: Int): Boolean {
        if (!libraryLoaded) {
            // Simulate loading for development (until llama.cpp is integrated)
            Log.w(TAG, "Native library not loaded - simulating model load")
            Thread.sleep(500) // Simulate load time
            return true
        }

        // TODO: Call JNI method to load model
        // nativeContextPtr = nativeLoadModel(path, contextSize, gpuLayers)
        // return nativeContextPtr != 0L
        return true
    }

    private fun unloadModelInternal() {
        if (libraryLoaded && nativeContextPtr != 0L) {
            // TODO: Call JNI method to unload model
            // nativeUnloadModel(nativeContextPtr)
        }

        currentModelPath = null
        currentModelName = null
        isModelLoaded = false
        modelMemoryUsageMB = 0
        nativeContextPtr = 0
    }

    private fun generateInternal(
        prompt: String,
        maxTokens: Int,
        temperature: Float,
        topP: Float,
        stopSequences: List<String>,
        onToken: (String, Int) -> Boolean
    ): GenerationResult {
        if (!libraryLoaded) {
            // Simulate generation for development
            Log.w(TAG, "Native library not loaded - simulating generation")
            val simulatedResponse = "[Simulated response - llama.cpp not loaded]"
            simulatedResponse.forEachIndexed { index, char ->
                if (!onToken(char.toString(), index)) return GenerationResult(
                    text = simulatedResponse.take(index),
                    reachedStopSequence = false,
                    reachedMaxTokens = false
                )
                Thread.sleep(20) // Simulate token generation delay
            }
            return GenerationResult(
                text = simulatedResponse,
                reachedStopSequence = false,
                reachedMaxTokens = false
            )
        }

        // TODO: Call JNI method for actual generation
        // return nativeGenerate(nativeContextPtr, prompt, maxTokens, temperature, topP, stopSequences, onToken)
        return GenerationResult("", false, false)
    }

    private fun formatChatPrompt(messages: List<ChatMessage>): String {
        // Qwen3 chat template format
        val sb = StringBuilder()
        for (msg in messages) {
            sb.append("<|im_start|>${msg.role}\n${msg.content}<|im_end|>\n")
        }
        sb.append("<|im_start|>assistant\n")
        return sb.toString()
    }

    private fun estimateModelMemory(modelFile: File): Int {
        // Rough estimation based on file size
        // Q4 quantization: ~0.5-0.6 bytes per parameter
        // Plus some overhead for KV cache
        val fileSizeMB = modelFile.length() / (1024 * 1024)
        return (fileSizeMB * 1.2).toInt() // Add 20% for runtime overhead
    }

    private fun extractQuantization(filename: String): String {
        // Extract quantization from filename like "model-q4_k_m.gguf"
        val regex = Regex("(q[0-9]+[_a-zA-Z]*)")
        return regex.find(filename.lowercase())?.value ?: "unknown"
    }

    // =========================================================================
    // Data Classes
    // =========================================================================

    data class ChatMessage(
        val role: String,
        val content: String
    )

    data class GenerationResult(
        val text: String,
        val reachedStopSequence: Boolean,
        val reachedMaxTokens: Boolean
    )

    // =========================================================================
    // JNI Native Methods (to be implemented when llama.cpp is integrated)
    // =========================================================================

    // external fun nativeLoadModel(path: String, contextSize: Int, gpuLayers: Int): Long
    // external fun nativeUnloadModel(contextPtr: Long)
    // external fun nativeGenerate(
    //     contextPtr: Long,
    //     prompt: String,
    //     maxTokens: Int,
    //     temperature: Float,
    //     topP: Float,
    //     stopSequences: Array<String>,
    //     onToken: (String, Int) -> Boolean
    // ): GenerationResult
}
