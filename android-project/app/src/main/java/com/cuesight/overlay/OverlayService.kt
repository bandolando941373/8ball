package com.cuesight.overlay

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import com.cuesight.overlay.databinding.OverlayControlsBinding

class OverlayService : Service() {

    companion object {
        const val ACTION_START = "com.cuesight.overlay.ACTION_START"
        const val ACTION_STOP = "com.cuesight.overlay.ACTION_STOP"
        const val ACTION_UPDATE_CONFIG = "com.cuesight.overlay.ACTION_UPDATE_CONFIG"
        const val ACTION_STATE_CHANGED = "com.cuesight.overlay.ACTION_STATE_CHANGED"

        const val EXTRA_RESULT_CODE = "extra_result_code"
        const val EXTRA_RESULT_DATA = "extra_result_data"
        const val EXTRA_MAX_BOUNCES = "extra_max_bounces"
        const val EXTRA_BALL_RADIUS = "extra_ball_radius"
        const val EXTRA_FELT_COLOR = "extra_felt_color"

        private const val NOTIFICATION_CHANNEL_ID = "cuesight_media_projection_channel"
        private const val NOTIFICATION_ID = 1001

        @Volatile
        var isRunning: Boolean = false
            private set
    }

    private lateinit var windowManager: WindowManager
    private lateinit var trajectoryView: TrajectoryOverlayView
    private lateinit var controlsBinding: OverlayControlsBinding
    private lateinit var controlsParams: WindowManager.LayoutParams

    private val mainHandler = Handler(Looper.getMainLooper())
    private val visionProcessor = PoolVisionProcessor()
    private var captureManager: ScreenCaptureManager? = null

    @Volatile
    private var maxBounces: Int = 3

    @Volatile
    private var ballRadiusOffsetPx: Float = 18f

    @Volatile
    private var feltColor: PoolVisionProcessor.FeltColor = PoolVisionProcessor.FeltColor.GREEN

