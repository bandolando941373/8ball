export interface KotlinSourceFile {
  id: string;
  filename: string;
  path: string;
  language: 'xml' | 'kotlin' | 'gradle' | 'yaml';
  description: string;
  code: string;
}

export const ANDROID_KOTLIN_FILES: KotlinSourceFile[] = [
  {
    id: 'overlay-service',
    filename: 'PoolOverlayService.kt',
    path: 'android-project/app/src/main/java/com/cuesight/overlay/PoolOverlayService.kt',
    language: 'kotlin',
    description: 'Floating overlay service with Detect, Live Auto-Track, and Lock to Shoot (FLAG_NOT_TOUCHABLE) so you can shoot on the underlying pool game while lines stay visible.',
    code: `package com.cuesight.overlay

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
    private lateinit var lockBtn: Button
    private lateinit var liveBtn: Button

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    private var isLockedForShooting = false
    private var isLiveTracking = false

    private val liveDetectRunnable = object : Runnable {
        override fun run() {
            if (isLiveTracking && !isLockedForShooting) {
                runAutoDetectFrame()
                mainHandler.postDelayed(this, 750L)
            }
        }
    }

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
                    isLiveTracking = false
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
                label = detected.estimatedTableClass,
                cue = detected.cueBall,
                target = detected.targetBall
            )
            infoLabel.text = detected.estimatedTableClass
        } finally {
            image.close()
        }
    }

    private fun toggleLockForShooting() {
        isLockedForShooting = !isLockedForShooting
        trajectoryView.setLockedForShooting(isLockedForShooting)

        fullScreenParams.flags = if (isLockedForShooting) {
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
        } else {
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
        }
        windowManager.updateViewLayout(trajectoryView, fullScreenParams)

        if (isLockedForShooting) {
            lockBtn.text = "LOCKED · Shoot"
            lockBtn.setBackgroundColor(Color.parseColor("#10B981"))
            lockBtn.setTextColor(Color.parseColor("#0B0F14"))
        } else {
            lockBtn.text = "Lock to Shoot"
            lockBtn.setBackgroundColor(Color.parseColor("#38BDF8"))
            lockBtn.setTextColor(Color.parseColor("#0B0F14"))
            if (isLiveTracking) {
                mainHandler.removeCallbacks(liveDetectRunnable)
                mainHandler.post(liveDetectRunnable)
            }
        }
    }

    private fun addFloatingControlBar(overlayType: Int) {
        controlBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#DD0B0F14"))
            setPadding(14, 10, 14, 10)
        }

        infoLabel = TextView(this).apply {
            text = "CueSight"
            setTextColor(Color.WHITE)
            textSize = 11f
            setPadding(0, 0, 10, 0)
        }

        val detectBtn = Button(this).apply {
            text = "Detect"
            textSize = 11f
            setOnClickListener { runAutoDetectFrame() }
        }

        liveBtn = Button(this).apply {
            text = "Live: Off"
            textSize = 11f
            setOnClickListener {
                isLiveTracking = !isLiveTracking
                text = if (isLiveTracking) "Live: On" else "Live: Off"
                mainHandler.removeCallbacks(liveDetectRunnable)
                if (isLiveTracking && !isLockedForShooting) {
                    mainHandler.post(liveDetectRunnable)
                }
            }
        }

        lockBtn = Button(this).apply {
            text = "Lock to Shoot"
            textSize = 11f
            setBackgroundColor(Color.parseColor("#38BDF8"))
            setTextColor(Color.parseColor("#0B0F14"))
            setOnClickListener { toggleLockForShooting() }
        }

        val bankBtn = Button(this).apply {
            text = "3x"
            textSize = 11f
            setOnClickListener {
                val count = trajectoryView.cycleRebounds()
                text = "\${count}x"
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
        controlBar.addView(liveBtn)
        controlBar.addView(lockBtn)
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
            x = 24
            y = 70
        }

        var startX = 0; var startY = 0; var touchX = 0f; var touchY = 0f
        controlBar.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> { startX = barParams.x; startY = barParams.y; touchX = event.rawX; touchY = event.rawY; true }
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
            val channel = NotificationChannel(CHANNEL_ID, "CueSight Overlay Service", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("CueSight Pool Overlay")
            .setContentText("Tap Lock to Shoot to pass touches through to your pool game")
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
        isLiveTracking = false
        mainHandler.removeCallbacks(liveDetectRunnable)
        virtualDisplay?.release(); imageReader?.close(); mediaProjection?.stop()
        if (::trajectoryView.isInitialized) windowManager.removeView(trajectoryView)
        if (::controlBar.isInitialized) windowManager.removeView(controlBar)
    }

    override fun onBind(intent: Intent?): IBinder? = null
}`,
  },
  {
    id: 'main-activity',
    filename: 'MainActivity.kt',
    path: 'android-project/app/src/main/java/com/cuesight/overlay/MainActivity.kt',
    language: 'kotlin',
    description: 'Requests Display Over Other Apps and MediaProjection permissions, then launches PoolOverlayService.',
    code: `package com.cuesight.overlay

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
                "Overlay active! Open your pool app:\\n" +
                "1. Tap Detect (or Live: On) to auto-detect table size & cue ball.\\n" +
                "2. Drag the aim line if needed.\\n" +
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
            text = "1. Grant Display Over Other Apps & Screen Capture.\\n" +
                   "2. Open any pool game and tap Detect on the floating bar.\\n" +
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
            val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
            startActivity(intent)
            statusText.text = "Enable 'Display over other apps', then return and tap Start Pool Overlay."
            return
        }

        val mediaProjectionManager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projectionLauncher.launch(mediaProjectionManager.createScreenCaptureIntent())
    }
}`,
  },
  {
    id: 'auto-detector',
    filename: 'TableAutoDetector.kt',
    path: 'android-project/app/src/main/java/com/cuesight/overlay/TableAutoDetector.kt',
    language: 'kotlin',
    description: 'Fast bulk-pixel MediaProjection analyzer that computes table dimensions, size class, cue ball, and target ball in ~15ms.',
    code: `package com.cuesight.overlay

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PointF
import android.graphics.RectF
import kotlin.math.max
import kotlin.math.min

data class DetectedTable(
    val bounds: RectF,
    val aspectRatio: Float,
    val estimatedBallRadius: Float,
    val estimatedTableClass: String,
    val cueBall: PointF?,
    val targetBall: PointF?
)

object TableAutoDetector {

    fun detectFromBitmap(frame: Bitmap): DetectedTable {
        val w = frame.width
        val h = frame.height
        val pixels = IntArray(w * h)
        frame.getPixels(pixels, 0, w, 0, 0, w, h)

        val step = max(2, min(w, h) / 180)
        val feltColor = findDominantFeltColor(pixels, w, h, step)
        val fR = Color.red(feltColor); val fG = Color.green(feltColor); val fB = Color.blue(feltColor)

        val sw = w / step; val sh = h / step
        val rowHits = IntArray(sh); val colHits = IntArray(sw)
        val feltMask = BooleanArray(sw * sh)
        val maxDistSq = 48 * 48

        for (sy in 0 until sh) {
            val yRowOffset = sy * step * w
            for (sx in 0 until sw) {
                val pixel = pixels[yRowOffset + sx * step]
                val dr = Color.red(pixel) - fR; val dg = Color.green(pixel) - fG; val db = Color.blue(pixel) - fB
                if (dr * dr + dg * dg + db * db <= maxDistSq) {
                    feltMask[sy * sw + sx] = true
                    rowHits[sy]++; colHits[sx]++
                }
            }
        }

        val (yMin, yMax) = longestSpan(rowHits, (rowHits.maxOrNull() ?: 0) * 0.48f)
        val (xMin, xMax) = longestSpan(colHits, (colHits.maxOrNull() ?: 0) * 0.48f)

        val left = (xMin * step).toFloat(); val top = (yMin * step).toFloat()
        val width = max(120f, ((xMax - xMin) * step).toFloat())
        val height = max(80f, ((yMax - yMin) * step).toFloat())

        val longSide = max(width, height); val shortSide = max(1f, min(width, height))
        val ratio = longSide / shortSide
        val ballRadius = (longSide / 46f).coerceIn(8f, 30f)

        val tableClass = when {
            ratio > 2.15f -> "10 ft Snooker"
            longSide / (ballRadius * 2f) >= 34f -> "9 ft Pro"
            longSide / (ballRadius * 2f) >= 25f -> "8 ft Home"
            else -> "7 ft Bar"
        }

        val inset = max(2, (ballRadius / step).toInt())
        val minSx = max(0, xMin + inset); val maxSx = min(sw - 1, xMax - inset)
        val minSy = max(0, yMin + inset); val maxSy = min(sh - 1, yMax - inset)

        val visited = BooleanArray(sw * sh); val queue = IntArray(sw * sh)
        val minArea = max(4, ((Math.PI * (ballRadius / step) * (ballRadius / step)) * 0.3).toInt())
        val maxArea = max(24, ((Math.PI * (ballRadius / step) * (ballRadius / step)) * 3.2).toInt())

        data class Blob(val x: Float, val y: Float, val lum: Float)
        val blobs = ArrayList<Blob>()

        for (sy in minSy..maxSy) {
            for (sx in minSx..maxSx) {
                val startIdx = sy * sw + sx
                if (feltMask[startIdx] || visited[startIdx]) continue

                var head = 0; var tail = 0
                queue[tail++] = startIdx; visited[startIdx] = true

                var sumX = 0f; var sumY = 0f; var count = 0; var lumSum = 0f
                var minBX = sx; var maxBX = sx; var minBY = sy; var maxBY = sy

                while (head < tail) {
                    val cur = queue[head++]; val cx = cur % sw; val cy = cur / sw
                    sumX += cx; sumY += cy; count++
                    if (cx < minBX) minBX = cx; if (cx > maxBX) maxBX = cx
                    if (cy < minBY) minBY = cy; if (cy > maxBY) maxBY = cy

                    val px = pixels[cy * step * w + cx * step]
                    lumSum += 0.299f * Color.red(px) + 0.587f * Color.green(px) + 0.114f * Color.blue(px)

                    if (cx > minSx && !feltMask[cur - 1] && !visited[cur - 1]) { visited[cur - 1] = true; queue[tail++] = cur - 1 }
                    if (cx < maxSx && !feltMask[cur + 1] && !visited[cur + 1]) { visited[cur + 1] = true; queue[tail++] = cur + 1 }
                    if (cy > minSy && !feltMask[cur - sw] && !visited[cur - sw]) { visited[cur - sw] = true; queue[tail++] = cur - sw }
                    if (cy < maxSy && !feltMask[cur + sw] && !visited[cur + sw]) { visited[cur + sw] = true; queue[tail++] = cur + sw }
                }

                if (count in minArea..maxArea) {
                    val bw = max(1, maxBX - minBX + 1); val bh = max(1, maxBY - minBY + 1)
                    val aspect = max(bw, bh).toFloat() / min(bw, bh).toFloat()
                    if (aspect <= 1.7f) {
                        val avgLum = lumSum / count
                        if (avgLum > 45f) blobs.add(Blob((sumX / count) * step, (sumY / count) * step, avgLum))
                    }
                }
            }
        }

        blobs.sortByDescending { it.lum }
        return DetectedTable(
            bounds = RectF(left, top, left + width, top + height),
            aspectRatio = ratio,
            estimatedBallRadius = ballRadius,
            estimatedTableClass = tableClass,
            cueBall = blobs.firstOrNull()?.let { PointF(it.x, it.y) },
            targetBall = blobs.getOrNull(1)?.let { PointF(it.x, it.y) }
        )
    }

    private fun findDominantFeltColor(pixels: IntArray, w: Int, h: Int, step: Int): Int {
        val bins = HashMap<Int, IntArray>()
        for (y in (h * 0.2).toInt() until (h * 0.8).toInt() step step) {
            val rowOffset = y * w
            for (x in (w * 0.2).toInt() until (w * 0.8).toInt() step step) {
                val c = pixels[rowOffset + x]
                val r = Color.red(c); val g = Color.green(c); val b = Color.blue(c)
                val key = ((r shr 4) shl 8) or ((g shr 4) shl 4) or (b shr 4)
                val acc = bins.getOrPut(key) { IntArray(4) }
                acc[0] += 1; acc[1] += r; acc[2] += g; acc[3] += b
            }
        }
        val best = bins.values.maxByOrNull { it[0] } ?: return Color.rgb(15, 81, 50)
        return Color.rgb(best[1] / best[0], best[2] / best[0], best[3] / best[0])
    }

    private fun longestSpan(hits: IntArray, threshold: Float): Pair<Int, Int> {
        var bestStart = 0; var bestEnd = hits.lastIndex; var bestLen = 0
        var curStart = -1; var gap = 0
        for (i in hits.indices) {
            if (hits[i] >= threshold) {
                if (curStart == -1) curStart = i
                gap = 0
                if (i - curStart + 1 > bestLen) { bestLen = i - curStart + 1; bestStart = curStart; bestEnd = i }
            } else if (curStart != -1 && ++gap > 4) { curStart = -1; gap = 0 }
        }
        return bestStart to bestEnd
    }
}`,
  },
  {
    id: 'trajectory-view',
    filename: 'TrajectoryOverlayView.kt',
    path: 'android-project/app/src/main/java/com/cuesight/overlay/TrajectoryOverlayView.kt',
    language: 'kotlin',
    description: 'Draws extended aiming lines, 6 pocket alignment rings, ghost-ball contact, 90° tangent line, and multi-cushion rebounds.',
    code: `package com.cuesight.overlay

import android.content.Context
import android.graphics.*
import android.view.MotionEvent
import android.view.View
import kotlin.math.*

class TrajectoryOverlayView(context: Context) : View(context) {

    private var tableBounds = RectF(160f, 140f, 1120f, 620f)
    private var tableLabel = "9 ft Pro"
    private var ballRadius = 18f
    private var maxRebounds = 3
    private var englishSpin = 0f

    var isEditingOverlay = true
        private set

    private var cuePos = PointF(360f, 380f)
    private var targetPos: PointF? = PointF(760f, 280f)
    private var aimDir = PointF(0.95f, -0.31f)
    private var draggingMode = 0

    private val aimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#38BDF8"); strokeWidth = 4.5f; style = Paint.Style.STROKE
        pathEffect = DashPathEffect(floatArrayOf(18f, 9f), 0f)
    }
    private val reboundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#F59E0B"); strokeWidth = 3.5f; style = Paint.Style.STROKE
    }
    private val objPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#10B981"); strokeWidth = 4.5f; style = Paint.Style.STROKE
    }
    private val tangentPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#A78BFA"); strokeWidth = 2.5f; style = Paint.Style.STROKE
        pathEffect = DashPathEffect(floatArrayOf(8f, 6f), 0f)
    }
    private val ghostPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#E2E8F0"); strokeWidth = 2.5f; style = Paint.Style.STROKE
        pathEffect = DashPathEffect(floatArrayOf(6f, 4f), 0f)
    }
    private val boundsPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#8810B981"); strokeWidth = 2.5f; style = Paint.Style.STROKE
    }
    private val pocketPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#8834D399"); strokeWidth = 2f; style = Paint.Style.STROKE
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE; textSize = 24f; typeface = Typeface.MONOSPACE
    }
    private val badgeBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#CC0B0F14"); style = Paint.Style.FILL
    }

    fun setLockedForShooting(locked: Boolean) {
        isEditingOverlay = !locked
        invalidate()
    }

    fun updateCalibration(
        left: Float, top: Float, width: Float, height: Float,
        ballRadius: Float, label: String, cue: PointF?, target: PointF?
    ) {
        this.tableBounds = RectF(left, top, left + width, top + height)
        this.ballRadius = ballRadius
        this.tableLabel = label
        if (cue != null) cuePos.set(cue.x, cue.y) else cuePos.set(left + width * 0.28f, top + height * 0.5f)
        if (target != null) {
            targetPos = PointF(target.x, target.y)
            val dx = target.x - cuePos.x; val dy = target.y - cuePos.y
            val len = hypot(dx, dy).coerceAtLeast(1e-4f)
            aimDir.set(dx / len, dy / len)
        }
        invalidate()
    }

    fun cycleRebounds(): Int {
        maxRebounds = (maxRebounds % 4) + 1
        invalidate()
        return maxRebounds
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!isEditingOverlay) return false
        val x = event.x; val y = event.y
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                val cueDist = hypot(x - cuePos.x, y - cuePos.y)
                val tgtDist = targetPos?.let { hypot(x - it.x, y - it.y) } ?: Float.MAX_VALUE
                draggingMode = when {
                    cueDist < ballRadius * 3f -> 1
                    tgtDist < ballRadius * 3f -> 2
                    else -> {
                        val dx = x - cuePos.x; val dy = y - cuePos.y
                        val len = hypot(dx, dy).coerceAtLeast(1e-4f)
                        aimDir.set(dx / len, dy / len)
                        invalidate(); 3
                    }
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                when (draggingMode) {
                    1 -> cuePos.set(
                        x.coerceIn(tableBounds.left + ballRadius, tableBounds.right - ballRadius),
                        y.coerceIn(tableBounds.top + ballRadius, tableBounds.bottom - ballRadius)
                    )
                    2 -> targetPos?.set(
                        x.coerceIn(tableBounds.left + ballRadius, tableBounds.right - ballRadius),
                        y.coerceIn(tableBounds.top + ballRadius, tableBounds.bottom - ballRadius)
                    )
                    3 -> {
                        val dx = x - cuePos.x; val dy = y - cuePos.y
                        val len = hypot(dx, dy).coerceAtLeast(1e-4f)
                        aimDir.set(dx / len, dy / len)
                    }
                }
                invalidate(); return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { draggingMode = 0; return true }
        }
        return false
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawRect(tableBounds, boundsPaint)
        for (p in getPocketPoints()) canvas.drawCircle(p.x, p.y, ballRadius * 1.5f, pocketPaint)

        val lockText = if (isEditingOverlay) "EDIT" else "LOCKED · SHOOT"
        val dimText = "$tableLabel · \${tableBounds.width().toInt()}×\${tableBounds.height().toInt()} px · $lockText"
        val tw = textPaint.measureText(dimText) + 20f
        val labelTop = max(0f, tableBounds.top - 36f)
        canvas.drawRect(tableBounds.left, labelTop, tableBounds.left + tw, labelTop + 32f, badgeBgPaint)
        canvas.drawText(dimText, tableBounds.left + 10f, labelTop + 23f, textPaint)

        if (isEditingOverlay) {
            canvas.drawCircle(cuePos.x, cuePos.y, ballRadius + 5f, aimPaint)
            targetPos?.let { canvas.drawCircle(it.x, it.y, ballRadius + 5f, objPaint) }
        }

        val minX = tableBounds.left + ballRadius; val maxX = tableBounds.right - ballRadius
        val minY = tableBounds.top + ballRadius; val maxY = tableBounds.bottom - ballRadius
        var ox = cuePos.x; var oy = cuePos.y; var dx = aimDir.x; var dy = aimDir.y; var spin = englishSpin

        for (bounce in 0..maxRebounds) {
            val tx = when { dx < -1e-4f -> (minX - ox) / dx; dx > 1e-4f -> (maxX - ox) / dx; else -> Float.MAX_VALUE }
            val ty = when { dy < -1e-4f -> (minY - oy) / dy; dy > 1e-4f -> (maxY - oy) / dy; else -> Float.MAX_VALUE }
            val hitXFirst = tx < ty; val wallT = min(tx, ty)
            if (wallT <= 0f || wallT == Float.MAX_VALUE) break

            val tgt = targetPos
            if (tgt != null) {
                val ocX = tgt.x - ox; val ocY = tgt.y - oy; val proj = ocX * dx + ocY * dy
                val combR = ballRadius * 2f; val perpSq = (ocX * ocX + ocY * ocY) - proj * proj
                if (proj > 0f && perpSq < combR * combR) {
                    val tHit = proj - sqrt(combR * combR - perpSq)
                    if (tHit > 1f && tHit <= wallT) {
                        val gx = ox + dx * tHit; val gy = oy + dy * tHit
                        canvas.drawLine(ox, oy, gx, gy, if (bounce == 0) aimPaint else reboundPaint)
                        canvas.drawCircle(gx, gy, ballRadius, ghostPaint)

                        val odx = tgt.x - gx; val ody = tgt.y - gy
                        val olen = hypot(odx, ody).coerceAtLeast(1e-4f)
                        val ndx = odx / olen; val ndy = ody / olen

                        val perpAx = -ndy; val perpAy = ndx; val perpBx = ndy; val perpBy = -ndx
                        val dotA = perpAx * dx + perpAy * dy
                        val txDir = if (dotA >= 0f) perpAx else perpBx
                        val tyDir = if (dotA >= 0f) perpAy else perpBy
                        canvas.drawLine(gx, gy, gx + txDir * 140f, gy + tyDir * 140f, tangentPaint)

                        traceObjectPath(canvas, tgt.x, tgt.y, ndx, ndy, minX, maxX, minY, maxY)
                        return
                    }
                }
            }

            val nx = ox + dx * wallT; val ny = oy + dy * wallT
            canvas.drawLine(ox, oy, nx, ny, if (bounce == 0) aimPaint else reboundPaint)
            if (bounce == maxRebounds) break

            val cosInc = abs(if (hitXFirst) dx else dy).coerceIn(0f, 1f)
            val angleDeg = Math.toDegrees(acos(cosInc.toDouble())).toFloat()
            canvas.drawText(String.format("B%d %.0f°", bounce + 1, angleDeg), nx + 8f, ny - 8f, textPaint)

            val rx = if (hitXFirst) -dx else dx; val ry = if (hitXFirst) dy else -dy
            val spinRad = Math.toRadians((spin * 14f).toDouble()).toFloat()
            val cosS = cos(spinRad); val sinS = sin(spinRad)
            dx = rx * cosS - ry * sinS; dy = rx * sinS + ry * cosS
            spin *= 0.55f; ox = nx; oy = ny
        }
    }

    private fun getPocketPoints(): List<PointF> {
        val isLand = tableBounds.width() >= tableBounds.height()
        val x0 = tableBounds.left; val y0 = tableBounds.top
        val x1 = tableBounds.right; val y1 = tableBounds.bottom
        val xm = (x0 + x1) * 0.5f; val ym = (y0 + y1) * 0.5f
        return if (isLand) {
            listOf(PointF(x0, y0), PointF(xm, y0), PointF(x1, y0), PointF(x0, y1), PointF(xm, y1), PointF(x1, y1))
        } else {
            listOf(PointF(x0, y0), PointF(x1, y0), PointF(x0, ym), PointF(x1, ym), PointF(x0, y1), PointF(x1, y1))
        }
    }

    private fun traceObjectPath(
        canvas: Canvas, startX: Float, startY: Float, startDx: Float, startDy: Float,
        minX: Float, maxX: Float, minY: Float, maxY: Float
    ) {
        var ox = startX; var oy = startY; var dx = startDx; var dy = startDy
        for (b in 0..min(2, maxRebounds)) {
            val tx = when { dx < -1e-4f -> (minX - ox) / dx; dx > 1e-4f -> (maxX - ox) / dx; else -> Float.MAX_VALUE }
            val ty = when { dy < -1e-4f -> (minY - oy) / dy; dy > 1e-4f -> (maxY - oy) / dy; else -> Float.MAX_VALUE }
            val hitXFirst = tx < ty; val t = min(tx, ty)
            if (t <= 0f || t == Float.MAX_VALUE) break
            val nx = ox + dx * t; val ny = oy + dy * t
            canvas.drawLine(ox, oy, nx, ny, objPaint)
            if (b == min(2, maxRebounds)) break
            dx = if (hitXFirst) -dx else dx; dy = if (hitXFirst) dy else -dy
            ox = nx; oy = ny
        }
    }
}`,
  },
  {
    id: 'buddy-ci',
    filename: 'buddy.yml',
    path: 'buddy.yml',
    language: 'yaml',
    description: 'Buddy CI/CD pipeline configuration that installs Android SDK 34 + Gradle 8.7 and outputs CueSight-Overlay.apk.',
    code: `- pipeline: "Build CueSight Android APK"
  events:
    - type: PUSH
      refs:
        - "refs/heads/main"
        - "refs/heads/master"
  actions:
    - action: "Build CueSight-Overlay.apk"
      type: "BUILD"
      docker_image_name: "library/eclipse-temurin"
      docker_image_tag: "17-jdk"
      shell: "BASH"
      commands:
        - "apt-get update -qq && apt-get install -y -qq curl unzip > /dev/null"
        - "mkdir -p /opt/android-sdk/cmdline-tools /opt/gradle"
        - "curl -fsSL -o /tmp/cmdline.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip && unzip -q -o /tmp/cmdline.zip -d /opt/android-sdk/cmdline-tools && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest"
        - "curl -fsSL -o /tmp/gradle.zip https://services.gradle.org/distributions/gradle-8.7-bin.zip && unzip -q -o /tmp/gradle.zip -d /opt/gradle"
        - "export ANDROID_HOME=/opt/android-sdk"
        - "export PATH=/opt/gradle/gradle-8.7/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
        - "yes | sdkmanager --licenses > /dev/null 2>&1 || true"
        - "sdkmanager \\"platform-tools\\" \\"platforms;android-34\\" \\"build-tools;34.0.0\\" > /dev/null"
        - "ROOT_DIR=$PWD; if [ -f android-project/settings.gradle.kts ]; then cd android-project; fi"
        - "gradle assembleDebug --no-daemon"
        - "cp app/build/outputs/apk/debug/app-debug.apk \\"$ROOT_DIR/CueSight-Overlay.apk\\""
      cached_dirs:
        - "/root/.gradle"`,
  },
];
