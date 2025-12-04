package com.metahuman.os;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.metahuman.os.plugins.voice.NativeVoicePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Enable WebView debugging for Chrome DevTools
        WebView.setWebContentsDebuggingEnabled(true);

        // Register custom plugins before super.onCreate()
        registerPlugin(NativeVoicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
