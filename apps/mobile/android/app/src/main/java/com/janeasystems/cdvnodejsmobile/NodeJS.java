package com.janeasystems.cdvnodejsmobile;

import android.util.Log;

/**
 * Native method declarations for nodejs-mobile.
 *
 * IMPORTANT: This class MUST be named "NodeJS" in package "com.janeasystems.cdvnodejsmobile"
 * because the prebuilt native library (libnodejs-mobile-cordova-native-lib.so) has JNI
 * method names that include the full package path + class name, e.g.:
 *   Java_com_janeasystems_cdvnodejsmobile_NodeJS_registerNodeDataDirPath
 *
 * The Capacitor plugin (NodejsMobilePlugin) delegates native calls to this class.
 */
public class NodeJS {

    private static final String TAG = "NodeJS";
    private static boolean librariesLoaded = false;

    static {
        try {
            System.loadLibrary("nodejs-mobile-cordova-native-lib");
            System.loadLibrary("node");
            librariesLoaded = true;
            Log.d(TAG, "Native libraries loaded successfully");
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "Failed to load native libraries: " + e.getMessage());
        }
    }

    public static boolean areLibrariesLoaded() {
        return librariesLoaded;
    }

    // Native methods - signatures match JNI names in prebuilt native library
    public native Integer startNodeWithArguments(String[] arguments, String nodePath, boolean redirectOutputToLogcat);
    public native void sendMessageToNodeChannel(String channelName, String msg);
    public native void registerNodeDataDirPath(String dataDir);
    public native String getCurrentABIName();

    /**
     * Called from native code when Node.js sends a message.
     * This static method is invoked by JNI from the native layer.
     */
    public static void sendMessageToApplication(String channelName, String msg) {
        Log.d(TAG, "Message from Node.js [" + channelName + "]: " + msg);
        // Forward to registered listener if available
        if (messageListener != null) {
            messageListener.onMessage(channelName, msg);
        }
    }

    // Message listener interface and registration
    public interface MessageListener {
        void onMessage(String channel, String message);
    }

    private static MessageListener messageListener = null;

    public static void setMessageListener(MessageListener listener) {
        messageListener = listener;
    }
}
