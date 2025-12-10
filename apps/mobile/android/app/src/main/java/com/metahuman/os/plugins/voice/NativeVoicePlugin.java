package com.metahuman.os.plugins.voice;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native Voice Plugin (Stub)
 *
 * Placeholder for native voice features.
 * TODO: Implement native voice recording and playback.
 */
@CapacitorPlugin(name = "NativeVoice")
public class NativeVoicePlugin extends Plugin {

    private static final String TAG = "NativeVoice";

    @Override
    public void load() {
        Log.d(TAG, "NativeVoice plugin loaded (stub)");
    }

    @PluginMethod
    public void startRecording(PluginCall call) {
        Log.d(TAG, "startRecording called (not implemented)");
        call.reject("Not implemented - use web audio API");
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        Log.d(TAG, "stopRecording called (not implemented)");
        call.reject("Not implemented - use web audio API");
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", false);
        ret.put("reason", "Native voice not implemented, use web audio API");
        call.resolve(ret);
    }
}
