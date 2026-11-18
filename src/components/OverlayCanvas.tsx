import React, { useEffect, useRef, useState } from 'react';
import {
  PoolBall,
  ShotAnalysis,
  TableBounds,
  TablePhysicalMetrics,
  Vec2,
  clamp,
  getPockets,
  normalize,
} from '../physics/poolMath';

export interface OverlayVisualSettings {
  showExtendedAim: boolean;
  showReboundAngles: boolean;
  showCueDeflection: boolean;
  showDiamondGrid: boolean;
  showTableRuler: boolean;
  lineOpacity: number;
  lineWidth: number;
}

interface OverlayCanvasProps {
  stageWidth: number;
  stageHeight: number;
  screenshotUrl: string | null;
  bounds: TableBounds;
  metrics: TablePhysicalMetrics;
  cueBall: Vec2;
  objectBalls: PoolBall[];
  aimDir: Vec2;
  ballRadius: number;
  shotAnalysis: ShotAnalysis;
  visualSettings: OverlayVisualSettings;
  calibrationEditMode: boolean;
  overlayLocked: boolean;
  onChangeCueBall: (pos: Vec2) => void;
  onChangeObjectBall: (id: number, pos: Vec2) => void;
  onChangeAimDir: (dir: Vec2) => void;
  onChangeBounds: (bounds: TableBounds) => void;
}

type DragTarget =
  | { type: 'cue' }
  | { type: 'ball'; id: number }
  | { type: 'aim' }
  | { type: 'corner-tl' }
  | { type: 'corner-br' }
  | null;

