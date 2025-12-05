package com.metahuman.os.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.KeyEvent

/**
 * MediaButtonReceiver - Intercepts hardware media button events BEFORE Google Assistant.
 *
 * This receiver has high priority (999) in the manifest to intercept media button
 * broadcasts before other apps (including Google Assistant) can handle them.
 *
 * It aborts the broadcast after handling to prevent other apps from receiving it.
 */
class MediaButtonReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "MediaButtonReceiver"

        // Static callback to NativeVoicePlugin
        var onMediaButtonEvent: ((KeyEvent) -> Boolean)? = null
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action != Intent.ACTION_MEDIA_BUTTON) {
            return
        }

        val keyEvent = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
        if (keyEvent == null) {
            Log.d(TAG, "No KeyEvent in intent")
            return
        }

        Log.d(TAG, "Received media button: keyCode=${keyEvent.keyCode}, action=${keyEvent.action}")

        // Forward to the plugin callback if registered
        val handled = onMediaButtonEvent?.invoke(keyEvent) ?: false

        if (handled) {
            // CRITICAL: Abort the broadcast to prevent Google Assistant from receiving it
            Log.d(TAG, "Event handled - aborting broadcast to block Google Assistant")
            abortBroadcast()
        } else {
            Log.d(TAG, "Event not handled - letting it propagate")
        }
    }
}
