package com.cuesight.overlay

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView

    private val projectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            val serviceIntent = Intent(this, PoolOverlayService::class.java).apply {
                putExtra(PoolOverlayService.EXTRA_RESULT_CODE, result.resultCode)
                putExtra(PoolOverlayService.EXTRA_DATA, result.data)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
            statusText.text =
                "Overlay active! Open your pool app:\n" +
                "1. Tap Detect (or Live: On) to auto-detect table size & cue ball.\n" +
                "2. Drag the aim line if needed.\n" +
                "3. Tap Lock to Shoot so touches pass straight through to take your shot."
        } else {
            statusText.text = "Screen capture permission cancelled."
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 96, 48, 48)
        }

        val title = TextView(this).apply {
            text = "CueSight Pool Overlay"
            textSize = 24f
        }

        statusText = TextView(this).apply {
            text = "1. Grant Display Over Other Apps & Screen Capture.\n" +
                   "2. Open any pool game and tap Detect on the floating bar.\n" +
                   "3. Tap Lock to Shoot to aim and shoot directly in your pool game while the extended lines stay overlaid."
            textSize = 15f
            setPadding(0, 24, 0, 36)
        }

        val btnStart = Button(this).apply {
            text = "Start Pool Overlay"
            setOnClickListener { startOverlayFlow() }
        }

        val btnStop = Button(this).apply {
            text = "Stop Overlay"
            setOnClickListener {
                stopService(Intent(this@MainActivity, PoolOverlayService::class.java))
                statusText.text = "Overlay stopped."
            }
        }

        root.addView(title)
        root.addView(statusText)
        root.addView(btnStart)
        root.addView(btnStop)
        setContentView(root)
    }

    private fun startOverlayFlow() {
        if (!Settings.canDrawOverlays(this)) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
            statusText.text = "Enable 'Display over other apps', then return and tap Start Pool Overlay."
            return
        }

        val mediaProjectionManager =
            getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projectionLauncher.launch(mediaProjectionManager.createScreenCaptureIntent())
    }
}
