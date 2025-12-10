package com.metahuman.os.plugins.updater;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Native Updater Plugin for Capacitor
 *
 * Handles APK download and installation on Android devices.
 * Uses DownloadManager for reliable background downloads with progress tracking.
 */
@CapacitorPlugin(name = "NativeUpdater")
public class NativeUpdaterPlugin extends Plugin {

    private static final String TAG = "NativeUpdater";

    private DownloadManager downloadManager;
    private long currentDownloadId = -1;
    private PluginCall pendingInstallCall;
    private Handler progressHandler;
    private Runnable progressRunnable;
    private BroadcastReceiver downloadReceiver;

    @Override
    public void load() {
        downloadManager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        progressHandler = new Handler(Looper.getMainLooper());

        // Register receiver for download completion
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id == currentDownloadId) {
                    onDownloadComplete();
                }
            }
        };

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(downloadReceiver,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(downloadReceiver,
                new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
        }

        Log.d(TAG, "NativeUpdater plugin loaded");
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (downloadReceiver != null) {
            try {
                getContext().unregisterReceiver(downloadReceiver);
            } catch (Exception e) {
                Log.e(TAG, "Failed to unregister receiver: " + e.getMessage());
            }
        }
        stopProgressTracking();
    }

    /**
     * Get current app version information
     */
    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageInfo pInfo = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);

            JSObject ret = new JSObject();
            ret.put("version", pInfo.versionName);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                ret.put("versionCode", pInfo.getLongVersionCode());
            } else {
                ret.put("versionCode", pInfo.versionCode);
            }

            ret.put("packageName", getContext().getPackageName());

            Log.d(TAG, "App info: " + ret.toString());
            call.resolve(ret);
        } catch (PackageManager.NameNotFoundException e) {
            Log.e(TAG, "Failed to get app info: " + e.getMessage());
            call.reject("Failed to get app info", e);
        }
    }

    /**
     * Check if app can install APKs (Android 8+)
     */
    @PluginMethod
    public void canInstallApk(PluginCall call) {
        JSObject ret = new JSObject();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            boolean canInstall = getContext().getPackageManager().canRequestPackageInstalls();
            ret.put("canInstall", canInstall);
        } else {
            // Pre-Android 8, just need to enable "Unknown sources" in settings
            ret.put("canInstall", true);
        }

        call.resolve(ret);
    }

    /**
     * Request permission to install APKs (Android 8+)
     */
    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);

                // Can't know if permission was granted, user needs to retry
                JSObject ret = new JSObject();
                ret.put("granted", false);
                ret.put("message", "Please enable 'Install unknown apps' permission and try again");
                call.resolve(ret);
                return;
            }
        }

        JSObject ret = new JSObject();
        ret.put("granted", true);
        call.resolve(ret);
    }

    /**
     * Download APK and install
     */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String version = call.getString("version", "update");

        if (url == null || url.isEmpty()) {
            call.reject("URL is required");
            return;
        }

        Log.d(TAG, "Starting download from: " + url);

        // Check install permission first (Android 8+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!getContext().getPackageManager().canRequestPackageInstalls()) {
                call.reject("Install permission not granted. Please enable 'Install unknown apps' for this app.");
                return;
            }
        }

        // Cancel any existing download
        if (currentDownloadId != -1) {
            downloadManager.remove(currentDownloadId);
            stopProgressTracking();
        }

        try {
            // Set up download request
            String fileName = "metahuman-" + version + ".apk";
            File downloadDir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            File apkFile = new File(downloadDir, fileName);

            // Delete existing file if present
            if (apkFile.exists()) {
                apkFile.delete();
            }

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("MetaHuman OS Update");
            request.setDescription("Downloading version " + version);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            request.setDestinationUri(Uri.fromFile(apkFile));

            // Allow download over any network
            request.setAllowedNetworkTypes(
                DownloadManager.Request.NETWORK_WIFI |
                DownloadManager.Request.NETWORK_MOBILE
            );

            // Start download
            currentDownloadId = downloadManager.enqueue(request);
            pendingInstallCall = call;

            Log.d(TAG, "Download started with ID: " + currentDownloadId);

            // Start progress tracking
            startProgressTracking();

        } catch (Exception e) {
            Log.e(TAG, "Download failed: " + e.getMessage(), e);
            call.reject("Download failed: " + e.getMessage());
        }
    }

    /**
     * Cancel ongoing download
     */
    @PluginMethod
    public void cancelDownload(PluginCall call) {
        if (currentDownloadId != -1) {
            downloadManager.remove(currentDownloadId);
            currentDownloadId = -1;
            stopProgressTracking();
            Log.d(TAG, "Download cancelled");
        }

        if (pendingInstallCall != null) {
            pendingInstallCall.reject("Download cancelled");
            pendingInstallCall = null;
        }

        call.resolve();
    }

    /**
     * Start tracking download progress
     */
    private void startProgressTracking() {
        progressRunnable = new Runnable() {
            @Override
            public void run() {
                if (currentDownloadId == -1) return;

                DownloadManager.Query query = new DownloadManager.Query();
                query.setFilterById(currentDownloadId);

                Cursor cursor = downloadManager.query(query);
                if (cursor != null && cursor.moveToFirst()) {
                    int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                    int bytesDownloadedIndex = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
                    int totalBytesIndex = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);

                    if (statusIndex >= 0 && bytesDownloadedIndex >= 0 && totalBytesIndex >= 0) {
                        int status = cursor.getInt(statusIndex);
                        long bytesDownloaded = cursor.getLong(bytesDownloadedIndex);
                        long totalBytes = cursor.getLong(totalBytesIndex);

                        if (status == DownloadManager.STATUS_RUNNING && totalBytes > 0) {
                            int progress = (int) ((bytesDownloaded * 100) / totalBytes);

                            JSObject data = new JSObject();
                            data.put("progress", progress);
                            data.put("bytesDownloaded", bytesDownloaded);
                            data.put("totalBytes", totalBytes);

                            notifyListeners("downloadProgress", data);
                        }
                    }
                    cursor.close();
                }

                // Continue tracking
                progressHandler.postDelayed(this, 500);
            }
        };

        progressHandler.post(progressRunnable);
    }

    /**
     * Stop tracking download progress
     */
    private void stopProgressTracking() {
        if (progressRunnable != null) {
            progressHandler.removeCallbacks(progressRunnable);
            progressRunnable = null;
        }
    }

    /**
     * Called when download completes
     */
    private void onDownloadComplete() {
        stopProgressTracking();

        if (currentDownloadId == -1) return;

        DownloadManager.Query query = new DownloadManager.Query();
        query.setFilterById(currentDownloadId);

        Cursor cursor = downloadManager.query(query);
        if (cursor != null && cursor.moveToFirst()) {
            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int reasonIndex = cursor.getColumnIndex(DownloadManager.COLUMN_REASON);
            int localUriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);

            if (statusIndex >= 0) {
                int status = cursor.getInt(statusIndex);

                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                    String localUri = localUriIndex >= 0 ? cursor.getString(localUriIndex) : null;
                    Log.d(TAG, "Download complete: " + localUri);

                    // Notify JS of completion
                    JSObject data = new JSObject();
                    data.put("filePath", localUri);
                    notifyListeners("downloadComplete", data);

                    // Trigger installation
                    if (localUri != null) {
                        installApk(localUri);
                    }

                    if (pendingInstallCall != null) {
                        JSObject ret = new JSObject();
                        ret.put("success", true);
                        ret.put("filePath", localUri);
                        pendingInstallCall.resolve(ret);
                        pendingInstallCall = null;
                    }
                } else if (status == DownloadManager.STATUS_FAILED) {
                    int reason = reasonIndex >= 0 ? cursor.getInt(reasonIndex) : -1;
                    String errorMsg = getDownloadErrorMessage(reason);
                    Log.e(TAG, "Download failed: " + errorMsg);

                    // Notify JS of error
                    JSObject data = new JSObject();
                    data.put("error", errorMsg);
                    notifyListeners("downloadError", data);

                    if (pendingInstallCall != null) {
                        pendingInstallCall.reject(errorMsg);
                        pendingInstallCall = null;
                    }
                }
            }
            cursor.close();
        }

        currentDownloadId = -1;
    }

    /**
     * Install APK using FileProvider
     */
    private void installApk(String uriString) {
        try {
            Uri fileUri = Uri.parse(uriString);
            File apkFile = new File(fileUri.getPath());

            if (!apkFile.exists()) {
                Log.e(TAG, "APK file not found: " + apkFile.getAbsolutePath());
                return;
            }

            Log.d(TAG, "Installing APK: " + apkFile.getAbsolutePath());

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                // Use FileProvider for Android 7+
                Uri contentUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apkFile
                );
                intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } else {
                // Direct file URI for older Android
                intent.setDataAndType(Uri.fromFile(apkFile), "application/vnd.android.package-archive");
            }

            getContext().startActivity(intent);
            Log.d(TAG, "Install intent started");

        } catch (Exception e) {
            Log.e(TAG, "Failed to start install: " + e.getMessage(), e);
        }
    }

    /**
     * Get human-readable error message for download failure
     */
    private String getDownloadErrorMessage(int reason) {
        switch (reason) {
            case DownloadManager.ERROR_CANNOT_RESUME:
                return "Download cannot be resumed";
            case DownloadManager.ERROR_DEVICE_NOT_FOUND:
                return "Storage device not found";
            case DownloadManager.ERROR_FILE_ALREADY_EXISTS:
                return "File already exists";
            case DownloadManager.ERROR_FILE_ERROR:
                return "Storage error";
            case DownloadManager.ERROR_HTTP_DATA_ERROR:
                return "HTTP data error";
            case DownloadManager.ERROR_INSUFFICIENT_SPACE:
                return "Insufficient storage space";
            case DownloadManager.ERROR_TOO_MANY_REDIRECTS:
                return "Too many redirects";
            case DownloadManager.ERROR_UNHANDLED_HTTP_CODE:
                return "Unhandled HTTP error";
            case DownloadManager.ERROR_UNKNOWN:
            default:
                return "Unknown download error";
        }
    }
}
