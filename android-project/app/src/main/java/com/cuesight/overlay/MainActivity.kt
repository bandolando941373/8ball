package com.cuesight.overlay

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.cuesight.overlay.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    companion object {
        private const val PREFS_NAME = "cuesight_prefs"
        private const val KEY_MAX_BOUNCES = "max_bounces"
        private const val KEY_BALL_RADIUS = "ball_radius_px"
        private const val KEY_FELT_COLOR = "felt_color"
    }

    private lateinit var binding: ActivityMainBinding

    private var maxBounces: Int = 3
    private var ballRadiusPx: Float = 18f
    private var feltColor: PoolVisionProcessor.FeltColor = PoolVisionProcessor.FeltColor.GREEN

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshStatusUi()
        }
    }

    private val notificationPermLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        launchMediaProjectionPrompt()
    }

    private val mediaProjectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            val serviceIntent = Intent(this, OverlayService::class.java).apply {
                action = OverlayService.ACTION_START
                putExtra(OverlayService.EXTRA_RESULT_CODE, result.resultCode)
                putExtra(OverlayService.EXTRA_RESULT_DATA, result.data)
                putExtra(OverlayService.EXTRA_MAX_BOUNCES, maxBounces)
                putExtra(OverlayService.EXTRA_BALL_RADIUS, ballRadiusPx)
                putExtra(OverlayService.EXTRA_FELT_COLOR, feltColor.name)
            }
            ContextCompat.startForegroundService(this, serviceIntent)
            binding.tvCaptureStatus.text = "Active (MediaProjection granted)"
            binding.tvCaptureStatus.setTextColor(Color.parseColor("#10B981"))
        } else {
            binding.tvCaptureStatus.text = "Screen capture request cancelled"
            binding.tvCaptureStatus.setTextColor(Color.parseColor("#F59E0B"))
        }
        refreshStatusUi()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        loadSavedConfig()
        setupControls()
        refreshStatusUi()
    }

    override fun onStart() {
        super.onStart()
        ContextCompat.registerReceiver(
            this,
            stateReceiver,
            IntentFilter(OverlayService.ACTION_STATE_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        refreshStatusUi()
    }

    override fun onStop() {
        super.onStop()
        runCatching { unregisterReceiver(stateReceiver) }
    }

    override fun onResume() {
        super.onResume()
        refreshStatusUi()
    }

    private fun loadSavedConfig() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        maxBounces = prefs.getInt(KEY_MAX_BOUNCES, 3).coerceIn(1, 4)
        ballRadiusPx = prefs.getFloat(KEY_BALL_RADIUS, 18f).coerceIn(8f, 40f)
        val savedColor = prefs.getString(KEY_FELT_COLOR, PoolVisionProcessor.FeltColor.GREEN.name)
        feltColor = runCatching {
            PoolVisionProcessor.FeltColor.valueOf(savedColor ?: PoolVisionProcessor.FeltColor.GREEN.name)
        }.getOrDefault(PoolVisionProcessor.FeltColor.GREEN)
    }

    private fun saveConfig() {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
            .putInt(KEY_MAX_BOUNCES, maxBounces)
            .putFloat(KEY_BALL_RADIUS, ballRadiusPx)
            .putString(KEY_FELT_COLOR, feltColor.name)
            .apply()

        if (OverlayService.isRunning) {
            val updateIntent = Intent(this, OverlayService::class.java).apply {
                action = OverlayService.ACTION_UPDATE_CONFIG
                putExtra(OverlayService.EXTRA_MAX_BOUNCES, maxBounces)
                putExtra(OverlayService.EXTRA_BALL_RADIUS, ballRadiusPx)
                putExtra(OverlayService.EXTRA_FELT_COLOR, feltColor.name)
            }
            startService(updateIntent)
        }
    }

    private fun setupControls() {
        binding.btnGrantOverlay.setOnClickListener {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        }

        binding.sliderMaxBounces.value = maxBounces.toFloat()
        binding.tvMaxBouncesValue.text = formatBouncesLabel(maxBounces)
        binding.sliderMaxBounces.addOnChangeListener { _, value, _ ->
            maxBounces = value.toInt().coerceIn(1, 4)
            binding.tvMaxBouncesValue.text = formatBouncesLabel(maxBounces)
            saveConfig()
        }

        binding.sliderBallRadius.value = ballRadiusPx
        binding.tvBallRadiusValue.text = "${ballRadiusPx.toInt()} px"
        binding.sliderBallRadius.addOnChangeListener { _, value, _ ->
            ballRadiusPx = value.coerceIn(8f, 40f)
            binding.tvBallRadiusValue.text = "${ballRadiusPx.toInt()} px"
            saveConfig()
        }

        val checkedButtonId = when (feltColor) {
            PoolVisionProcessor.FeltColor.BLUE -> R.id.btnFeltBlue
            PoolVisionProcessor.FeltColor.GREEN -> R.id.btnFeltGreen
            PoolVisionProcessor.FeltColor.RED -> R.id.btnFeltRed
        }
        binding.toggleFeltColor.check(checkedButtonId)
        binding.toggleFeltColor.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            feltColor = when (checkedId) {
                R.id.btnFeltBlue -> PoolVisionProcessor.FeltColor.BLUE
                R.id.btnFeltRed -> PoolVisionProcessor.FeltColor.RED
                else -> PoolVisionProcessor.FeltColor.GREEN
            }
            saveConfig()
        }

        binding.btnToggleOverlay.setOnClickListener {
            if (OverlayService.isRunning) {
                stopService(Intent(this, OverlayService::class.java))
                refreshStatusUi()
            } else {
                beginOverlayStartFlow()
            }
        }
    }

    private fun beginOverlayStartFlow() {
        if (!Settings.canDrawOverlays(this)) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }

        launchMediaProjectionPrompt()
    }

    private fun launchMediaProjectionPrompt() {
        val mgr = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjectionLauncher.launch(mgr.createScreenCaptureIntent())
    }

    private fun refreshStatusUi() {
        val canDraw = Settings.canDrawOverlays(this)
        if (canDraw) {
            binding.tvOverlayPermStatus.text = "Granted"
            binding.tvOverlayPermStatus.setTextColor(Color.parseColor("#10B981"))
            binding.btnGrantOverlay.isEnabled = false
            binding.btnGrantOverlay.text = "Granted"
        } else {
            binding.tvOverlayPermStatus.text = "Required — Tap Grant"
            binding.tvOverlayPermStatus.setTextColor(Color.parseColor("#F59E0B"))
            binding.btnGrantOverlay.isEnabled = true
            binding.btnGrantOverlay.text = "Grant"
        }

        val running = OverlayService.isRunning
        if (running) {
            binding.tvServiceStatus.text = "Overlay Service: Running (OpenCV Active)"
            binding.tvServiceStatus.setTextColor(Color.parseColor("#10B981"))
            binding.tvCaptureStatus.text = "Active (Screen Capture Running)"
            binding.tvCaptureStatus.setTextColor(Color.parseColor("#10B981"))
            binding.btnToggleOverlay.text = "Stop Overlay"
            binding.btnToggleOverlay.backgroundTintList =
                ColorStateList.valueOf(Color.parseColor("#EF4444"))
            binding.btnToggleOverlay.setTextColor(Color.parseColor("#FFFFFF"))
        } else {
            binding.tvServiceStatus.text = "Overlay Service: Stopped"
            binding.tvServiceStatus.setTextColor(Color.parseColor("#94A3B8"))
            binding.btnToggleOverlay.text = "Start Overlay"
            binding.btnToggleOverlay.backgroundTintList =
                ColorStateList.valueOf(Color.parseColor("#38BDF8"))
            binding.btnToggleOverlay.setTextColor(Color.parseColor("#0B0F14"))
        }
    }

    private fun formatBouncesLabel(count: Int): String =
        if (count == 1) "1 bounce" else "$count bounces"
}