export const OverlayCanvas: React.FC<OverlayCanvasProps> = ({
  stageWidth,
  stageHeight,
  screenshotUrl,
  bounds,
  metrics,
  cueBall,
  objectBalls,
  aimDir,
  ballRadius,
  shotAnalysis,
  visualSettings,
  calibrationEditMode,
  overlayLocked,
  onChangeCueBall,
  onChangeObjectBall,
  onChangeAimDir,
  onChangeBounds,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [imageLoadedTick, setImageLoadedTick] = useState(0);

  // Load background screenshot image when URL changes
  useEffect(() => {
    if (!screenshotUrl) {
      bgImageRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      bgImageRef.current = img;
      setImageLoadedTick((t) => t + 1);
    };
    img.src = screenshotUrl;
  }, [screenshotUrl]);

  // Compute interactive aim handle position (140px ahead of cue ball along aimDir, or at ghost ball)
  const aimHandleDist = clamp(Math.min(bounds.width, bounds.height) * 0.28, 70, 150);
  const aimHandlePos: Vec2 = {
    x: cueBall.x + aimDir.x * aimHandleDist,
    y: cueBall.y + aimDir.y * aimHandleDist,
  };

  // Render full precision canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = stageWidth * dpr;
    canvas.height = stageHeight * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, stageWidth, stageHeight);

    // 1. Background: Screenshot or Built-in Tournament Table
    if (screenshotUrl && bgImageRef.current) {
      ctx.drawImage(bgImageRef.current, 0, 0, stageWidth, stageHeight);
      // Slight contrast scrim so overlay optics remain readable on bright frames
      ctx.fillStyle = 'rgba(7, 11, 16, 0.14)';
      ctx.fillRect(0, 0, stageWidth, stageHeight);
    } else {
      // Dark studio backdrop
      ctx.fillStyle = '#0D1219';
      ctx.fillRect(0, 0, stageWidth, stageHeight);

      // Subtle blueprint dot grid outside table
      ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
      for (let gx = 24; gx < stageWidth; gx += 28) {
        for (let gy = 24; gy < stageHeight; gy += 28) {
          ctx.fillRect(gx, gy, 1.5, 1.5);
        }
      }

      // Table outer wooden/slate rail frame
      const railThickness = Math.max(26, Math.round(ballRadius * 2.1));
      const outerX = bounds.x - railThickness;
      const outerY = bounds.y - railThickness;
      const outerW = bounds.width + railThickness * 2;
      const outerH = bounds.height + railThickness * 2;

      // Drop shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.beginPath();
      ctx.roundRect(outerX + 4, outerY + 10, outerW, outerH, 22);
      ctx.fill();

      // Matte walnut / dark mahogany rail
      const railGrad = ctx.createLinearGradient(outerX, outerY, outerX, outerY + outerH);
      railGrad.addColorStop(0, '#3D2314');
      railGrad.addColorStop(0.5, '#2C180E');
      railGrad.addColorStop(1, '#201109');
      ctx.fillStyle = railGrad;
      ctx.beginPath();
      ctx.roundRect(outerX, outerY, outerW, outerH, 20);
      ctx.fill();

      // Subtle metallic corner trim accents
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.14)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner cushion rim
      const cushionRim = Math.max(8, Math.round(ballRadius * 0.65));
      ctx.fillStyle = '#093B25';
      ctx.fillRect(
        bounds.x - cushionRim,
        bounds.y - cushionRim,
        bounds.width + cushionRim * 2,
        bounds.height + cushionRim * 2
      );

      // Tournament emerald felt surface
      const feltGrad = ctx.createRadialGradient(
        bounds.x + bounds.width * 0.5,
        bounds.y + bounds.height * 0.5,
        bounds.height * 0.1,
        bounds.x + bounds.width * 0.5,
        bounds.y + bounds.height * 0.5,
        bounds.width * 0.7
      );
      feltGrad.addColorStop(0, '#12613F');
      feltGrad.addColorStop(1, '#0C472D');
      ctx.fillStyle = feltGrad;
      ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

      // Baulk / Head string & Foot spot
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1.2;
      if (bounds.width >= bounds.height) {
        const headX = bounds.x + bounds.width * 0.25;
        ctx.beginPath();
        ctx.moveTo(headX, bounds.y);
        ctx.lineTo(headX, bounds.y + bounds.height);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
        ctx.beginPath();
        ctx.arc(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.5, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const headY = bounds.y + bounds.height * 0.75;
        ctx.beginPath();
        ctx.moveTo(bounds.x, headY);
        ctx.lineTo(bounds.x + bounds.width, headY);
        ctx.stroke();
      }

      // Rail diamonds (8 divisions along long axis, 4 along short axis)
      ctx.fillStyle = '#D4AF37';
      const longDivs = 8;
      const shortDivs = 4;
      const diamondOffset = railThickness * 0.55;
      if (bounds.width >= bounds.height) {
        for (let i = 1; i < longDivs; i++) {
          if (i === 4) continue;
          const dx = bounds.x + (bounds.width / longDivs) * i;
          drawDiamond(ctx, dx, bounds.y - diamondOffset, 3.5);
          drawDiamond(ctx, dx, bounds.y + bounds.height + diamondOffset, 3.5);
        }
        for (let i = 1; i < shortDivs; i++) {
          const dy = bounds.y + (bounds.height / shortDivs) * i;
          drawDiamond(ctx, bounds.x - diamondOffset, dy, 3.5);
          drawDiamond(ctx, bounds.x + bounds.width + diamondOffset, dy, 3.5);
        }
      } else {
        for (let i = 1; i < longDivs; i++) {
          if (i === 4) continue;
          const dy = bounds.y + (bounds.height / longDivs) * i;
          drawDiamond(ctx, bounds.x - diamondOffset, dy, 3.5);
          drawDiamond(ctx, bounds.x + bounds.width + diamondOffset, dy, 3.5);
        }
        for (let i = 1; i < shortDivs; i++) {
          const dx = bounds.x + (bounds.width / shortDivs) * i;
          drawDiamond(ctx, dx, bounds.y - diamondOffset, 3.5);
          drawDiamond(ctx, dx, bounds.y + bounds.height + diamondOffset, 3.5);
        }
      }

      // 6 pockets
      const pockets = getPockets(bounds, ballRadius);
      for (const p of pockets) {
        ctx.fillStyle = '#05080B';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(212, 175, 55, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // 2. Diamond Sight Grid Overlay (if enabled)
    if (visualSettings.showDiamondGrid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      const xSteps = bounds.width >= bounds.height ? 8 : 4;
      const ySteps = bounds.width >= bounds.height ? 4 : 8;
      for (let i = 1; i < xSteps; i++) {
        const gx = bounds.x + (bounds.width / xSteps) * i;
        ctx.beginPath();
        ctx.moveTo(gx, bounds.y);
        ctx.lineTo(gx, bounds.y + bounds.height);
        ctx.stroke();
      }
      for (let i = 1; i < ySteps; i++) {
        const gy = bounds.y + (bounds.height / ySteps) * i;
        ctx.beginPath();
        ctx.moveTo(bounds.x, gy);
        ctx.lineTo(bounds.x + bounds.width, gy);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Auto-Detected Table Bounding Box & Dimension Rulers
    if (visualSettings.showTableRuler || screenshotUrl || calibrationEditMode) {
      ctx.save();
      ctx.strokeStyle = calibrationEditMode
        ? '#38BDF8'
        : 'rgba(16, 185, 129, 0.65)';
      ctx.lineWidth = calibrationEditMode ? 2 : 1.5;
      ctx.setLineDash(calibrationEditMode ? [] : [8, 5]);
      ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      ctx.setLineDash([]);

      // Dimension label along top edge
      const lockSuffix = overlayLocked ? ' · LOCKED (SHOOT)' : '';
      const dimLabel = `${Math.round(bounds.width)} × ${Math.round(bounds.height)} px · ${metrics.aspectRatio.toFixed(2)}:1 · ${metrics.estimatedClass}${lockSuffix}`;
      ctx.font = '500 11px "JetBrains Mono", monospace';
      const textW = ctx.measureText(dimLabel).width;
      const pillX = bounds.x + 12;
      const pillY = Math.max(8, bounds.y - 24);
      ctx.fillStyle = 'rgba(11, 15, 20, 0.86)';
      ctx.fillRect(pillX - 6, pillY - 12, textW + 12, 18);
      ctx.fillStyle = overlayLocked ? '#10B981' : '#34D399';
      ctx.fillText(dimLabel, pillX, pillY + 1);

      if (calibrationEditMode && !overlayLocked) {
        // Draw draggable TL and BR corner calibration handles
        drawCornerHandle(ctx, bounds.x, bounds.y, 'TL');
        drawCornerHandle(ctx, bounds.x + bounds.width, bounds.y + bounds.height, 'BR');
      }
      ctx.restore();
    }

    // 4. Overlay Trajectory & Rebound Lines
    ctx.save();
    ctx.globalAlpha = visualSettings.lineOpacity;
    const lw = visualSettings.lineWidth;

    if (visualSettings.showExtendedAim) {
      const cuePts = shotAnalysis.cueAimPath.points;
      if (cuePts.length >= 2) {
        // Primary ray (cue -> first hit or wall)
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = lw;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        ctx.moveTo(cuePts[0].x, cuePts[0].y);
        ctx.lineTo(cuePts[1].x, cuePts[1].y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Subsequent bank rebound segments for cue ball
        if (cuePts.length > 2) {
          ctx.strokeStyle = '#F59E0B';
          ctx.lineWidth = Math.max(1.5, lw - 0.5);
          ctx.beginPath();
          ctx.moveTo(cuePts[1].x, cuePts[1].y);
          for (let i = 2; i < cuePts.length; i++) {
            ctx.lineTo(cuePts[i].x, cuePts[i].y);
          }
          ctx.stroke();
        }
      }

      // Draw cue rebound angle nodes
      if (visualSettings.showReboundAngles) {
        for (const rb of shotAnalysis.cueAimPath.rebounds) {
          drawReboundBadge(ctx, rb.point, `B${rb.index} ${rb.reflectionDeg.toFixed(1)}°`, '#F59E0B');
        }
      }
    }

    // Object Ball Target Path & Rebounds
    if (shotAnalysis.objectBallPath && shotAnalysis.ghostBallCenter) {
      const objPts = shotAnalysis.objectBallPath.points;
      if (objPts.length >= 2) {
        ctx.strokeStyle = shotAnalysis.objectBallPath.pocketed ? '#10B981' : '#FB7185';
        ctx.lineWidth = lw + 0.5;
        ctx.beginPath();
        ctx.moveTo(objPts[0].x, objPts[0].y);
        for (let i = 1; i < objPts.length; i++) {
          ctx.lineTo(objPts[i].x, objPts[i].y);
        }
        ctx.stroke();

        // Highlight target pocket if pocketed
        if (shotAnalysis.objectBallPath.pocketed) {
          const p = shotAnalysis.objectBallPath.pocketed;
          ctx.strokeStyle = '#10B981';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius + 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (visualSettings.showReboundAngles) {
          for (const rb of shotAnalysis.objectBallPath.rebounds) {
            drawReboundBadge(
              ctx,
              rb.point,
              `O${rb.index} ${rb.reflectionDeg.toFixed(1)}°`,
              shotAnalysis.objectBallPath.pocketed ? '#10B981' : '#FB7185'
            );
          }
        }
      }

      // Ghost ball impact circle
      const gb = shotAnalysis.ghostBallCenter;
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 1.75;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(gb.x, gb.y, ballRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Ghost ball center dot
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.arc(gb.x, gb.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cue Ball Deflection / Tangent Line
    if (visualSettings.showCueDeflection && shotAnalysis.cueDeflectionPath) {
      const defPts = shotAnalysis.cueDeflectionPath.points;
      if (defPts.length >= 2) {
        ctx.strokeStyle = '#A78BFA';
        ctx.lineWidth = Math.max(1.5, lw - 0.5);
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(defPts[0].x, defPts[0].y);
        for (let i = 1; i < defPts.length; i++) {
          ctx.lineTo(defPts[i].x, defPts[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.restore();

    // 5. Render Balls (in interactive mode, OR draggable markers over screenshot)
    if (!screenshotUrl) {
      for (const ball of objectBalls) {
        drawPoolBall(ctx, ball.x, ball.y, ballRadius, ball.color, ball.id, ball.stripe);
      }
      drawPoolBall(ctx, cueBall.x, cueBall.y, ballRadius, '#F8FAFC', 0, false, true);
    } else {
      // Over screenshot: draw crisp semi-transparent targeting reticles on Cue & Object balls
      for (const ball of objectBalls) {
        drawReticle(ctx, ball.x, ball.y, ballRadius, ball.color, `B${ball.id}`);
      }
      drawReticle(ctx, cueBall.x, cueBall.y, ballRadius, '#38BDF8', 'CUE');
    }

    // 6. Cue Stick & Aim Drag Handle
    if (!screenshotUrl) {
      const stickStart = ballRadius + 10;
      const stickEnd = stickStart + 135;
      ctx.save();
      ctx.strokeStyle = '#E2C391';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cueBall.x - aimDir.x * stickStart, cueBall.y - aimDir.y * stickStart);
      ctx.lineTo(cueBall.x - aimDir.x * stickEnd, cueBall.y - aimDir.y * stickEnd);
      ctx.stroke();

      // Cue tip
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(cueBall.x - aimDir.x * stickStart, cueBall.y - aimDir.y * stickStart);
      ctx.lineTo(cueBall.x - aimDir.x * (stickStart + 6), cueBall.y - aimDir.y * (stickStart + 6));
      ctx.stroke();
      ctx.restore();
    }

    // Interactive Aim Drag Handle
    ctx.save();
    ctx.fillStyle = 'rgba(11, 15, 20, 0.85)';
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(aimHandlePos.x, aimHandlePos.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.arc(aimHandlePos.x, aimHandlePos.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }, [
    stageWidth,
    stageHeight,
    screenshotUrl,
    imageLoadedTick,
    bounds,
    metrics,
    cueBall,
    objectBalls,
    aimDir,
    ballRadius,
    shotAnalysis,
    visualSettings,
    calibrationEditMode,
    overlayLocked,
    aimHandlePos.x,
    aimHandlePos.y,
  ]);

  const getLocalCoords = (e: React.PointerEvent<HTMLCanvasElement>): Vec2 => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = stageWidth / rect.width;
    const scaleY = stageHeight / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (overlayLocked) return;
    const pt = getLocalCoords(e);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (calibrationEditMode) {
      if (Math.hypot(pt.x - bounds.x, pt.y - bounds.y) < 26) {
        setDragTarget({ type: 'corner-tl' });
        return;
      }
      if (
        Math.hypot(pt.x - (bounds.x + bounds.width), pt.y - (bounds.y + bounds.height)) < 26
      ) {
        setDragTarget({ type: 'corner-br' });
        return;
      }
    }

    const hitThreshold = Math.max(22, ballRadius + 10);

    // Check aim handle first
    if (Math.hypot(pt.x - aimHandlePos.x, pt.y - aimHandlePos.y) <= 22) {
      setDragTarget({ type: 'aim' });
      return;
    }

    // Check cue ball
    if (Math.hypot(pt.x - cueBall.x, pt.y - cueBall.y) <= hitThreshold) {
      setDragTarget({ type: 'cue' });
      return;
    }

    // Check object balls
    for (const ball of objectBalls) {
      if (Math.hypot(pt.x - ball.x, pt.y - ball.y) <= hitThreshold) {
        setDragTarget({ type: 'ball', id: ball.id });
        return;
      }
    }

    // Clicking anywhere else rotates aim vector immediately toward tapped point
    const nextDir = normalize({ x: pt.x - cueBall.x, y: pt.y - cueBall.y });
    onChangeAimDir(nextDir);
    setDragTarget({ type: 'aim' });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragTarget) return;
    const pt = getLocalCoords(e);

    if (dragTarget.type === 'cue') {
      onChangeCueBall({
        x: clamp(pt.x, bounds.x + ballRadius, bounds.x + bounds.width - ballRadius),
        y: clamp(pt.y, bounds.y + ballRadius, bounds.y + bounds.height - ballRadius),
      });
    } else if (dragTarget.type === 'ball') {
      onChangeObjectBall(dragTarget.id, {
        x: clamp(pt.x, bounds.x + ballRadius, bounds.x + bounds.width - ballRadius),
        y: clamp(pt.y, bounds.y + ballRadius, bounds.y + bounds.height - ballRadius),
      });
    } else if (dragTarget.type === 'aim') {
      if (Math.hypot(pt.x - cueBall.x, pt.y - cueBall.y) > 8) {
        onChangeAimDir(normalize({ x: pt.x - cueBall.x, y: pt.y - cueBall.y }));
      }
    } else if (dragTarget.type === 'corner-tl') {
      const right = bounds.x + bounds.width;
      const bottom = bounds.y + bounds.height;
      const nx = clamp(pt.x, 12, right - 140);
      const ny = clamp(pt.y, 12, bottom - 90);
      onChangeBounds({ x: nx, y: ny, width: right - nx, height: bottom - ny });
    } else if (dragTarget.type === 'corner-br') {
      const nw = clamp(pt.x - bounds.x, 140, stageWidth - bounds.x - 12);
      const nh = clamp(pt.y - bounds.y, 90, stageHeight - bounds.y - 12);
      onChangeBounds({ ...bounds, width: nw, height: nh });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragTarget) {
      setDragTarget(null);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if not captured
      }
    }
  };

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-slate-800 bg-[#0D1219]">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ aspectRatio: `${stageWidth} / ${stageHeight}` }}
        className={`block w-full touch-none select-none ${overlayLocked ? 'cursor-default' : 'cursor-crosshair'}`}
      />
    </div>
  );
};

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}

function drawCornerHandle(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  ctx.fillStyle = '#0B0F14';
  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#38BDF8';
  ctx.font = '600 9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 0.5);
}

function drawReboundBadge(
  ctx: CanvasRenderingContext2D,
  pt: Vec2,
  label: string,
  color: string
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = '600 10px "JetBrains Mono", monospace';
  const w = ctx.measureText(label).width + 10;
  const bx = pt.x - w * 0.5;
  const by = pt.y - 22;
  ctx.fillStyle = 'rgba(11, 15, 20, 0.9)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.fillRect(bx, by, w, 16);
  ctx.strokeRect(bx, by, w, 16);

  ctx.fillStyle = '#F8FAFC';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, pt.x, by + 8.5);
  ctx.restore();
}

function drawPoolBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  num: number,
  stripe?: boolean,
  isCue?: boolean
) {
  ctx.save();
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.beginPath();
  ctx.arc(x + 2, y + 3, r, 0, Math.PI * 2);
  ctx.fill();

  // Sphere base
  ctx.fillStyle = stripe ? '#F8FAFC' : color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  if (stripe) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(x - r, y - r * 0.48, r * 2, r * 0.96);
    ctx.restore();
  }

  // Gloss highlight
  const spec = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  spec.addColorStop(0, 'rgba(255,255,255,0.45)');
  spec.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  spec.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  if (!isCue && num > 0) {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0F172A';
    ctx.font = `700 ${Math.max(8, Math.round(r * 0.65))}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), x, y + 0.5);
  }
  ctx.restore();
}

function drawReticle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  tag: string
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(11, 15, 20, 0.85)';
  ctx.font = '600 9px "JetBrains Mono", monospace';
  const tw = ctx.measureText(tag).width + 8;
  ctx.fillRect(x - tw * 0.5, y + r + 5, tw, 13);
  ctx.fillStyle = '#F8FAFC';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tag, x, y + r + 11.5);
  ctx.restore();
}
