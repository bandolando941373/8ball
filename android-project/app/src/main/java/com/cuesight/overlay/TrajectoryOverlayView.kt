package com.cuesight.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.RectF
import android.graphics.Typeface
import android.view.View
import kotlin.math.acos
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

class TrajectoryOverlayView(context: Context) : View(context) {

    private var tableBounds: RectF? = null
    private var insetBounds: RectF? = null
    private var cueBall: PointF? = null
    private var ballRadiusPx: Float = 18f
    private var launchAngleRad: Float? = null
    private var maxBounces: Int = 3
    private var isLocked: Boolean = false

    private val tableOutlinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(120, 16, 185, 129)
        strokeWidth = 2.5f
        style = Paint.Style.STROKE
    }

    private val cushionInsetPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(150, 56, 189, 248)
        strokeWidth = 2f
        style = Paint.Style.STROKE
        pathEffect = DashPathEffect(floatArrayOf(10f, 8f), 0f)
    }

    private val cueRingPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#38BDF8")
        strokeWidth = 4f
        style = Paint.Style.STROKE
    }

    private val primaryRayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#38BDF8")
        strokeWidth = 5f
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        pathEffect = DashPathEffect(floatArrayOf(20f, 10f), 0f)
    }

    private val bankRayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#F59E0B")
        strokeWidth = 4f
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        pathEffect = DashPathEffect(floatArrayOf(14f, 8f), 0f)
    }

    private val finalRayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#10B981")
        strokeWidth = 3.5f
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        pathEffect = DashPathEffect(floatArrayOf(10f, 8f), 0f)
    }

    private val impactDotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#FBBF24")
        style = Paint.Style.FILL
    }

    private val badgeBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(205, 11, 15, 20)
        style = Paint.Style.FILL
    }

    private val badgeTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#F1F5F9")
        textSize = 24f
        typeface = Typeface.MONOSPACE
    }

    private val bounceLabelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#FEF08A")
        textSize = 22f
        typeface = Typeface.MONOSPACE
    }

    fun setMaxBounces(bounces: Int) {
        maxBounces = bounces.coerceIn(1, 4)
        invalidate()
    }

    fun setLocked(locked: Boolean) {
        isLocked = locked
        invalidate()
    }

    fun isOverlayLocked(): Boolean = isLocked

    fun updateVision(result: PoolVisionProcessor.VisionResult) {
        if (isLocked) return

        tableBounds = result.tableBounds?.let { RectF(it) }
        insetBounds = result.insetBounds?.let { RectF(it) }
        cueBall = result.cueBall?.let { PointF(it.x, it.y) }
        ballRadiusPx = result.ballRadiusPx
        launchAngleRad = result.launchAngleRad
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        val outer = tableBounds
        val cushion = insetBounds
        val cue = cueBall

        if (outer != null) {
            canvas.drawRect(outer, tableOutlinePaint)
            drawHudBadge(canvas, outer)
        }

        if (cushion != null) {
            canvas.drawRect(cushion, cushionInsetPaint)
        }

        if (cue != null) {
            canvas.drawCircle(cue.x, cue.y, ballRadiusPx + 5f, cueRingPaint)
        }

        val angle = launchAngleRad
        if (cushion != null && cue != null && angle != null && cushion.width() > 8f && cushion.height() > 8f) {
            drawReflectedTrajectory(canvas, cushion, cue, angle)
        }
    }

    private fun drawHudBadge(canvas: Canvas, outer: RectF) {
        val stateLabel = if (isLocked) "LOCKED · READY TO SHOOT" else "LIVE TRACKING"
        val aimLabel = if (launchAngleRad != null) "${maxBounces}x BANK" else "SEARCHING AIM"
        val text = "$stateLabel · $aimLabel"

        val padX = 14f
        val textW = badgeTextPaint.measureText(text)
        val badgeW = textW + padX * 2f
        val badgeH = 38f
        val badgeTop = (outer.top - badgeH - 6f).coerceAtLeast(8f)
        val badgeLeft = outer.left.coerceIn(8f, (width - badgeW - 8f).coerceAtLeast(8f))

        canvas.drawRoundRect(
            badgeLeft,
            badgeTop,
            badgeLeft + badgeW,
            badgeTop + badgeH,
            8f,
            8f,
            badgeBgPaint
        )
        canvas.drawText(text, badgeLeft + padX, badgeTop + 26f, badgeTextPaint)
    }

    private fun drawReflectedTrajectory(
        canvas: Canvas,
        bounds: RectF,
        start: PointF,
        angleRad: Float
    ) {
        var ox = start.x.coerceIn(bounds.left + 1f, bounds.right - 1f)
        var oy = start.y.coerceIn(bounds.top + 1f, bounds.bottom - 1f)
        var dx = cos(angleRad.toDouble()).toFloat()
        var dy = sin(angleRad.toDouble()).toFloat()

        // Total segments = 1 initial extension + up to maxBounces reflections
        for (segment in 0..maxBounces) {
            val tx = when {
                dx > 1e-4f -> (bounds.right - ox) / dx
                dx < -1e-4f -> (bounds.left - ox) / dx
                else -> Float.MAX_VALUE
            }
            val ty = when {
                dy > 1e-4f -> (bounds.bottom - oy) / dy
                dy < -1e-4f -> (bounds.top - oy) / dy
                else -> Float.MAX_VALUE
            }

            val hitVerticalWall = tx <= ty
            val tHit = min(tx, ty)
            if (tHit <= 0.5f || tHit == Float.MAX_VALUE) break

            val nx = (ox + dx * tHit).coerceIn(bounds.left, bounds.right)
            val ny = (oy + dy * tHit).coerceIn(bounds.top, bounds.bottom)

            val paint = when {
                segment == 0 -> primaryRayPaint
                segment == maxBounces -> finalRayPaint
                else -> bankRayPaint
            }
            canvas.drawLine(ox, oy, nx, ny, paint)

            if (segment < maxBounces) {
                canvas.drawCircle(nx, ny, 7f, impactDotPaint)

                // θ_i = θ_r measured from surface normal
                val cosInc = abs(if (hitVerticalWall) dx else dy).coerceIn(0f, 1f)
                val deg = Math.toDegrees(acos(cosInc.toDouble())).toFloat()
                val label = String.format("B%d %.0f°", segment + 1, deg)
                val labelX = (nx + 10f).coerceAtMost(bounds.right - 90f)
                val labelY = (ny - 10f).coerceAtLeast(bounds.top + 24f)
                canvas.drawText(label, labelX, labelY, bounceLabelPaint)

                if (hitVerticalWall) {
                    dx = -dx
                } else {
                    dy = -dy
                }
                ox = nx
                oy = ny
            }
        }
    }
}
