package com.metahuman.os.plugins.updater

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.*
import java.io.File

/**
 * Native Updater Plugin
 *
 * Handles APK download and installation for app updates.
 */
@CapacitorPlugin(name = "NativeUpdater")
class NativeUpdaterPlugin : Plugin() {

    companion object {
        private const val TAG = "NativeUpdater"
        private const val REQUEST_INSTALL_PERMISSION = 1001
    }

    private var downloadId: Long = -1
    private var downloadJob: Job? = null
    private var pendingInstallCall: PluginCall? = null

    /**
     * Get current app version info
     */
    @PluginMethod
    fun getAppInfo(call: PluginCall) {
        try {
            val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageInfo.longVersionCode.toInt()
            } else {
                @Suppress("DEPRECATION")
                packageInfo.versionCode
            }

            val result = JSObject().apply {
                put("version", packageInfo.versionName ?: "0.0.0")
                put("versionCode", versionCode)
                put("packageName", context.packageName)
            }
            call.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get app info", e)
            call.reject("Failed to get app info: ${e.message}")
        }
    }

    /**
     * Check if app can install APKs
     */
    @PluginMethod
    fun canInstallApk(call: PluginCall) {
        val canInstall = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else {
            true // Pre-Oreo doesn't need special permission
        }

        call.resolve(JSObject().apply {
            put("canInstall", canInstall)
        })
    }

    /**
     * Request permission to install APKs (Android 8+)
     */
    @PluginMethod
    fun requestInstallPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.packageManager.canRequestPackageInstalls()) {
                pendingInstallCall = call
                val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:${context.packageName}")
                }
                startActivityForResult(call, intent, REQUEST_INSTALL_PERMISSION)
                return
            }
        }

        call.resolve(JSObject().apply {
            put("granted", true)
        })
    }

    override fun handleOnActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.handleOnActivityResult(requestCode, resultCode, data)

        if (requestCode == REQUEST_INSTALL_PERMISSION) {
            val canInstall = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.packageManager.canRequestPackageInstalls()
            } else {
                true
            }

            pendingInstallCall?.resolve(JSObject().apply {
                put("granted", canInstall)
            })
            pendingInstallCall = null
        }
    }

    /**
     * Download APK and trigger installation
     */
    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("URL is required")
        val version = call.getString("version") ?: "update"

        // Check install permission first
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.packageManager.canRequestPackageInstalls()) {
                return call.reject("Install permission not granted. Please enable 'Install unknown apps' in settings.")
            }
        }

        Log.i(TAG, "Starting download from: $url")

        // Use DownloadManager for reliable background download
        val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

        val fileName = "metahuman-$version.apk"
        val destinationDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        val destinationFile = File(destinationDir, fileName)

        // Delete old file if exists
        if (destinationFile.exists()) {
            destinationFile.delete()
        }

        val request = DownloadManager.Request(Uri.parse(url)).apply {
            setTitle("MetaHuman OS Update")
            setDescription("Downloading version $version")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationUri(Uri.fromFile(destinationFile))
            setAllowedOverMetered(true)
            setAllowedOverRoaming(true)
        }

        downloadId = downloadManager.enqueue(request)
        Log.i(TAG, "Download enqueued with ID: $downloadId")

        // Register receiver for download completion
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
                if (id == downloadId) {
                    context.unregisterReceiver(this)
                    handleDownloadComplete(call, downloadManager, downloadId, destinationFile)
                }
            }
        }

        context.registerReceiver(
            receiver,
            IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            Context.RECEIVER_NOT_EXPORTED
        )

        // Start progress monitoring
        monitorDownloadProgress(downloadManager, downloadId)
    }

    private fun monitorDownloadProgress(downloadManager: DownloadManager, downloadId: Long) {
        downloadJob?.cancel()
        downloadJob = CoroutineScope(Dispatchers.IO).launch {
            var isComplete = false

            while (isActive && !isComplete) {
                val query = DownloadManager.Query().setFilterById(downloadId)
                val cursor: Cursor? = downloadManager.query(query)

                cursor?.use {
                    if (it.moveToFirst()) {
                        val bytesDownloaded = it.getLong(
                            it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
                        )
                        val bytesTotal = it.getLong(
                            it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
                        )

                        if (bytesTotal > 0) {
                            val progress = ((bytesDownloaded * 100) / bytesTotal).toInt()

                            withContext(Dispatchers.Main) {
                                notifyListeners("downloadProgress", JSObject().apply {
                                    put("progress", progress)
                                    put("bytesDownloaded", bytesDownloaded)
                                    put("totalBytes", bytesTotal)
                                })
                            }
                        }

                        val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                        if (status == DownloadManager.STATUS_SUCCESSFUL ||
                            status == DownloadManager.STATUS_FAILED) {
                            isComplete = true
                        }
                    }
                }

                if (!isComplete) {
                    delay(500) // Update every 500ms
                }
            }
        }
    }

    private fun handleDownloadComplete(
        call: PluginCall,
        downloadManager: DownloadManager,
        downloadId: Long,
        file: File
    ) {
        downloadJob?.cancel()

        val query = DownloadManager.Query().setFilterById(downloadId)
        val cursor = downloadManager.query(query)

        cursor?.use {
            if (it.moveToFirst()) {
                val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))

                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                    Log.i(TAG, "Download complete: ${file.absolutePath}")

                    notifyListeners("downloadComplete", JSObject().apply {
                        put("filePath", file.absolutePath)
                    })

                    // Trigger APK installation
                    installApk(file, call)
                } else {
                    val reason = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                    val errorMsg = "Download failed with status $status, reason $reason"
                    Log.e(TAG, errorMsg)

                    notifyListeners("downloadError", JSObject().apply {
                        put("error", errorMsg)
                    })

                    call.resolve(JSObject().apply {
                        put("success", false)
                        put("error", errorMsg)
                    })
                }
            }
        }
    }

    private fun installApk(file: File, call: PluginCall) {
        try {
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file
            )

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
            }

            context.startActivity(intent)

            call.resolve(JSObject().apply {
                put("success", true)
                put("filePath", file.absolutePath)
            })
        } catch (e: Exception) {
            Log.e(TAG, "Failed to install APK", e)
            call.resolve(JSObject().apply {
                put("success", false)
                put("error", "Failed to install: ${e.message}")
            })
        }
    }

    /**
     * Cancel ongoing download
     */
    @PluginMethod
    fun cancelDownload(call: PluginCall) {
        if (downloadId != -1L) {
            val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            downloadManager.remove(downloadId)
            downloadId = -1
            downloadJob?.cancel()
        }
        call.resolve()
    }
}
