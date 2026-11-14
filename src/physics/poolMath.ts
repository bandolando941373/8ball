export interface Vec2 {
  x: number;
  y: number;
}

export interface TableBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Pocket {
  id: 'TL' | 'TC' | 'TR' | 'BL' | 'BC' | 'BR';
  label: string;
  x: number;
  y: number;
  radius: number;
  isCorner: boolean;
}

export interface PoolBall {
  id: number;
  x: number;
  y: number;
  color: string;
  stripe?: boolean;
  isCue?: boolean;
}

export interface ReboundNode {
  index: number;
  point: Vec2;
  rail: 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT';
  incidenceDeg: number;
  reflectionDeg: number;
}

export interface RayPath {
  points: Vec2[];
  rebounds: ReboundNode[];
  pocketed: Pocket | null;
  totalLengthPx: number;
}

export interface ShotAnalysis {
  cueAimPath: RayPath;
  objectBallPath: RayPath | null;
  cueDeflectionPath: RayPath | null;
  ghostBallCenter: Vec2 | null;
  hitBallId: number | null;
  hitOnBounceIndex: number;
  cutAngleDeg: number | null;
  cutDirection: 'STRAIGHT' | 'LEFT CUT' | 'RIGHT CUT' | null;
  throwOffsetDeg: number;
  aimAngleDeg: number;
}

export interface TablePhysicalMetrics {
  pixelWidth: number;
  pixelHeight: number;
  aspectRatio: number;
  isLandscape: boolean;
  estimatedClass: string;
  physicalInches: { width: number; height: number };
  physicalMm: { width: number; height: number };
  pxPerInch: number;
  diamondSpacingPx: number;
  recommendedBallRadiusPx: number;
  pocketMouthPx: number;
}

export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function getPockets(bounds: TableBounds, ballRadius: number): Pocket[] {
  const isLandscape = bounds.width >= bounds.height;
  const cornerR = ballRadius * 1.62;
  const sideR = ballRadius * 1.48;
  const x0 = bounds.x;
  const y0 = bounds.y;
  const x1 = bounds.x + bounds.width;
  const y1 = bounds.y + bounds.height;
  const xm = bounds.x + bounds.width * 0.5;
  const ym = bounds.y + bounds.height * 0.5;

  if (isLandscape) {
    return [
      { id: 'TL', label: 'Top Left', x: x0, y: y0, radius: cornerR, isCorner: true },
      { id: 'TC', label: 'Top Side', x: xm, y: y0 - ballRadius * 0.12, radius: sideR, isCorner: false },
      { id: 'TR', label: 'Top Right', x: x1, y: y0, radius: cornerR, isCorner: true },
      { id: 'BL', label: 'Bottom Left', x: x0, y: y1, radius: cornerR, isCorner: true },
      { id: 'BC', label: 'Bottom Side', x: xm, y: y1 + ballRadius * 0.12, radius: sideR, isCorner: false },
      { id: 'BR', label: 'Bottom Right', x: x1, y: y1, radius: cornerR, isCorner: true },
    ];
  }

  return [
    { id: 'TL', label: 'Top Left', x: x0, y: y0, radius: cornerR, isCorner: true },
    { id: 'TR', label: 'Top Right', x: x1, y: y0, radius: cornerR, isCorner: true },
    { id: 'TC', label: 'Left Side', x: x0 - ballRadius * 0.12, y: ym, radius: sideR, isCorner: false },
    { id: 'BC', label: 'Right Side', x: x1 + ballRadius * 0.12, y: ym, radius: sideR, isCorner: false },
    { id: 'BL', label: 'Bottom Left', x: x0, y: y1, radius: cornerR, isCorner: true },
    { id: 'BR', label: 'Bottom Right', x: x1, y: y1, radius: cornerR, isCorner: true },
  ];
}

