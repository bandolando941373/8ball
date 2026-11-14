import { PoolBall, TableBounds, TablePhysicalMetrics, calculateTableMetrics } from '../physics/poolMath';

export interface TableDetectionResult {
  bounds: TableBounds;
  metrics: TablePhysicalMetrics;
  dominantFeltRgb: [number, number, number];
  feltCoveragePct: number;
  confidencePct: number;
  processingTimeMs: number;
  detectedBalls: PoolBall[];
}

function rgbDistanceSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

function rgbToSat(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

/**
 * Automatically detects the inner playing felt bounding box, table physical class,
 * and candidate cue/object balls from an Android pool app screenshot or live frame.
 */
export function detectPoolTableFromImageData(imageData: ImageData): TableDetectionResult {
  const start = performance.now();
  const { width, height, data } = imageData;

  // Step 1: Sample central 50% x 50% grid to find the dominant saturated felt color
  // Using quantized 16-bin RGB histogram weighted by saturation (pool cloth is uniformly colored)
  const bins = new Map<number, { count: number; rSum: number; gSum: number; bSum: number }>();
  const xStart = Math.floor(width * 0.2);
  const xEnd = Math.floor(width * 0.8);
  const yStart = Math.floor(height * 0.2);
  const yEnd = Math.floor(height * 0.8);
  const step = Math.max(1, Math.floor(Math.min(width, height) / 140));

  for (let y = yStart; y < yEnd; y += step) {
    for (let x = xStart; x < xEnd; x += step) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const sat = rgbToSat(r, g, b);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Felt is typically medium luminance (25..210) and non-gray, or dark slate felt
      if (lum > 18 && lum < 230 && (sat > 0.14 || (lum > 35 && lum < 110))) {
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const existing = bins.get(key);
        if (existing) {
          existing.count += 1;
          existing.rSum += r;
          existing.gSum += g;
          existing.bSum += b;
        } else {
          bins.set(key, { count: 1, rSum: r, gSum: g, bSum: b });
        }
      }
    }
  }

  let bestBin = { count: 0, rSum: 15, gSum: 81, bSum: 50 };
  for (const bin of bins.values()) {
    if (bin.count > bestBin.count) {
      bestBin = bin;
    }
  }

  const feltR = bestBin.count > 0 ? Math.round(bestBin.rSum / bestBin.count) : 15;
  const feltG = bestBin.count > 0 ? Math.round(bestBin.gSum / bestBin.count) : 81;
  const feltB = bestBin.count > 0 ? Math.round(bestBin.bSum / bestBin.count) : 50;

  // Step 2: Build horizontal & vertical projection profiles of felt pixels
  // Downsample by 2px for ultra-fast real-time execution
  const s = width > 900 ? 2 : 1;
  const sw = Math.floor(width / s);
  const sh = Math.floor(height / s);
  const rowHits = new Uint16Array(sh);
  const colHits = new Uint16Array(sw);
  const feltMask = new Uint8Array(sw * sh);
  const distThresholdSq = 48 * 48;
  let totalFeltPixels = 0;

  for (let sy = 0; sy < sh; sy++) {
    const y = sy * s;
    for (let sx = 0; sx < sw; sx++) {
      const x = sx * s;
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      if (rgbDistanceSq(r, g, b, feltR, feltG, feltB) <= distThresholdSq) {
        feltMask[sy * sw + sx] = 1;
        rowHits[sy]++;
        colHits[sx]++;
        totalFeltPixels++;
      }
    }
  }

  // Find longest contiguous spans where felt density exceeds threshold
  let maxRowHit = 0;
  for (let i = 0; i < sh; i++) if (rowHits[i] > maxRowHit) maxRowHit = rowHits[i];
  let maxColHit = 0;
  for (let i = 0; i < sw; i++) if (colHits[i] > maxColHit) maxColHit = colHits[i];

  const rowThresh = Math.max(8, maxRowHit * 0.48);
  const colThresh = Math.max(8, maxColHit * 0.48);

  const findLongestSpan = (arr: Uint16Array, thresh: number): [number, number] => {
    let bestStart = 0;
    let bestEnd = arr.length - 1;
    let bestLen = 0;
    let curStart = -1;
    let gap = 0;

    for (let i = 0; i < arr.length; i++) {
      if (arr[i] >= thresh) {
        if (curStart === -1) curStart = i;
        gap = 0;
        const len = i - curStart + 1;
        if (len > bestLen) {
          bestLen = len;
          bestStart = curStart;
          bestEnd = i;
        }
      } else if (curStart !== -1) {
        gap++;
        if (gap > 4) {
          curStart = -1;
          gap = 0;
        }
      }
    }
    return [bestStart, bestEnd];
  };

  const [syMin, syMax] = findLongestSpan(rowHits, rowThresh);
  const [sxMin, sxMax] = findLongestSpan(colHits, colThresh);

  let bx = sxMin * s;
  let by = syMin * s;
  let bw = Math.max(120, (sxMax - sxMin) * s);
  let bh = Math.max(80, (syMax - syMin) * s);

  // Fallback safeguard if image had no clear felt rectangle
  if (bw < width * 0.25 || bh < height * 0.2) {
    bx = Math.round(width * 0.1);
    by = Math.round(height * 0.16);
    bw = Math.round(width * 0.8);
    bh = Math.round(height * 0.68);
  }

  const bounds: TableBounds = { x: bx, y: by, width: bw, height: bh };

  // Step 3: Connected-component scan inside the detected felt box for circular ball blobs
  const estimatedR = Math.max(7, Math.round(Math.max(bw, bh) / 46));
  const inset = Math.max(2, Math.round(estimatedR / s));
  const minSx = Math.max(0, Math.floor(bx / s) + inset);
  const maxSx = Math.min(sw - 1, Math.floor((bx + bw) / s) - inset);
  const minSy = Math.max(0, Math.floor(by / s) + inset);
  const maxSy = Math.min(sh - 1, Math.floor((by + bh) / s) - inset);

  const visited = new Uint8Array(sw * sh);
  const candidates: Array<{
    cx: number;
    cy: number;
    area: number;
    radius: number;
    avgLum: number;
    avgR: number;
    avgG: number;
    avgB: number;
  }> = [];

  const minBlobArea = Math.max(12, Math.floor((Math.PI * (estimatedR / s) * (estimatedR / s)) * 0.35));
  const maxBlobArea = Math.ceil((Math.PI * (estimatedR / s) * (estimatedR / s)) * 3.2);
  const queue = new Int32Array(sw * sh);

  for (let sy = minSy; sy <= maxSy; sy++) {
    for (let sx = minSx; sx <= maxSx; sx++) {
      const pIdx = sy * sw + sx;
      if (feltMask[pIdx] === 1 || visited[pIdx] === 1) continue;

      let head = 0;
      let tail = 0;
      queue[tail++] = pIdx;
      visited[pIdx] = 1;

      let sumX = 0;
      let sumY = 0;
      let count = 0;
      let lumSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let minBX = sx;
      let maxBX = sx;
      let minBY = sy;
      let maxBY = sy;

      while (head < tail) {
        const cur = queue[head++];
        const cx = cur % sw;
        const cy = Math.floor(cur / sw);

        sumX += cx;
        sumY += cy;
        count++;
        if (cx < minBX) minBX = cx;
        if (cx > maxBX) maxBX = cx;
        if (cy < minBY) minBY = cy;
        if (cy > maxBY) maxBY = cy;

        const imgIdx = (cy * s * width + cx * s) * 4;
        const pr = data[imgIdx];
        const pg = data[imgIdx + 1];
        const pb = data[imgIdx + 2];
        rSum += pr;
        gSum += pg;
        bSum += pb;
        lumSum += 0.299 * pr + 0.587 * pg + 0.114 * pb;

        const neighbors = [
          cx > minSx ? cur - 1 : -1,
          cx < maxSx ? cur + 1 : -1,
          cy > minSy ? cur - sw : -1,
          cy < maxSy ? cur + sw : -1,
        ];

        for (const n of neighbors) {
          if (n >= 0 && feltMask[n] === 0 && visited[n] === 0) {
            visited[n] = 1;
            queue[tail++] = n;
          }
        }
      }

      if (count >= minBlobArea && count <= maxBlobArea) {
        const boxW = (maxBX - minBX + 1) * s;
        const boxH = (maxBY - minBY + 1) * s;
        const aspect = Math.max(boxW, boxH) / Math.max(1, Math.min(boxW, boxH));
        // Filter out cue stick segments or elongated UI bars (balls are roughly circular)
        if (aspect <= 1.65) {
          const avgLum = lumSum / count;
          if (avgLum > 45) {
            candidates.push({
              cx: (sumX / count) * s,
              cy: (sumY / count) * s,
              area: count * s * s,
              radius: (boxW + boxH) * 0.25,
              avgLum,
              avgR: Math.round(rSum / count),
              avgG: Math.round(gSum / count),
              avgB: Math.round(bSum / count),
            });
          }
        }
      }
    }
  }

  // Sort by luminance descending so the white cue ball comes first
  candidates.sort((a, b) => b.avgLum - a.avgLum);

  const medianBallR =
    candidates.length > 0
      ? candidates
          .map((c) => c.radius)
          .sort((a, b) => a - b)[Math.floor(candidates.length / 2)]
      : undefined;

  const detectedBalls: PoolBall[] = candidates.slice(0, 16).map((c, idx) => ({
    id: idx === 0 ? 0 : idx,
    x: c.cx,
    y: c.cy,
    color: idx === 0 ? '#F8FAFC' : `rgb(${c.avgR}, ${c.avgG}, ${c.avgB})`,
    isCue: idx === 0,
  }));

  const metrics = calculateTableMetrics(bounds, medianBallR);
  const feltAreaRatio = totalFeltPixels / Math.max(1, (bw / s) * (bh / s));
  const feltCoveragePct = Math.min(99, Math.round(feltAreaRatio * 100));
  const confidencePct = Math.min(
    99,
    Math.round(
      Math.min(1, feltAreaRatio / 0.72) * 75 +
        (Math.abs(metrics.aspectRatio - 2.0) < 0.22 ? 20 : 10) +
        (detectedBalls.length >= 2 ? 4 : 0)
    )
  );

  return {
    bounds,
    metrics,
    dominantFeltRgb: [feltR, feltG, feltB],
    feltCoveragePct,
    confidencePct,
    processingTimeMs: Math.max(1, Math.round(performance.now() - start)),
    detectedBalls,
  };
}
