package com.cuesight.overlay

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
        val fR = Color.red(feltColor)
        val fG = Color.green(feltColor)
        val fB = Color.blue(feltColor)

        val sw = w / step
        val sh = h / step
        val rowHits = IntArray(sh)
        val colHits = IntArray(sw)
        val feltMask = BooleanArray(sw * sh)
        val maxDistSq = 48 * 48

        for (sy in 0 until sh) {
            val yRowOffset = sy * step * w
            for (sx in 0 until sw) {
                val pixel = pixels[yRowOffset + sx * step]
                val dr = Color.red(pixel) - fR
                val dg = Color.green(pixel) - fG
                val db = Color.blue(pixel) - fB
                if (dr * dr + dg * dg + db * db <= maxDistSq) {
                    feltMask[sy * sw + sx] = true
                    rowHits[sy]++
                    colHits[sx]++
                }
            }
        }

        val (yMin, yMax) = longestSpan(rowHits, (rowHits.maxOrNull() ?: 0) * 0.48f)
        val (xMin, xMax) = longestSpan(colHits, (colHits.maxOrNull() ?: 0) * 0.48f)

        val left = (xMin * step).toFloat()
        val top = (yMin * step).toFloat()
        val width = max(120f, ((xMax - xMin) * step).toFloat())
        val height = max(80f, ((yMax - yMin) * step).toFloat())

        val longSide = max(width, height)
        val shortSide = max(1f, min(width, height))
        val ratio = longSide / shortSide
        val ballRadius = (longSide / 46f).coerceIn(8f, 30f)

        val tableClass = when {
            ratio > 2.15f -> "10 ft Snooker"
            longSide / (ballRadius * 2f) >= 34f -> "9 ft Pro"
            longSide / (ballRadius * 2f) >= 25f -> "8 ft Home"
            else -> "7 ft Bar"
        }

        val inset = max(2, (ballRadius / step).toInt())
        val minSx = max(0, xMin + inset)
        val maxSx = min(sw - 1, xMax - inset)
        val minSy = max(0, yMin + inset)
        val maxSy = min(sh - 1, yMax - inset)

        val visited = BooleanArray(sw * sh)
        val queue = IntArray(sw * sh)
        val minArea = max(4, ((Math.PI * (ballRadius / step) * (ballRadius / step)) * 0.3).toInt())
        val maxArea = max(24, ((Math.PI * (ballRadius / step) * (ballRadius / step)) * 3.2).toInt())

        data class Blob(val x: Float, val y: Float, val lum: Float)
        val blobs = ArrayList<Blob>()

        for (sy in minSy..maxSy) {
            for (sx in minSx..maxSx) {
                val startIdx = sy * sw + sx
                if (feltMask[startIdx] || visited[startIdx]) continue

                var head = 0
                var tail = 0
                queue[tail++] = startIdx
                visited[startIdx] = true

                var sumX = 0f
                var sumY = 0f
                var count = 0
                var lumSum = 0f
                var minBX = sx; var maxBX = sx
                var minBY = sy; var maxBY = sy

                while (head < tail) {
                    val cur = queue[head++]
                    val cx = cur % sw
                    val cy = cur / sw
                    sumX += cx; sumY += cy; count++
                    if (cx < minBX) minBX = cx
                    if (cx > maxBX) maxBX = cx
                    if (cy < minBY) minBY = cy
                    if (cy > maxBY) maxBY = cy

                    val px = pixels[cy * step * w + cx * step]
                    lumSum += 0.299f * Color.red(px) + 0.587f * Color.green(px) + 0.114f * Color.blue(px)

                    if (cx > minSx && !feltMask[cur - 1] && !visited[cur - 1]) {
                        visited[cur - 1] = true; queue[tail++] = cur - 1
                    }
                    if (cx < maxSx && !feltMask[cur + 1] && !visited[cur + 1]) {
                        visited[cur + 1] = true; queue[tail++] = cur + 1
                    }
                    if (cy > minSy && !feltMask[cur - sw] && !visited[cur - sw]) {
                        visited[cur - sw] = true; queue[tail++] = cur - sw
                    }
                    if (cy < maxSy && !feltMask[cur + sw] && !visited[cur + sw]) {
                        visited[cur + sw] = true; queue[tail++] = cur + sw
                    }
                }

                if (count in minArea..maxArea) {
                    val bw = max(1, maxBX - minBX + 1)
                    val bh = max(1, maxBY - minBY + 1)
                    val aspect = max(bw, bh).toFloat() / min(bw, bh).toFloat()
                    if (aspect <= 1.7f) {
                        val avgLum = lumSum / count
                        if (avgLum > 45f) {
                            blobs.add(Blob((sumX / count) * step, (sumY / count) * step, avgLum))
                        }
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
                val r = Color.red(c)
                val g = Color.green(c)
                val b = Color.blue(c)
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
                if (i - curStart + 1 > bestLen) {
                    bestLen = i - curStart + 1
                    bestStart = curStart
                    bestEnd = i
                }
            } else if (curStart != -1 && ++gap > 4) {
                curStart = -1; gap = 0
            }
        }
        return bestStart to bestEnd
    }
}
