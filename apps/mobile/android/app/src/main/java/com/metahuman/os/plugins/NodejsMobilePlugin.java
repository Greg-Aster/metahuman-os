package com.metahuman.os.plugins;

import android.util.Log;
import android.content.Context;
import android.content.res.AssetManager;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.system.Os;
import android.system.ErrnoException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Import the JNI wrapper class from the correct package for native method signatures
import com.janeasystems.cdvnodejsmobile.NodeJS;

import java.io.*;
import java.util.*;
import java.util.concurrent.Semaphore;

/**
 * Capacitor plugin wrapper for nodejs-mobile
 *
 * This plugin loads and manages the Node.js runtime embedded in the app.
 * It provides a bridge between the Capacitor WebView and the Node.js engine.
 *
 * IMPORTANT: Native methods are declared in NodeJSNative class which must be
 * in package com.janeasystems.cdvnodejsmobile to match the prebuilt JNI signatures.
 */
@CapacitorPlugin(name = "NodejsMobile")
public class NodejsMobilePlugin extends Plugin {

    private static final String TAG = "NodejsMobile";
    private static final String PROJECT_ROOT = "www/nodejs-project";
    private static final String BUILTIN_ASSETS = "nodejs-mobile-cordova-assets";
    private static final String BUILTIN_MODULES = "nodejs-mobile-cordova-assets/builtin_modules";
    private static final String TRASH_DIR = "nodejs-project-trash";
    private static final String BUILTIN_NATIVE_ASSETS_PREFIX = "nodejs-native-assets-";
    private static final String SHARED_PREFS = "NODEJS_MOBILE_PREFS";
    private static final String LAST_UPDATED_TIME = "NODEJS_MOBILE_APK_LastUpdateTime";

    // DEVELOPMENT: Set to true to always refresh assets on startup
    // This ensures code changes are always loaded without needing to uninstall
    private static final boolean ALWAYS_REFRESH_ASSETS = false;

    private Context context;
    private AssetManager assetManager;
    private String filesDir;
    private String nodeAppRootAbsolutePath;
    private String nodePath;
    private String trashDir;
    private String nativeAssetsPath;

    private long lastUpdateTime = 1;
    private long previousLastUpdateTime = 0;

    private static Semaphore initSemaphore = new Semaphore(1);
    private static boolean initCompleted = false;
    private static IOException ioe = null;
    private static boolean engineAlreadyStarted = false;
    private static boolean nodeIsReadyForAppEvents = false;

    private static final Object onlyOneEngineStartingAtATimeLock = new Object();

    // JNI wrapper instance - uses correct package for native method signatures
    private NodeJS nodeJS = new NodeJS();

    // Static reference for message callback
    private static NodejsMobilePlugin instance;

    @Override
    public void load() {
        instance = this;
        context = getContext();
        assetManager = context.getAssets();
        filesDir = context.getFilesDir().getAbsolutePath();

        // Check if native libraries loaded successfully
        if (!NodeJS.areLibrariesLoaded()) {
            Log.e(TAG, "Native libraries failed to load - nodejs-mobile will not work");
            return;
        }

        // Set up message listener to forward Node.js messages to JS
        NodeJS.setMessageListener(new NodeJS.MessageListener() {
            @Override
            public void onMessage(String channel, String message) {
                forwardMessageToJS(channel, message);
            }
        });

        // Set TMPDIR
        try {
            Os.setenv("TMPDIR", context.getCacheDir().getAbsolutePath(), true);
        } catch (ErrnoException e) {
            Log.e(TAG, "Failed to set TMPDIR: " + e.getMessage());
        }

        // Register data dir via JNI wrapper
        nodeJS.registerNodeDataDirPath(filesDir);

        // Set up paths
        nodeAppRootAbsolutePath = filesDir + "/" + PROJECT_ROOT;
        nodePath = nodeAppRootAbsolutePath + ":" + filesDir + "/" + BUILTIN_MODULES;
        trashDir = filesDir + "/" + TRASH_DIR;
        nativeAssetsPath = BUILTIN_NATIVE_ASSETS_PREFIX + nodeJS.getCurrentABIName();

        Log.d(TAG, "Plugin loaded. Node app root: " + nodeAppRootAbsolutePath);
        Log.d(TAG, "Native ABI: " + nodeJS.getCurrentABIName());

        // Start async initialization
        asyncInit();
    }