export function calculateTableMetrics(
  bounds: TableBounds,
  detectedBallRadiusPx?: number
): TablePhysicalMetrics {
  const isLandscape = bounds.width >= bounds.height;
  const longPx = Math.max(bounds.width, bounds.height);
  const shortPx = Math.max(1, Math.min(bounds.width, bounds.height));
  const aspectRatio = longPx / shortPx;

  // Standard pool ball is 2.25" diameter (1.125" radius).
  // On a 9ft table (100" x 50"), longPx / ballRadius ≈ 100 / 1.125 = 88.89 -> radius ≈ longPx / 88.9?
  // Wait: digital pool apps (e.g. 8 Ball Pool) use slightly oversized balls (~1/38 to 1/44 of table width) for touch clarity.
  // Physical 9ft table has ball radius = longPx / 88.8, 7ft bar box = longPx / 69.3.
  // We use detectedBallRadiusPx if provided, else compute standard digital/hybrid ball radius.
  const recommendedBallRadiusPx =
    detectedBallRadiusPx && detectedBallRadiusPx > 4
      ? detectedBallRadiusPx
      : clamp(longPx / 46, 8, 28);

  // Classify table size based on aspect ratio and relative ball-to-table scale
  const ballCountAcrossLong = longPx / (recommendedBallRadiusPx * 2);
  let estimatedClass = '8 ft Home Standard';
  let physLongIn = 88;
  let physShortIn = 44;

  if (Math.abs(aspectRatio - 2.0) <= 0.16) {
    if (ballCountAcrossLong >= 34) {
      estimatedClass = '9 ft Tournament Pro';
      physLongIn = 100;
      physShortIn = 50;
    } else if (ballCountAcrossLong >= 25) {
      estimatedClass = '8 ft Home Standard';
      physLongIn = 88;
      physShortIn = 44;
    } else {
      estimatedClass = '7 ft Bar Box';
      physLongIn = 78;
      physShortIn = 39;
    }
  } else if (aspectRatio > 2.16) {
    estimatedClass = '10 ft Snooker / Carom';
    physLongIn = 112;
    physShortIn = 56;
  } else {
    estimatedClass = 'Compact Arcade Table';
    physLongIn = 72;
    physShortIn = Math.round(72 / aspectRatio);
  }

  const physicalInches = isLandscape
    ? { width: physLongIn, height: physShortIn }
    : { width: physShortIn, height: physLongIn };

  const physicalMm = {
    width: Math.round(physicalInches.width * 25.4),
    height: Math.round(physicalInches.height * 25.4),
  };

  return {
    pixelWidth: Math.round(bounds.width),
    pixelHeight: Math.round(bounds.height),
    aspectRatio,
    isLandscape,
    estimatedClass,
    physicalInches,
    physicalMm,
    pxPerInch: longPx / physLongIn,
    diamondSpacingPx: longPx / 8,
    recommendedBallRadiusPx,
    pocketMouthPx: recommendedBallRadiusPx * 3.24,
  };
}

interface WallHit {
  t: number;
  point: Vec2;
  rail: 'TOP' | 'BOTTOM' | 'LEFT' | 'RIGHT';
  normal: Vec2;
}

function intersectPlayfieldWall(
  origin: Vec2,
  dir: Vec2,
  bounds: TableBounds,
  ballRadius: number
): WallHit | null {
  const minX = bounds.x + ballRadius;
  const maxX = bounds.x + bounds.width - ballRadius;
  const minY = bounds.y + ballRadius;
  const maxY = bounds.y + bounds.height - ballRadius;

  const hits: WallHit[] = [];
  const eps = 1e-4;

  if (dir.x < -eps) {
    const t = (minX - origin.x) / dir.x;
    if (t > eps) {
      hits.push({
        t,
        point: { x: minX, y: origin.y + dir.y * t },
        rail: 'LEFT',
        normal: { x: 1, y: 0 },
      });
    }
  } else if (dir.x > eps) {
    const t = (maxX - origin.x) / dir.x;
    if (t > eps) {
      hits.push({
        t,
        point: { x: maxX, y: origin.y + dir.y * t },
        rail: 'RIGHT',
        normal: { x: -1, y: 0 },
      });
    }
  }

  if (dir.y < -eps) {
    const t = (minY - origin.y) / dir.y;
    if (t > eps) {
      hits.push({
        t,
        point: { x: origin.x + dir.x * t, y: minY },
        rail: 'TOP',
        normal: { x: 0, y: 1 },
      });
    }
  } else if (dir.y > eps) {
    const t = (maxY - origin.y) / dir.y;
    if (t > eps) {
      hits.push({
        t,
        point: { x: origin.x + dir.x * t, y: maxY },
        rail: 'BOTTOM',
        normal: { x: 0, y: -1 },
      });
    }
  }

  if (hits.length === 0) return null;
  hits.sort((a, b) => a.t - b.t);
  return hits[0];
}

