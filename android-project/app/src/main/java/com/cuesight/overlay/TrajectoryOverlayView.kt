package com.cuesight.overlay

import android.content.Context
import android.graphics.*
import android.view.MotionEvent
import android.view.View
import kotlin.math.*

class TrajectoryOverlayView(context: Context) : View(context) {

    private var tableBounds = RectF(160f, 140f, 1120f, 620f)
    private var ballRadius = 18f
    private var maxRebounds = 3
    private var englishSpin = 0f
    var interactiveAimEnabled = false

    private var cuePos = PointF(360f, 380f)
    private var targetPos: PointF? = PointF(760f, 280f)
    private var aimDir = PointF(0.95f, -0.31f)
    private var draggingMode = 0 // 0=none, 1=cue, 2=target, 3=aim

    private val aimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#38BDF8")
        strokeWidth = 4f
        style = Paint.Style.STROKE
        pathEffect = DashPathEffect(floatArrayOf(16f, 8f), 0f)
    }

    private val reboundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#F59E0B")
        strokeWidth = 3.5f
        style = Paint.Style.STROKE
    }

    private val objPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#10B981")
        strokeWidth = 4f
        style = Paint.Style.STROKE
    }

    private val ghostPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#E2E8F0")
        strokeWidth = 2.5f
        style = Paint.Style.STROKE
        pathEffect = DashPathEffect(floatArrayOf(6f, 4f), 0f)
    }

    private val boundsPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#9910B981")
        strokeWidth = 2.5f
        style = Paint.Style.STROKE
    }

    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 26f
        typeface = Typeface.MONOSPACE
    }

    private val badgeBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#CC0B0F14")
        style = Paint.Style.FILL
    }

    fun updateCalibration(
        left: Float,
        top: Float,
        width: Float,
        height: Float,
        ballRadius: Float,
        cue: PointF?,
        target: PointF?
    ) {
        this.tableBounds = RectF(left, top, left + width, top + height)
        this.ballRadius = ballRadius
        if (cue != null) {
            cuePos.set(cue.x, cue.y)
        } else {
            cuePos.set(left + width * 0.28f, top + height * 0.5f)
        }
        if (target != null) {
            targetPos = PointF(target.x, target.y)
            val dx = target.x - cuePos.x
            val dy = target.y - cuePos.y
            val len = hypot(dx, dy).coerceAtLeast(1e-4f)
            aimDir.set(dx / len, dy / len)
        }
        invalidate()
    }

    fun cycleRebounds(): Int {
        maxRebounds = (maxRebounds + 1) % 5
        if (maxRebounds == 0) maxRebounds = 1
        invalidate()
        return maxRebounds
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (!interactiveAimEnabled) return false
        val x = event.x
        val y = event.y
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                val cueDist = hypot(x - cuePos.x, y - cuePos.y)
                val tgtDist = targetPos?.let { hypot(x - it.x, y - it.y) } ?: Float.MAX_VALUE
                draggingMode = when {
                    cueDist < ballRadius * 2.5f -> 1
                    tgtDist < ballRadius * 2.5f -> 2
                    else -> {
                        val dx = x - cuePos.x
                        val dy = y - cuePos.y
                        val len = hypot(dx, dy).coerceAtLeast(1e-4f)
                        aimDir.set(dx / len, dy / len)
                        invalidate()
                        3
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
                        val dx = x - cuePos.x
                        val dy = y - cuePos.y
                        val len = hypot(dx, dy).coerceAtLeast(1e-4f)
                        aimDir.set(dx / len, dy / len)
                    }
                }
                invalidate()
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                draggingMode = 0
                return true
            }
        }
        return false
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawRect(tableBounds, boundsPaint)

        // Draw table size label
        val dimText = "${tableBounds.width().toInt()}×${tableBounds.height().toInt()} px"
        canvas.drawRect(tableBounds.left, max(0f, tableBounds.top - 36f), tableBounds.left + 260f, tableBounds.top, badgeBgPaint)
        canvas.drawText(dimText, tableBounds.left + 10f, max(24f, tableBounds.top - 10f), textPaint)

        // Draw Cue & Target reticles when interactive mode is on
        if (interactiveAimEnabled) {
            canvas.drawCircle(cuePos.x, cuePos.y, ballRadius + 4f, aimPaint)
            targetPos?.let { canvas.drawCircle(it.x, it.y, ballRadius + 4f, objPaint) }
        }

        val minX = tableBounds.left + ballRadius
        val maxX = tableBounds.right - ballRadius
        val minY = tableBounds.top + ballRadius
        val maxY = tableBounds.bottom - ballRadius

        var ox = cuePos.x
        var oy = cuePos.y
        var dx = aimDir.x
        var dy = aimDir.y
        var spin = englishSpin

        for (bounce in 0..maxRebounds) {
            val tx = when {
                dx < -1e-4f -> (minX - ox) / dx
                dx > 1e-4f -> (maxX - ox) / dx
                else -> Float.MAX_VALUE
            }
            val ty = when {
                dy < -1e-4f -> (minY - oy) / dy
                dy > 1e-4f -> (maxY - oy) / dy
                else -> Float.MAX_VALUE
            }

            val hitXFirst = tx < ty
            val wallT = min(tx, ty)
            if (wallT <= 0f || wallT == Float.MAX_VALUE) break

            // Check ghost ball hit with target ball on this segment
            val tgt = targetPos
            if (tgt != null) {
                val ocX = tgt.x - ox
                val ocY = tgt.y - oy
                val proj = ocX * dx + ocY * dy
                val combR = ballRadius * 2f
                val perpSq = (ocX * ocX + ocY * ocY) - proj * proj
                if (proj > 0f && perpSq < combR * combR) {
                    val tHit = proj - sqrt(combR * combR - perpSq)
                    if (tHit > 1f && tHit <= wallT) {
                        val gx = ox + dx * tHit
                        val gy = oy + dy * tHit
                        canvas.drawLine(ox, oy, gx, gy, if (bounce == 0) aimPaint else reboundPaint)
                        canvas.drawCircle(gx, gy, ballRadius, ghostPaint)

                        // Trace object ball with rebounds
                        val odx = tgt.x - gx
                        val ody = tgt.y - gy
                        val olen = hypot(odx, ody).coerceAtLeast(1e-4f)
                        traceObjectPath(canvas, tgt.x, tgt.y, odx / olen, ody / olen, minX, maxX, minY, maxY)
                        return
                    }
                }
            }

            val nx = ox + dx * wallT
            val ny = oy + dy * wallT
            canvas.drawLine(ox, oy, nx, ny, if (bounce == 0) aimPaint else reboundPaint)

            if (bounce == maxRebounds) break

            val cosInc = abs(if (hitXFirst) dx else dy).coerceIn(0f, 1f)
            val angleDeg = Math.toDegrees(acos(cosInc.toDouble())).toFloat()
            canvas.drawText(String.format("B%d %.0f°", bounce + 1, angleDeg), nx + 8f, ny - 8f, textPaint)

            val rx = if (hitXFirst) -dx else dx
            val ry = if (hitXFirst) dy else -dy
            val spinRad = Math.toRadians((spin * 14f).toDouble()).toFloat()
            val cosS = cos(spinRad)
            val sinS = sin(spinRad)
            dx = rx * cosS - ry * sinS
            dy = rx * sinS + ry * cosS
            spin *= 0.55f
            ox = nx
            oy = ny
        }
    }

    private fun traceObjectPath(
        canvas: Canvas,
        startX: Float,
        startY: Float,
        startDx: Float,
        startDy: Float,
        minX: Float,
        maxX: Float,
        minY: Float,
        maxY: Float
    ) {
        var ox = startX
        var oy = startY
        var dx = startDx
        var dy = startDy
        for (b in 0..min(2, maxRebounds)) {
            val tx = when {
                dx < -1e-4f -> (minX - ox) / dx
                dx > 1e-4f -> (maxX - ox) / dx
                else -> Float.MAX_VALUE
            }
            val ty = when {
                dy < -1e-4f -> (minY - oy) / dy
                dy > 1e-4f -> (maxY - oy) / dy
                else -> Float.MAX_VALUE
            }
            val hitXFirst = tx < ty
            val t = min(tx, ty)
            if (t <= 0f || t == Float.MAX_VALUE) break
            val nx = ox + dx * t
            val ny = oy + dy * t
            canvas.drawLine(ox, oy, nx, ny, objPaint)
            if (b == min(2, maxRebounds)) break
            dx = if (hitXFirst) -dx else dx
            dy = if (hitXFirst) dy else -dy
            ox = nx
            oy = ny
        }
    }
}