    @Volatile
    private var isLocked: Boolean = false

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        attachTrajectoryOverlay()
        attachFloatingControls()
        notifyStateChanged()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_UPDATE_CONFIG -> {
                applyConfigFromIntent(intent)
                return START_NOT_STICKY
            }
        }

        startCompliantForegroundNotification()
        applyConfigFromIntent(intent)

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
            ?: Activity.RESULT_CANCELED
        @Suppress("DEPRECATION")
        val data = intent?.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)

        if (resultCode == Activity.RESULT_OK && data != null && captureManager == null) {
            val mgr = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            val projection = mgr.getMediaProjection(resultCode, data)
            if (projection != null) {
                val (w, h, dpi) = currentDisplaySize()
                captureManager = ScreenCaptureManager(
                    mediaProjection = projection,
                    onFrameCaptured = { rgbaData, frameW, frameH ->
                        if (isLocked) return@ScreenCaptureManager
                        val result = visionProcessor.processRgbaFrame(
                            rgbaData = rgbaData,
                            width = frameW,
                            height = frameH,
                            feltColor = feltColor,
                            ballRadiusOffsetPx = ballRadiusOffsetPx
                        )
                        mainHandler.post {
                            if (!isLocked) {
                                trajectoryView.updateVision(result)
                            }
                        }
                    },
                    onProjectionStopped = {
                        mainHandler.post { stopSelf() }
                    }
                ).also { it.start(w, h, dpi) }
            }
        }

        return START_NOT_STICKY
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val (w, h, dpi) = currentDisplaySize()
        captureManager?.resize(w, h, dpi)
    }

    private fun applyConfigFromIntent(intent: Intent?) {
        if (intent == null) return
        if (intent.hasExtra(EXTRA_MAX_BOUNCES)) {
            maxBounces = intent.getIntExtra(EXTRA_MAX_BOUNCES, maxBounces).coerceIn(1, 4)
            mainHandler.post { trajectoryView.setMaxBounces(maxBounces) }
        }
        if (intent.hasExtra(EXTRA_BALL_RADIUS)) {
            ballRadiusOffsetPx = intent.getFloatExtra(EXTRA_BALL_RADIUS, ballRadiusOffsetPx).coerceIn(8f, 40f)
        }
        if (intent.hasExtra(EXTRA_FELT_COLOR)) {
            val rawColor = intent.getStringExtra(EXTRA_FELT_COLOR)
            feltColor = runCatching {
                PoolVisionProcessor.FeltColor.valueOf(rawColor ?: feltColor.name)
            }.getOrDefault(feltColor)
        }
    }

    private fun attachTrajectoryOverlay() {
        trajectoryView = TrajectoryOverlayView(this).apply {
            setMaxBounces(maxBounces)
        }

        val overlayParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }

        windowManager.addView(trajectoryView, overlayParams)
    }

    private fun attachFloatingControls() {
        controlsBinding = OverlayControlsBinding.inflate(LayoutInflater.from(this))

        controlsParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 32
            y = 120
        }

        val dragListener = object : View.OnTouchListener {
            private var startX = 0
            private var startY = 0
            private var touchX = 0f
            private var touchY = 0f

            override fun onTouch(v: View?, event: MotionEvent): Boolean {
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        startX = controlsParams.x
                        startY = controlsParams.y
                        touchX = event.rawX
                        touchY = event.rawY
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        controlsParams.x = startX + (event.rawX - touchX).toInt()
                        controlsParams.y = startY + (event.rawY - touchY).toInt()
                        windowManager.updateViewLayout(controlsBinding.root, controlsParams)
                        return true
                    }
                }
                return false
            }
        }

        controlsBinding.floatingRoot.setOnTouchListener(dragListener)
        controlsBinding.tvDragHandle.setOnTouchListener(dragListener)

        controlsBinding.btnLockToggle.setOnClickListener {
            isLocked = !isLocked
            trajectoryView.setLocked(isLocked)
            updateLockButtonUi()
        }

        controlsBinding.btnCloseOverlay.setOnClickListener {
            stopSelf()
        }

        updateLockButtonUi()
        windowManager.addView(controlsBinding.root, controlsParams)
    }

    private fun updateLockButtonUi() {
        if (isLocked) {
            controlsBinding.btnLockToggle.text = "UNLOCK"
            controlsBinding.btnLockToggle.backgroundTintList =
                ColorStateList.valueOf(Color.parseColor("#10B981"))
            controlsBinding.btnLockToggle.setTextColor(Color.parseColor("#0B0F14"))
            controlsBinding.tvDragHandle.text = "⋮⋮ LOCKED"
        } else {
            controlsBinding.btnLockToggle.text = "LOCK"
            controlsBinding.btnLockToggle.backgroundTintList =
                ColorStateList.valueOf(Color.parseColor("#38BDF8"))
            controlsBinding.btnLockToggle.setTextColor(Color.parseColor("#0B0F14"))
            controlsBinding.tvDragHandle.text = "⋮⋮ CueSight"
        }
    }

    private fun startCompliantForegroundNotification() {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "CueSight Screen Capture Overlay",
                NotificationManager.IMPORTANCE_LOW
            )
            manager.createNotificationChannel(channel)
        }

        val notification: Notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("CueSight Overlay Active")
            .setContentText("Tap LOCK on the floating widget to freeze trajectory before shooting.")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun currentDisplaySize(): Triple<Int, Int, Int> {
        val dpi = resources.displayMetrics.densityDpi
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = windowManager.currentWindowMetrics.bounds
            Triple(bounds.width(), bounds.height(), dpi)
        } else {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getRealMetrics(metrics)
            Triple(metrics.widthPixels, metrics.heightPixels, metrics.densityDpi)
        }
    }

    private fun notifyStateChanged() {
        sendBroadcast(Intent(ACTION_STATE_CHANGED).setPackage(packageName))
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        captureManager?.stop()
        captureManager = null

        if (::trajectoryView.isInitialized) {
            runCatching { windowManager.removeView(trajectoryView) }
        }
        if (::controlsBinding.isInitialized) {
            runCatching { windowManager.removeView(controlsBinding.root) }
        }
        notifyStateChanged()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