    private void asyncInit() {
        if (wasAPKUpdated()) {
            try {
                initSemaphore.acquire();
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        emptyTrash();
                        try {
                            copyNodeJSAssets();
                            initCompleted = true;
                            Log.d(TAG, "Asset initialization completed");
                        } catch (IOException e) {
                            ioe = e;
                            Log.e(TAG, "Node assets copy failed: " + e.toString());
                        }
                        initSemaphore.release();
                        emptyTrash();
                    }
                }).start();
            } catch (InterruptedException ie) {
                initSemaphore.release();
                Log.e(TAG, "Interrupted during init: " + ie.getMessage());
            }
        } else {
            initCompleted = true;
            Log.d(TAG, "APK not updated, skipping asset copy");
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        String scriptFileName = call.getString("script", "main.js");
        boolean redirectOutput = call.getBoolean("redirectOutputToLogcat", true);

        Log.d(TAG, "start() called with script: " + scriptFileName);

        if (engineAlreadyStarted) {
            call.reject("Engine already started");
            return;
        }

        final String scriptFileAbsolutePath = nodeAppRootAbsolutePath + "/" + scriptFileName;

        new Thread(new Runnable() {
            @Override
            public void run() {
                waitForInit();

                if (ioe != null) {
                    call.reject("Initialization failed: " + ioe.toString());
                    return;
                }

                synchronized(onlyOneEngineStartingAtATimeLock) {
                    if (engineAlreadyStarted) {
                        call.reject("Engine already started");
                        return;
                    }

                    File fileObject = new File(scriptFileAbsolutePath);
                    if (!fileObject.exists()) {
                        call.reject("Script file not found: " + scriptFileAbsolutePath);
                        return;
                    }

                    engineAlreadyStarted = true;
                }

                Log.d(TAG, "Starting Node.js with script: " + scriptFileAbsolutePath);
                call.resolve();

                nodeJS.startNodeWithArguments(
                    new String[]{"node", scriptFileAbsolutePath},
                    nodePath,
                    redirectOutput
                );
            }
        }).start();
    }

    @PluginMethod
    public void send(PluginCall call) {
        String channel = call.getString("channel", "_EVENTS_");
        String message = call.getString("message");

        if (message == null) {
            call.reject("Message is required");
            return;
        }

        nodeJS.sendMessageToNodeChannel(channel, message);
        call.resolve();
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ready", NodeJS.areLibrariesLoaded() && engineAlreadyStarted);
        ret.put("initialized", initCompleted);
        ret.put("engineStarted", engineAlreadyStarted);
        ret.put("librariesLoaded", NodeJS.areLibrariesLoaded());
        call.resolve(ret);
    }

    /**
     * Called from native code when Node.js sends a message
     */
    public static void sendMessageToApplication(String channelName, String msg) {
        Log.d(TAG, "Message from Node.js [" + channelName + "]: " + msg);
        // Forward to instance if available
        if (instance != null) {
            instance.forwardMessageToJS(channelName, msg);
        }
    }

    /**
     * Forward a message from Node.js to the JavaScript layer
     */
    private void forwardMessageToJS(String channel, String message) {
        JSObject data = new JSObject();
        data.put("channel", channel);
        data.put("message", message);
        notifyListeners("message", data);
    }

    // Helper methods

    private void waitForInit() {
        if (!initCompleted) {
            try {
                initSemaphore.acquire();
                initSemaphore.release();
            } catch (InterruptedException ie) {
                initSemaphore.release();
            }
        }
    }

    private boolean wasAPKUpdated() {
        // Development mode: always refresh assets
        if (ALWAYS_REFRESH_ASSETS) {
            Log.d(TAG, "ALWAYS_REFRESH_ASSETS enabled - forcing asset copy");
            return true;
        }

        SharedPreferences prefs = context.getSharedPreferences(SHARED_PREFS, Context.MODE_PRIVATE);
        this.previousLastUpdateTime = prefs.getLong(LAST_UPDATED_TIME, 0);

        try {
            PackageInfo packageInfo = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            this.lastUpdateTime = packageInfo.lastUpdateTime;
        } catch (PackageManager.NameNotFoundException e) {
            Log.e(TAG, "Failed to get package info: " + e.getMessage());
        }
        return (this.lastUpdateTime != this.previousLastUpdateTime);
    }

    private void saveLastUpdateTime() {
        SharedPreferences prefs = context.getSharedPreferences(SHARED_PREFS, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        editor.putLong(LAST_UPDATED_TIME, this.lastUpdateTime);
        editor.commit();
    }

    private void emptyTrash() {
        File trash = new File(trashDir);
        if (trash.exists()) {
            deleteFolderRecursively(trash);
        }
    }

    private void copyNodeJSAssets() throws IOException {
        // Delete existing plugin assets
        File nodejsBuiltinModulesFolder = new File(filesDir + "/" + BUILTIN_ASSETS);
        if (nodejsBuiltinModulesFolder.exists()) {
            deleteFolderRecursively(nodejsBuiltinModulesFolder);
        }
        copyFolder(BUILTIN_ASSETS);

        // Move existing project to trash
        File nodejsProjectFolder = new File(filesDir + "/" + PROJECT_ROOT);
        if (nodejsProjectFolder.exists()) {
            File trash = new File(trashDir);
            nodejsProjectFolder.renameTo(trash);
        }
        nodejsProjectFolder.mkdirs();

        // Copy project files
        ArrayList<String> dirs = readFileFromAssets("dir.list");
        ArrayList<String> files = readFileFromAssets("file.list");

        if (files.size() > 0) {
            for (String dir : dirs) {
                new File(filesDir + "/" + dir).mkdirs();
            }
            for (String file : files) {
                copyAssetFile(file, filesDir + "/" + file);
            }
        } else {
            copyFolder(PROJECT_ROOT);
        }

        // Copy native assets
        copyNativeAssets();

        Log.d(TAG, "Node assets copied successfully");
        saveLastUpdateTime();
    }

    private void copyNativeAssets() throws IOException {
        ArrayList<String> nativeDirs = readFileFromAssets(nativeAssetsPath + "/dir.list");
        ArrayList<String> nativeFiles = readFileFromAssets(nativeAssetsPath + "/file.list");

        if (nativeFiles.size() > 0) {
            for (String dir : nativeDirs) {
                new File(nodeAppRootAbsolutePath + "/" + dir).mkdirs();
            }
            for (String file : nativeFiles) {
                copyAssetFile(nativeAssetsPath + "/" + file, nodeAppRootAbsolutePath + "/" + file);
            }
        }
    }

    private ArrayList<String> readFileFromAssets(String filename) {
        ArrayList<String> lines = new ArrayList<>();
        try {
            BufferedReader reader = new BufferedReader(new InputStreamReader(assetManager.open(filename)));
            String line = reader.readLine();
            while (line != null) {
                lines.add(line);
                line = reader.readLine();
            }
            reader.close();
        } catch (IOException e) {
            // File not found is OK
        }
        return lines;
    }

    private void copyFolder(String srcFolder) throws IOException {
        copyAssetFolder(srcFolder, filesDir + "/" + srcFolder);
    }

    private void copyAssetFolder(String srcFolder, String destPath) throws IOException {
        String[] files = assetManager.list(srcFolder);
        if (files.length == 0) {
            copyAssetFile(srcFolder, destPath);
        } else {
            new File(destPath).mkdirs();
            for (String file : files) {
                copyAssetFolder(srcFolder + "/" + file, destPath + "/" + file);
            }
        }
    }

    private void copyAssetFile(String srcPath, String destPath) throws IOException {
        InputStream in = assetManager.open(srcPath);
        new File(destPath).createNewFile();
        OutputStream out = new FileOutputStream(destPath);

        byte[] buffer = new byte[1024];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }

        in.close();
        out.flush();
        out.close();
    }

    private void deleteFolderRecursively(File file) {
        try {
            for (File childFile : file.listFiles()) {
                if (childFile.isDirectory()) {
                    deleteFolderRecursively(childFile);
                } else {
                    childFile.delete();
                }
            }
            file.delete();
        } catch (Exception e) {
            Log.e(TAG, "Failed to delete folder: " + e.getMessage());
        }
    }
}
