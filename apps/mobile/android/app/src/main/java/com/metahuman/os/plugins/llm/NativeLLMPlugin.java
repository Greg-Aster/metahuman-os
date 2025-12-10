package com.metahuman.os.plugins.llm;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native LLM Plugin (Stub)
 *
 * Placeholder for on-device LLM inference.
 * TODO: Implement llama.cpp or similar for local inference.
 */
@CapacitorPlugin(name = "NativeLLM")
public class NativeLLMPlugin extends Plugin {

    private static final String TAG = "NativeLLM";

    @Override
    public void load() {
        Log.d(TAG, "NativeLLM plugin loaded (stub)");
    }

    @PluginMethod
    public void loadModel(PluginCall call) {
        Log.d(TAG, "loadModel called (not implemented)");
        call.reject("Not implemented - use cloud LLM or server connection");
    }

    @PluginMethod
    public void generate(PluginCall call) {
        Log.d(TAG, "generate called (not implemented)");
        call.reject("Not implemented - use cloud LLM or server connection");
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", false);
        ret.put("reason", "Native LLM not implemented, use server connection or cloud API");
        call.resolve(ret);
    }

    @PluginMethod
    public void getLoadedModel(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("loaded", false);
        ret.put("model", null);
        call.resolve(ret);
    }
}
