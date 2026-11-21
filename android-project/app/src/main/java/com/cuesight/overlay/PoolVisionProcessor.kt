package com.cuesight.overlay

import android.graphics.PointF
import android.graphics.RectF
import android.util.Log
import org.opencv.android.OpenCVLoader
import org.opencv.core.Core
import org.opencv.core.CvType
import org.opencv.core.Mat
import org.opencv.core.MatOfPoint
import org.opencv.core.Scalar
import org.opencv.core.Size
import org.opencv.imgproc.Imgproc
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import org.opencv.core.Rect as CvRect

class PoolVisionProcessor {

    enum class FeltColor {
        BLUE, GREEN, RED
    }

    data class VisionResult(
        val tableBounds: RectF?,
        val insetBounds: RectF?,
        val cueBall: PointF?,
        val ballRadiusPx: Float,
        val launchAngleRad: Float?,
        val hasGuideline: Boolean
    )

    companion object {
        private const val TAG = "PoolVisionProcessor"
    }

    @Volatile
    private var openCvInitialized: Boolean = false

    init {
        ensureOpenCvInitialized()
    }

    @Synchronized
    fun ensureOpenCvInitialized(): Boolean {
        if (openCvInitialized) return true
        openCvInitialized = try {
            OpenCVLoader.initLocal()
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to initialize OpenCV", t)
            false
        }
        return openCvInitialized
    }

    fun processRgbaFrame(
        rgbaData: ByteArray,
        width: Int,
        height: Int,
        feltColor: FeltColor,
        ballRadiusOffsetPx: Float
    ): VisionResult {
        if (width <= 0 || height <= 0 || !ensureOpenCvInitialized()) {
            return VisionResult(null, null, null, ballRadiusOffsetPx, null, false)
        }

        val rgbaMat = Mat(height, width, CvType.CV_8UC4)
        val rgbMat = Mat()
        val hsvMat = Mat()

        try {
            rgbaMat.put(0, 0, rgbaData)
            Imgproc.cvtColor(rgbaMat, rgbMat, Imgproc.COLOR_RGBA2RGB)
            Imgproc.cvtColor(rgbMat, hsvMat, Imgproc.COLOR_RGB2HSV)

            val tableCvRect = detectTableBounds(hsvMat, width, height, feltColor)
                ?: return VisionResult(null, null, null, ballRadiusOffsetPx, null, false)

            val tableBounds = RectF(
                tableCvRect.x.toFloat(),
                tableCvRect.y.toFloat(),
                (tableCvRect.x + tableCvRect.width).toFloat(),
                (tableCvRect.y + tableCvRect.height).toFloat()
            )

            val safeInset = min(
                ballRadiusOffsetPx.coerceAtLeast(1f),
                min(tableBounds.width(), tableBounds.height()) * 0.25f
            )
            val insetBounds = RectF(
                tableBounds.left + safeInset,
                tableBounds.top + safeInset,
                tableBounds.right - safeInset,
                tableBounds.bottom - safeInset
            )

            val cueBall = detectCueBall(hsvMat, tableCvRect, ballRadiusOffsetPx)
            val launchAngleRad = if (cueBall != null) {
                detectAimingAngle(rgbMat, cueBall, tableCvRect, ballRadiusOffsetPx)
            } else {
                null
            }

            return VisionResult(
                tableBounds = tableBounds,
                insetBounds = insetBounds,
                cueBall = cueBall,
                ballRadiusPx = ballRadiusOffsetPx,
                launchAngleRad = launchAngleRad,
                hasGuideline = launchAngleRad != null
            )
        } finally {
            rgbaMat.release()
            rgbMat.release()
            hsvMat.release()
        }
    }

    private fun detectTableBounds(
        hsvMat: Mat,
        frameWidth: Int,
        frameHeight: Int,
        feltColor: FeltColor
    ): CvRect? {
        val feltMask = Mat()
        val feltMaskAlt = Mat()
        val kernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(7.0, 7.0))
        val hierarchy = Mat()
        val contours = ArrayList<MatOfPoint>()

