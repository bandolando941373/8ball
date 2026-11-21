package com.cuesight.overlay

import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicBoolean

class ScreenCaptureManager(
    private val mediaProjection: MediaProjection,
    private val onFrameCaptured: (rgbaData: ByteArray, width: Int, height: Int) -> Unit,
    private val onProjectionStopped: () -> Unit
) {
    companion object {
        private const val MIN_FRAME_INTERVAL_MS = 55L // ~18 FPS throttle
    }

    private val captureThread = HandlerThread(
        "CueSightCaptureThread",
        Process.THREAD_PRIORITY_BACKGROUND
    ).apply { start() }

    private val captureHandler = Handler(captureThread.looper)
    private val isProcessing = AtomicBoolean(false)
    private val isReleased = AtomicBoolean(false)

    private var imageReader: ImageReader? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var reusableRgbaBuffer: ByteArray? = null
    private var lastFrameTimestampMs = 0L

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            if (!isReleased.get()) {
                onProjectionStopped()
            }
        }
    }

    fun start(width: Int, height: Int, densityDpi: Int) {
        if (isReleased.get() || width <= 0 || height <= 0) return

        mediaProjection.registerCallback(projectionCallback, captureHandler)
        captureHandler.post {
            if (!isReleased.get()) {
                createCapturePipeline(width, height, densityDpi)
            }
        }
    }

    fun resize(width: Int, height: Int, densityDpi: Int) {
        if (isReleased.get() || width <= 0 || height <= 0) return
        captureHandler.post {
            if (isReleased.get()) return@post
            virtualDisplay?.release()
            virtualDisplay = null
            imageReader?.setOnImageAvailableListener(null, null)
            imageReader?.close()
            imageReader = null
            createCapturePipeline(width, height, densityDpi)
        }
    }

    private fun createCapturePipeline(width: Int, height: Int, densityDpi: Int) {
        val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        reader.setOnImageAvailableListener({ r ->
            handleImageAvailable(r)
        }, captureHandler)
        imageReader = reader

        virtualDisplay = mediaProjection.createVirtualDisplay(
            "CueSightVirtualDisplay",
            width,
            height,
            densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            captureHandler
        )
    }

    private fun handleImageAvailable(reader: ImageReader) {
        if (isReleased.get()) return

        var image: Image? = null
        var extractedBytes: ByteArray? = null
        var frameWidth = 0
        var frameHeight = 0
        var acquiredLock = false

        try {
            image = reader.acquireLatestImage() ?: return

            val now = SystemClock.elapsedRealtime()
            if (now - lastFrameTimestampMs < MIN_FRAME_INTERVAL_MS) {
                return
            }
            if (!isProcessing.compareAndSet(false, true)) {
                return
            }
            acquiredLock = true
            lastFrameTimestampMs = now

            frameWidth = image.width
            frameHeight = image.height
            extractedBytes = copyImageToTightRgba(image)
        } finally {
            image?.close()
        }

        if (acquiredLock) {
            try {
                if (extractedBytes != null && frameWidth > 0 && frameHeight > 0) {
                    onFrameCaptured(extractedBytes, frameWidth, frameHeight)
                }
            } finally {
                isProcessing.set(false)
            }
        }
    }

    private fun copyImageToTightRgba(image: Image): ByteArray {
        val plane = image.planes[0]
        val buffer = plane.buffer
        val width = image.width
        val height = image.height
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val tightRowBytes = width * 4
        val requiredSize = tightRowBytes * height

        var out = reusableRgbaBuffer
        if (out == null || out.size != requiredSize) {
            out = ByteArray(requiredSize)
            reusableRgbaBuffer = out
        }

        buffer.rewind()
        if (rowStride == tightRowBytes && pixelStride == 4) {
            buffer.get(out, 0, requiredSize)
        } else if (pixelStride == 4) {
            for (row in 0 until height) {
                buffer.position(row * rowStride)
                buffer.get(out, row * tightRowBytes, tightRowBytes)
            }
        } else {
            // Defensive fallback for unusual pixel strides
            val rowTmp = ByteArray(rowStride)
            for (row in 0 until height) {
                buffer.position(row * rowStride)
                val toRead = minOf(rowStride, buffer.remaining())
                buffer.get(rowTmp, 0, toRead)
                val dstBase = row * tightRowBytes
                for (col in 0 until width) {
                    val srcIdx = col * pixelStride
                    val dstIdx = dstBase + col * 4
                    out[dstIdx] = rowTmp[srcIdx]
                    out[dstIdx + 1] = rowTmp[srcIdx + 1]
                    out[dstIdx + 2] = rowTmp[srcIdx + 2]
                    out[dstIdx + 3] = rowTmp[srcIdx + 3]
                }
            }
        }
        return out
    }

    fun stop() {
        if (!isReleased.compareAndSet(false, true)) return

        try {
            mediaProjection.unregisterCallback(projectionCallback)
        } catch (_: Throwable) {
        }

        captureHandler.post {
            try {
                virtualDisplay?.release()
            } catch (_: Throwable) {
            }
            virtualDisplay = null

            try {
                imageReader?.setOnImageAvailableListener(null, null)
                imageReader?.close()
            } catch (_: Throwable) {
            }
            imageReader = null

            try {
                mediaProjection.stop()
            } catch (_: Throwable) {
            }

            reusableRgbaBuffer = null
            captureThread.quitSafely()
        }
    }
}