function intersectPocket(
  origin: Vec2,
  dir: Vec2,
  pockets: Pocket[],
  maxT: number
): { t: number; pocket: Pocket; point: Vec2 } | null {
  let closest: { t: number; pocket: Pocket; point: Vec2 } | null = null;

  for (const pocket of pockets) {
    const ocX = origin.x - pocket.x;
    const ocY = origin.y - pocket.y;
    const b = ocX * dir.x + ocY * dir.y;
    const c = ocX * ocX + ocY * ocY - pocket.radius * pocket.radius;
    const disc = b * b - c;
    if (disc >= 0) {
      const sqrtD = Math.sqrt(disc);
      const t = -b - sqrtD;
      const tUse = t > 1e-3 ? t : -b + sqrtD;
      if (tUse > 1e-3 && tUse <= maxT + 2) {
        if (!closest || tUse < closest.t) {
          closest = {
            t: tUse,
            pocket,
            point: {
              x: origin.x + dir.x * tUse,
              y: origin.y + dir.y * tUse,
            },
          };
        }
      }
    }
  }

  return closest;
}

function reflectWithSpin(
  dir: Vec2,
  normal: Vec2,
  english: number // -1 (left) to +1 (right)
): { nextDir: Vec2; incidenceDeg: number; reflectionDeg: number } {
  // Incidence angle relative to inward wall normal
  const incomingOpposite = { x: -dir.x, y: -dir.y };
  const cosInc = clamp(dot(incomingOpposite, normal), 0, 1);
  const incidenceDeg = (Math.acos(cosInc) * 180) / Math.PI;

  // Pure specular reflection: r = d - 2(d·n)n
  const dDotN = dot(dir, normal);
  const pureReflect = normalize({
    x: dir.x - 2 * dDotN * normal.x,
    y: dir.y - 2 * dDotN * normal.y,
  });

  // Apply English (side spin) tangential impulse along the rail
  // Tangent vector oriented clockwise around inward normal: t = (normal.y, -normal.x)
  const tangent = { x: normal.y, y: -normal.x };
  // Max spin deflection ~14 deg on clean cloth
  const spinShiftRad = (english * 14 * Math.PI) / 180;

  // Rotate pureReflect around normal direction by spinShiftRad, keeping it inside the table
  const angle = Math.atan2(pureReflect.y, pureReflect.x);
  const candidateAngle = angle + spinShiftRad;
  let nextDir = {
    x: Math.cos(candidateAngle),
    y: Math.sin(candidateAngle),
  };

  // Ensure reflected ray never points back into the cushion wall
  if (dot(nextDir, normal) < 0.08) {
    // Clamp close to rail
    const tangSign = dot(pureReflect, tangent) >= 0 ? 1 : -1;
    nextDir = normalize({
      x: normal.x * 0.1 + tangent.x * tangSign * 0.995,
      y: normal.y * 0.1 + tangent.y * tangSign * 0.995,
    });
  }

  const cosRef = clamp(dot(nextDir, normal), 0, 1);
  const reflectionDeg = (Math.acos(cosRef) * 180) / Math.PI;

  return { nextDir, incidenceDeg, reflectionDeg };
}

export function traceRayWithRebounds(
  origin: Vec2,
  initialDir: Vec2,
  bounds: TableBounds,
  ballRadius: number,
  maxBounces: number,
  english: number
): RayPath {
  const pockets = getPockets(bounds, ballRadius);
  const points: Vec2[] = [{ ...origin }];
  const rebounds: ReboundNode[] = [];
  let currOrigin = { ...origin };
  let currDir = normalize(initialDir);
  let totalLengthPx = 0;
  let pocketed: Pocket | null = null;
  let activeSpin = english;

  for (let bounce = 0; bounce <= maxBounces; bounce++) {
    const wallHit = intersectPlayfieldWall(currOrigin, currDir, bounds, ballRadius);
    if (!wallHit) break;

    const pocketHit = intersectPocket(currOrigin, currDir, pockets, wallHit.t);
    if (pocketHit) {
      points.push(pocketHit.point);
      totalLengthPx += pocketHit.t;
      pocketed = pocketHit.pocket;
      break;
    }

    points.push(wallHit.point);
    totalLengthPx += wallHit.t;

    if (bounce === maxBounces) {
      break;
    }

    const { nextDir, incidenceDeg, reflectionDeg } = reflectWithSpin(
      currDir,
      wallHit.normal,
      activeSpin
    );

    rebounds.push({
      index: bounce + 1,
      point: wallHit.point,
      rail: wallHit.rail,
      incidenceDeg,
      reflectionDeg,
    });

    // Spin decays slightly after each cushion contact
    activeSpin *= 0.55;
    currOrigin = {
      x: wallHit.point.x + wallHit.normal.x * 0.5,
      y: wallHit.point.y + wallHit.normal.y * 0.5,
    };
    currDir = nextDir;
  }

  return {
    points,
    rebounds,
    pocketed,
    totalLengthPx,
  };
}