        try {
            when (feltColor) {
                FeltColor.BLUE -> {
                    Core.inRange(hsvMat, Scalar(95.0, 70.0, 50.0), Scalar(132.0, 255.0, 255.0), feltMask)
                }
                FeltColor.GREEN -> {
                    Core.inRange(hsvMat, Scalar(36.0, 55.0, 40.0), Scalar(90.0, 255.0, 255.0), feltMask)
                }
                FeltColor.RED -> {
                    Core.inRange(hsvMat, Scalar(0.0, 75.0, 50.0), Scalar(12.0, 255.0, 255.0), feltMask)
                    Core.inRange(hsvMat, Scalar(168.0, 75.0, 50.0), Scalar(179.0, 255.0, 255.0), feltMaskAlt)
                    Core.bitwise_or(feltMask, feltMaskAlt, feltMask)
                }
            }

            Imgproc.morphologyEx(feltMask, feltMask, Imgproc.MORPH_CLOSE, kernel)
            Imgproc.morphologyEx(feltMask, feltMask, Imgproc.MORPH_OPEN, kernel)

            Imgproc.findContours(
                feltMask,
                contours,
                hierarchy,
                Imgproc.RETR_EXTERNAL,
                Imgproc.CHAIN_APPROX_SIMPLE
            )

            val minTableArea = frameWidth.toDouble() * frameHeight.toDouble() * 0.08
            var bestArea = 0.0
            var bestContour: MatOfPoint? = null

            for (contour in contours) {
                val area = Imgproc.contourArea(contour)
                if (area > minTableArea && area > bestArea) {
                    bestArea = area
                    bestContour = contour
                }
            }

            return bestContour?.let { Imgproc.boundingRect(it) }
        } finally {
            feltMask.release()
            feltMaskAlt.release()
            kernel.release()
            hierarchy.release()
            for (c in contours) {
                c.release()
            }
        }
    }

    private fun detectCueBall(
        hsvMat: Mat,
        tableRect: CvRect,
        ballRadiusOffsetPx: Float
    ): PointF? {
        if (tableRect.width < 32 || tableRect.height < 32) return null

        val roiHsv = hsvMat.submat(tableRect)
        val whiteMask = Mat()
        val blurredWhite = Mat()
        val circles = Mat()

        try {
            // High brightness (V >= 200), low saturation (S <= 55) isolates the white cue ball
            Core.inRange(
                roiHsv,
                Scalar(0.0, 0.0, 200.0),
                Scalar(179.0, 55.0, 255.0),
                whiteMask
            )
            Imgproc.GaussianBlur(whiteMask, blurredWhite, Size(9.0, 9.0), 2.0, 2.0)

            val minRadius = max(6, (ballRadiusOffsetPx * 0.65f).roundToInt())
            val maxRadius = max(minRadius + 6, (ballRadiusOffsetPx * 1.45f).roundToInt())
            val minDist = max(18.0, minRadius * 2.5)

            Imgproc.HoughCircles(
                blurredWhite,
                circles,
                Imgproc.HOUGH_GRADIENT,
                1.2,
                minDist,
                100.0,
                14.0,
                minRadius,
                maxRadius
            )

            if (circles.cols() == 0) return null

            var bestX = 0f
            var bestY = 0f
            var bestScore = -1.0

            for (i in 0 until circles.cols()) {
                val data = circles.get(0, i) ?: continue
                if (data.size < 3) continue
                val cx = data[0]
                val cy = data[1]
                val r = data[2]

                // Prefer circles closest to expected ball radius and centered inside a white region
                val radiusDelta = abs(r - ballRadiusOffsetPx.toDouble())
                val radiusScore = 1.0 / (1.0 + radiusDelta)
                val ix = cx.roundToInt().coerceIn(0, whiteMask.cols() - 1)
                val iy = cy.roundToInt().coerceIn(0, whiteMask.rows() - 1)
                val centerVal = whiteMask.get(iy, ix)?.firstOrNull() ?: 0.0
                val score = radiusScore + if (centerVal > 128.0) 1.5 else 0.0

                if (score > bestScore) {
                    bestScore = score
                    bestX = tableRect.x + cx.toFloat()
                    bestY = tableRect.y + cy.toFloat()
                }
            }

            return if (bestScore > 0.0) PointF(bestX, bestY) else null
        } finally {
            roiHsv.release()
            whiteMask.release()
            blurredWhite.release()
            circles.release()
        }
    }

    private fun detectAimingAngle(
        rgbMat: Mat,
        cueBall: PointF,
        tableRect: CvRect,
        ballRadiusOffsetPx: Float
    ): Float? {
        val halfBox = max(140, (ballRadiusOffsetPx * 11f).roundToInt())
        val roiLeft = max(tableRect.x, cueBall.x.roundToInt() - halfBox)
        val roiTop = max(tableRect.y, cueBall.y.roundToInt() - halfBox)
        val roiRight = min(tableRect.x + tableRect.width, cueBall.x.roundToInt() + halfBox)
        val roiBottom = min(tableRect.y + tableRect.height, cueBall.y.roundToInt() + halfBox)

        val roiW = roiRight - roiLeft
        val roiH = roiBottom - roiTop
        if (roiW < 24 || roiH < 24) return null

        val aimRect = CvRect(roiLeft, roiTop, roiW, roiH)
        val roiRgb = rgbMat.submat(aimRect)
        val roiGray = Mat()
        val edges = Mat()
        val lines = Mat()

        try {
            Imgproc.cvtColor(roiRgb, roiGray, Imgproc.COLOR_RGB2GRAY)
            Imgproc.GaussianBlur(roiGray, roiGray, Size(3.0, 3.0), 0.0)
            Imgproc.Canny(roiGray, edges, 60.0, 160.0)

            val minLineLen = max(18.0, ballRadiusOffsetPx * 1.6)
            Imgproc.HoughLinesP(
                edges,
                lines,
                1.0,
                Math.PI / 180.0,
                22,
                minLineLen,
                12.0
            )

            if (lines.rows() == 0) return null

            var bestAngleRad: Float? = null
            var bestScore = -1.0

            val maxPerpDist = ballRadiusOffsetPx * 1.9f
            val maxAnchorDist = ballRadiusOffsetPx * 6.5f

            for (i in 0 until lines.rows()) {
                val seg = lines.get(i, 0) ?: continue
                if (seg.size < 4) continue

                val x1 = roiLeft + seg[0].toFloat()
                val y1 = roiTop + seg[1].toFloat()
                val x2 = roiLeft + seg[2].toFloat()
                val y2 = roiTop + seg[3].toFloat()

                val segLen = hypot(x2 - x1, y2 - y1)
                if (segLen < minLineLen) continue

                val perpDist = pointToSegmentLineDistance(cueBall.x, cueBall.y, x1, y1, x2, y2)
                if (perpDist > maxPerpDist) continue

                val d1 = hypot(x1 - cueBall.x, y1 - cueBall.y)
                val d2 = hypot(x2 - cueBall.x, y2 - cueBall.y)
                val closerDist = min(d1, d2)
                if (closerDist > maxAnchorDist) continue

                // Orient vector away from the cue ball center
                val dx: Float
                val dy: Float
                if (d1 <= d2) {
                    dx = x2 - x1
                    dy = y2 - y1
                } else {
                    dx = x1 - x2
                    dy = y1 - y2
                }

                // Prefer segments cleanly aligned through the cue ball center with strong length
                val alignmentBonus = 1.0 / (1.0 + perpDist.toDouble())
                val proximityBonus = 1.0 / (1.0 + (closerDist / max(1f, ballRadiusOffsetPx)).toDouble())
                val score = segLen.toDouble() * alignmentBonus * proximityBonus

                if (score > bestScore) {
                    bestScore = score
                    bestAngleRad = atan2(dy.toDouble(), dx.toDouble()).toFloat()
                }
            }

            return bestAngleRad
        } finally {
            roiRgb.release()
            roiGray.release()
            edges.release()
            lines.release()
        }
    }

    private fun pointToSegmentLineDistance(
        px: Float,
        py: Float,
        x1: Float,
        y1: Float,
        x2: Float,
        y2: Float
    ): Float {
        val dx = x2 - x1
        val dy = y2 - y1
        val len = hypot(dx, dy)
        if (len < 1e-4f) return Float.MAX_VALUE
        val area2 = abs(dy * px - dx * py + x2 * y1 - y2 * x1)
        return area2 / len
    }
}
