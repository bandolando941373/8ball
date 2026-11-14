package com.cuesight.overlay

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat

class PoolOverlayService : Service() {

    companion object {
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_DATA = "data"
        private const val CHANNEL_ID = "cuesight_overlay_channel"
    }

    private lateinit var windowManager: WindowManager
    private lateinit var trajectoryView: TrajectoryOverlayView
    private lateinit var fullScreenParams: WindowManager.LayoutParams
    private lateinit var controlBar: LinearLayout
    private lateinit var infoLabel: TextView

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        trajectoryView = TrajectoryOverlayView(this)

        val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        fullScreenParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
        }

        windowManager.addView(trajectoryView, fullScreenParams)
        addFloatingControlBar(overlayType)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundNotification()

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
            ?: Activity.RESULT_CANCELED
        @Suppress("DEPRECATION")
        val data = intent?.getParcelableExtra<Intent>(EXTRA_DATA)

        if (resultCode == Activity.RESULT_OK && data != null && mediaProjection == null) {
            val mgr = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = mgr.getMediaProjection(resultCode, data)
            mediaProjection?.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    virtualDisplay?.release()
                    imageReader?.close()
                }
            }, mainHandler)
            setupVirtualDisplay()
        }
        return START_NOT_STICKY
    }

    private fun setupVirtualDisplay() {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        windowManager.defaultDisplay.getRealMetrics(metrics)
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        val density = metrics.densityDpi

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "CueSightCapture",
            width,
            height,
            density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface,
            null,
            mainHandler
        )
    }

    private fun runAutoDetectFrame() {
        val reader = imageReader ?: return
        val image = reader.acquireLatestImage() ?: return
        try {
            val plane = image.planes[0]
            val buffer = plane.buffer
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val rowPadding = rowStride - pixelStride * image.width
            val bitmap = Bitmap.createBitmap(
                image.width + rowPadding / pixelStride,
                image.height,
                Bitmap.Config.ARGB_8888
            )
            bitmap.copyPixelsFromBuffer(buffer)
            val cropped = Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height)
            val detected = TableAutoDetector.detectFromBitmap(cropped)

            trajectoryView.updateCalibration(
                left = detected.bounds.left,
                top = detected.bounds.top,
                width = detected.bounds.width(),
                height = detected.bounds.height(),
                ballRadius = detected.estimatedBallRadius,
                cue = detected.cueBall,
                target = detected.targetBall
            )
            infoLabel.text = "${detected.estimatedTableClass} (${detected.bounds.width().toInt()}×${detected.bounds.height().toInt()})"
        } finally {
            image.close()
        }
    }

    private fun addFloatingControlBar(overlayType: Int) {
        controlBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#CC0B0F14"))
            setPadding(16, 10, 16, 10)
        }

        infoLabel = TextView(this).apply {
            text = "CueSight"
            setTextColor(Color.WHITE)
            textSize = 12f
            setPadding(0, 0, 12, 0)
        }

        val detectBtn = Button(this).apply {
            text = "Detect"
            textSize = 11f
            setOnClickListener { runAutoDetectFrame() }
        }

        val aimToggleBtn = Button(this).apply {
            text = "Aim: Off"
            textSize = 11f
            setOnClickListener {
                val enable = !trajectoryView.interactiveAimEnabled
                trajectoryView.interactiveAimEnabled = enable
                fullScreenParams.flags = if (enable) {
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                } else {
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                }
                windowManager.updateViewLayout(trajectoryView, fullScreenParams)
                text = if (enable) "Aim: On" else "Aim: Off"
            }
        }

        val bankBtn = Button(this).apply {
            text = "3x"
            textSize = 11f
            setOnClickListener {
                val count = trajectoryView.cycleRebounds()
                text = "${count}x"
            }
        }

        val hideBtn = Button(this).apply {
            text = "Hide"
            textSize = 11f
            setOnClickListener {
                trajectoryView.visibility =
                    if (trajectoryView.visibility == View.VISIBLE) View.GONE else View.VISIBLE
                text = if (trajectoryView.visibility == View.VISIBLE) "Hide" else "Show"
            }
        }

        controlBar.addView(infoLabel)
        controlBar.addView(detectBtn)
        controlBar.addView(aimToggleBtn)
        controlBar.addView(bankBtn)
        controlBar.addView(hideBtn)

        val barParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 32
            y = 90
        }

        var startX = 0
        var startY = 0
        var touchX = 0f
        var touchY = 0f

        controlBar.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    startX = barParams.x
                    startY = barParams.y
                    touchX = event.rawX
                    touchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    barParams.x = startX + (event.rawX - touchX).toInt()
                    barParams.y = startY + (event.rawY - touchY).toInt()
                    windowManager.updateViewLayout(controlBar, barParams)
                    true
                }
                else -> false
            }
        }

        windowManager.addView(controlBar, barParams)
    }

    private fun startForegroundNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "CueSight Overlay Service",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("CueSight Pool Overlay")
            .setContentText("Aiming lines & auto-table calibration active")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(101, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(101, notification)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        virtualDisplay?.release()
        imageReader?.close()
        mediaProjection?.stop()
        if (::trajectoryView.isInitialized) windowManager.removeView(trajectoryView)
        if (::controlBar.isInitialized) windowManager.removeView(controlBar)
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