function intersectRayWithBalls(
  origin: Vec2,
  dir: Vec2,
  balls: PoolBall[],
  ballRadius: number,
  maxT: number
): { t: number; ball: PoolBall; ghostCenter: Vec2 } | null {
  const combinedR = ballRadius * 2;
  const combinedRSq = combinedR * combinedR;
  let closest: { t: number; ball: PoolBall; ghostCenter: Vec2 } | null = null;

  for (const ball of balls) {
    if (ball.isCue) continue;
    const ocX = ball.x - origin.x;
    const ocY = ball.y - origin.y;
    const proj = ocX * dir.x + ocY * dir.y;
    if (proj <= 0) continue;

    const distSq = ocX * ocX + ocY * ocY;
    const perpSq = distSq - proj * proj;
    if (perpSq >= combinedRSq) continue;

    const thc = Math.sqrt(combinedRSq - perpSq);
    const tHit = proj - thc;
    if (tHit > 0.5 && tHit <= maxT) {
      if (!closest || tHit < closest.t) {
        closest = {
          t: tHit,
          ball,
          ghostCenter: {
            x: origin.x + dir.x * tHit,
            y: origin.y + dir.y * tHit,
          },
        };
      }
    }
  }

  return closest;
}

export function analyzePoolShot(params: {
  cueBall: Vec2;
  aimDir: Vec2;
  objectBalls: PoolBall[];
  bounds: TableBounds;
  ballRadius: number;
  maxBounces: number;
  english: number; // -1 to +1
  followDraw: number; // -1 (draw) to +1 (follow)
}): ShotAnalysis {
  const {
    cueBall,
    aimDir,
    objectBalls,
    bounds,
    ballRadius,
    maxBounces,
    english,
    followDraw,
  } = params;

  const pockets = getPockets(bounds, ballRadius);
  const normAim = normalize(aimDir);
  const aimAngleDeg = ((Math.atan2(normAim.y, normAim.x) * 180) / Math.PI + 360) % 360;

  const cuePoints: Vec2[] = [{ ...cueBall }];
  const cueRebounds: ReboundNode[] = [];
  let currOrigin = { ...cueBall };
  let currDir = normAim;
  let totalCueLen = 0;
  let activeSpin = english;
  let cuePocketed: Pocket | null = null;

  let hitResult: {
    ball: PoolBall;
    ghostCenter: Vec2;
    incomingDir: Vec2;
    bounceIndex: number;
  } | null = null;

  for (let bounce = 0; bounce <= maxBounces; bounce++) {
    const wallHit = intersectPlayfieldWall(currOrigin, currDir, bounds, ballRadius);
    if (!wallHit) break;

    const pocketHit = intersectPocket(currOrigin, currDir, pockets, wallHit.t);
    const maxBallT = pocketHit ? pocketHit.t : wallHit.t;
    const ballHit = intersectRayWithBalls(currOrigin, currDir, objectBalls, ballRadius, maxBallT);

    if (ballHit) {
      cuePoints.push(ballHit.ghostCenter);
      totalCueLen += ballHit.t;
      hitResult = {
        ball: ballHit.ball,
        ghostCenter: ballHit.ghostCenter,
        incomingDir: currDir,
        bounceIndex: bounce,
      };
      break;
    }

    if (pocketHit) {
      cuePoints.push(pocketHit.point);
      totalCueLen += pocketHit.t;
      cuePocketed = pocketHit.pocket;
      break;
    }

    cuePoints.push(wallHit.point);
    totalCueLen += wallHit.t;

    if (bounce === maxBounces) break;

    const { nextDir, incidenceDeg, reflectionDeg } = reflectWithSpin(
      currDir,
      wallHit.normal,
      activeSpin
    );

    cueRebounds.push({
      index: bounce + 1,
      point: wallHit.point,
      rail: wallHit.rail,
      incidenceDeg,
      reflectionDeg,
    });

    activeSpin *= 0.55;
    currOrigin = {
      x: wallHit.point.x + wallHit.normal.x * 0.5,
      y: wallHit.point.y + wallHit.normal.y * 0.5,
    };
    currDir = nextDir;
  }

  const cueAimPath: RayPath = {
    points: cuePoints,
    rebounds: cueRebounds,
    pocketed: cuePocketed,
    totalLengthPx: totalCueLen,
  };

  if (!hitResult) {
    return {
      cueAimPath,
      objectBallPath: null,
      cueDeflectionPath: null,
      ghostBallCenter: null,
      hitBallId: null,
      hitOnBounceIndex: -1,
      cutAngleDeg: null,
      cutDirection: null,
      throwOffsetDeg: 0,
      aimAngleDeg,
    };
  }

  // Line of centers from ghost ball to object ball
  const lineOfCenters = normalize({
    x: hitResult.ball.x - hitResult.ghostCenter.x,
    y: hitResult.ball.y - hitResult.ghostCenter.y,
  });

  // Cut angle
  const cosCut = clamp(dot(hitResult.incomingDir, lineOfCenters), -1, 1);
  const cutAngleDeg = (Math.acos(cosCut) * 180) / Math.PI;
  const crossZ =
    hitResult.incomingDir.x * lineOfCenters.y - hitResult.incomingDir.y * lineOfCenters.x;

  let cutDirection: 'STRAIGHT' | 'LEFT CUT' | 'RIGHT CUT' = 'STRAIGHT';
  if (cutAngleDeg > 1.2) {
    cutDirection = crossZ > 0 ? 'LEFT CUT' : 'RIGHT CUT';
  }

  // Slight collision-induced + spin-induced throw (up to ±2.5 deg)
  const throwOffsetDeg = -english * 2.2;
  const throwRad = (throwOffsetDeg * Math.PI) / 180;
  const objAngle = Math.atan2(lineOfCenters.y, lineOfCenters.x) + throwRad;
  const objectDir = { x: Math.cos(objAngle), y: Math.sin(objAngle) };

  const objectBallPath = traceRayWithRebounds(
    { x: hitResult.ball.x, y: hitResult.ball.y },
    objectDir,
    bounds,
    ballRadius,
    Math.max(1, maxBounces),
    english * 0.25
  );

  // Cue ball deflection: 90-degree tangent line blended with follow (+1) or draw (-1)
  const perpA = { x: -lineOfCenters.y, y: lineOfCenters.x };
  const perpB = { x: lineOfCenters.y, y: -lineOfCenters.x };
  const tangentDir = dot(perpA, hitResult.incomingDir) >= 0 ? perpA : perpB;

  let deflectDir: Vec2;
  if (followDraw >= 0) {
    // Blend from tangent toward incoming aim line (follow curves forward)
    deflectDir = normalize({
      x: tangentDir.x * (1 - followDraw * 0.65) + hitResult.incomingDir.x * (followDraw * 0.65),
      y: tangentDir.y * (1 - followDraw * 0.65) + hitResult.incomingDir.y * (followDraw * 0.65),
    });
  } else {
    // Draw pulls back along opposite of incoming line
    const drawStrength = Math.abs(followDraw);
    deflectDir = normalize({
      x: tangentDir.x * (1 - drawStrength * 0.78) - hitResult.incomingDir.x * (drawStrength * 0.78),
      y: tangentDir.y * (1 - drawStrength * 0.78) - hitResult.incomingDir.y * (drawStrength * 0.78),
    });
  }

  const cueDeflectionPath = traceRayWithRebounds(
    hitResult.ghostCenter,
    deflectDir,
    bounds,
    ballRadius,
    Math.min(2, maxBounces),
    english
  );

  return {
    cueAimPath,
    objectBallPath,
    cueDeflectionPath,
    ghostBallCenter: hitResult.ghostCenter,
    hitBallId: hitResult.ball.id,
    hitOnBounceIndex: hitResult.bounceIndex,
    cutAngleDeg,
    cutDirection,
    throwOffsetDeg,
    aimAngleDeg,
  };
}
