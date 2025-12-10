package com.metahuman.os;

import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.metahuman.os.plugins.voice.NativeVoicePlugin;
import com.metahuman.os.plugins.llm.NativeLLMPlugin;
import com.metahuman.os.plugins.updater.NativeUpdaterPlugin;
import com.metahuman.os.plugins.NodejsMobilePlugin;

/**
 * MainActivity with direct key event interception for Bluetooth headphone buttons.
 *
 * We override dispatchKeyEvent() to capture hardware button events at the Activity level
 * BEFORE they get routed to Android's media button system (and Google Assistant).
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "MainActivity";

    // Static callback to forward key events to NativeVoicePlugin
    public static KeyEventCallback keyEventCallback;

    public interface KeyEventCallback {
        boolean onKeyEvent(KeyEvent event);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Enable WebView debugging for Chrome DevTools
        WebView.setWebContentsDebuggingEnabled(true);

        // Register custom plugins before super.onCreate()
        registerPlugin(NativeVoicePlugin.class);
        registerPlugin(NativeLLMPlugin.class);
        registerPlugin(NativeUpdaterPlugin.class);
        registerPlugin(NodejsMobilePlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Intercept ALL key events at the Activity level.
     * This catches hardware button presses BEFORE they're dispatched to the system.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();

        // Log all key events for debugging
        Log.d(TAG, "dispatchKeyEvent: keyCode=" + keyCode + " action=" + event.getAction() +
              " scanCode=" + event.getScanCode());

        // Capture media/headset button events
        if (keyCode == KeyEvent.KEYCODE_HEADSETHOOK ||
            keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
            keyCode == KeyEvent.KEYCODE_MEDIA_PLAY ||
            keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE ||
            keyCode == KeyEvent.KEYCODE_MEDIA_STOP ||
            keyCode == KeyEvent.KEYCODE_MEDIA_NEXT ||
            keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS) {

            Log.d(TAG, "Captured media button: " + keyCode);

            // Forward to plugin callback if registered
            if (keyEventCallback != null) {
                boolean handled = keyEventCallback.onKeyEvent(event);
                if (handled) {
                    Log.d(TAG, "Event handled by plugin, blocking system dispatch");
                    return true; // Consume the event - don't let it go to Google
                }
            }
        }

        // Let other events pass through normally
        return super.dispatchKeyEvent(event);
    }

    /**
     * Also override onKeyDown as a fallback.
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        Log.d(TAG, "onKeyDown: keyCode=" + keyCode);

        if (keyCode == KeyEvent.KEYCODE_HEADSETHOOK ||
            keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {

            Log.d(TAG, "onKeyDown captured media button");

            if (keyEventCallback != null) {
                // Create a synthetic event for consistency
                boolean handled = keyEventCallback.onKeyEvent(event);
                if (handled) {
                    return true;
                }
            }
        }

        return super.onKeyDown(keyCode, event);
    }

    /**
     * Override onKeyUp as well for complete capture.
     */
    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        Log.d(TAG, "onKeyUp: keyCode=" + keyCode);

        if (keyCode == KeyEvent.KEYCODE_HEADSETHOOK ||
            keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {

            Log.d(TAG, "onKeyUp captured media button");

            if (keyEventCallback != null) {
                boolean handled = keyEventCallback.onKeyEvent(event);
                if (handled) {
                    return true;
                }
            }
        }

        return super.onKeyUp(keyCode, event);
    }
}
