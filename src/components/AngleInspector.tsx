import React from 'react';
import { RefreshCw, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { ShotAnalysis, TablePhysicalMetrics } from '../physics/poolMath';
import { TableDetectionResult } from '../vision/tableDetector';
import { OverlayVisualSettings } from './OverlayCanvas';

interface AngleInspectorProps {
  metrics: TablePhysicalMetrics;
  detectionInfo: TableDetectionResult | null;
  shotAnalysis: ShotAnalysis;
  maxRebounds: number;
  english: number;
  followDraw: number;
  visualSettings: OverlayVisualSettings;
  calibrationEditMode: boolean;
  onChangeMaxRebounds: (n: number) => void;
  onChangeEnglish: (val: number) => void;
  onChangeFollowDraw: (val: number) => void;
  onChangeVisualSettings: (next: OverlayVisualSettings) => void;
  onToggleCalibrationEdit: () => void;
  onReRunAutoDetect: () => void;
}

export const AngleInspector: React.FC<AngleInspectorProps> = ({
  metrics,
  detectionInfo,
  shotAnalysis,
  maxRebounds,
  english,
  followDraw,
  visualSettings,
  calibrationEditMode,
  onChangeMaxRebounds,
  onChangeEnglish,
  onChangeFollowDraw,
  onChangeVisualSettings,
  onToggleCalibrationEdit,
  onReRunAutoDetect,
}) => {
  const activeRebounds =
    shotAnalysis.objectBallPath?.rebounds.length
      ? shotAnalysis.objectBallPath.rebounds
      : shotAnalysis.cueAimPath.rebounds;

  const pocketStatus = shotAnalysis.objectBallPath?.pocketed
    ? `${shotAnalysis.objectBallPath.pocketed.label} Pocket`
    : shotAnalysis.cueAimPath.pocketed
      ? `Cue Scratch Risk (${shotAnalysis.cueAimPath.pocketed.label})`
      : 'Open Cushion Path';

  return (
    <aside className="flex flex-col divide-y divide-slate-800/90 rounded-xl border border-slate-800 bg-[#111720]">
      {/* Section 1: Auto-Table Size Calibration */}
      <section className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">Auto-Table Dimensions</h2>
          <div className="flex items-center gap-1.5">
            {detectionInfo && (
              <button
                type="button"
                onClick={onReRunAutoDetect}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/70 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Re-Detect
              </button>
            )}
            <button
              type="button"
              onClick={onToggleCalibrationEdit}
              className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                calibrationEditMode
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-300'
                  : 'border-slate-700 bg-slate-800/70 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {calibrationEditMode ? 'Done Bounds' : 'Adjust Bounds'}
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
          <div>
            <div className="text-slate-400">Detected Table Class</div>
            <div className="mt-0.5 font-medium text-emerald-400">{metrics.estimatedClass}</div>
          </div>
          <div>
            <div className="text-slate-400">Playfield Size</div>
            <div className="mt-0.5 font-mono-tabular font-medium text-slate-100">
              {metrics.pixelWidth} × {metrics.pixelHeight} px
            </div>
          </div>
          <div>
            <div className="text-slate-400">Physical Scale</div>
            <div className="mt-0.5 font-mono-tabular text-slate-200">
              {metrics.physicalInches.width}&quot; × {metrics.physicalInches.height}&quot; ({metrics.aspectRatio.toFixed(2)}:1)
            </div>
          </div>
          <div>
            <div className="text-slate-400">Diamond / Ball Radius</div>
            <div className="mt-0.5 font-mono-tabular text-slate-200">
              {Math.round(metrics.diamondSpacingPx)} px / {metrics.recommendedBallRadiusPx.toFixed(1)} px
            </div>
          </div>
        </div>

        {detectionInfo && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm border border-white/20"
              style={{
                backgroundColor: `rgb(${detectionInfo.dominantFeltRgb[0]}, ${detectionInfo.dominantFeltRgb[1]}, ${detectionInfo.dominantFeltRgb[2]})`,
              }}
            />
            <span>Felt Lock {detectionInfo.confidencePct}%</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{detectionInfo.detectedBalls.length} balls</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{detectionInfo.processingTimeMs} ms</span>
          </div>
        )}
      </section>

      {/* Section 2: Shot & Rebound Angle Telemetry */}
      <section className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-100">Shot &amp; Rebound Angles</h2>
          <span
            className={`text-xs font-medium ${
              shotAnalysis.objectBallPath?.pocketed
                ? 'text-emerald-400'
                : shotAnalysis.cueAimPath.pocketed
                  ? 'text-amber-400'
                  : 'text-slate-400'
            }`}
          >
            {pocketStatus}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-slate-800 bg-[#0B0F14] p-2.5">
          <div>
            <div className="text-[11px] text-slate-400">Aim Bearing</div>
            <div className="mt-0.5 font-mono-tabular text-sm font-semibold text-sky-400">
              {shotAnalysis.aimAngleDeg.toFixed(1)}°
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-400">Cut Angle</div>
            <div className="mt-0.5 font-mono-tabular text-sm font-semibold text-slate-100">
              {shotAnalysis.cutAngleDeg !== null ? `${shotAnalysis.cutAngleDeg.toFixed(1)}°` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-400">Direction</div>
            <div className="mt-0.5 text-xs font-medium text-slate-200 truncate">
              {shotAnalysis.cutDirection ?? 'Bank Only'}
            </div>
          </div>
        </div>

        {activeRebounds.length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-800/80">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0B0F14] text-slate-400">
                <tr>
                  <th className="px-2.5 py-1.5 font-medium">Bounce</th>
                  <th className="px-2.5 py-1.5 font-medium">Rail</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">In</th>
                  <th className="px-2.5 py-1.5 font-medium text-right">Out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono-tabular">
                {activeRebounds.map((rb) => (
                  <tr key={rb.index} className="text-slate-200">
                    <td className="px-2.5 py-1.5 text-amber-400">B{rb.index}</td>
                    <td className="px-2.5 py-1.5 font-sans text-slate-300">{rb.rail}</td>
                    <td className="px-2.5 py-1.5 text-right">{rb.incidenceDeg.toFixed(1)}°</td>
                    <td className="px-2.5 py-1.5 text-right text-sky-400">
                      {rb.reflectionDeg.toFixed(1)}°
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-400">
            Direct shot path active. Increase max bank rebounds or aim toward a rail to inspect cushion reflection angles.
          </p>
        )}
      </section>

      {/* Section 3: Spin, Rebound Depth & Overlay Optics */}
      <section className="space-y-4 p-4">
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200">Cushion Rebound Depth</span>
            <span className="font-mono-tabular text-slate-400">{maxRebounds} banks</span>
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1 rounded-lg bg-[#0B0F14] p-1">
            {[0, 1, 2, 3, 4].map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => onChangeMaxRebounds(count)}
                className={`min-h-[36px] rounded-md text-xs font-medium transition-colors ${
                  maxRebounds === count
                    ? 'bg-sky-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200">Side Spin (English)</span>
            <div className="flex items-center gap-2">
              <span className="font-mono-tabular text-sky-400">
                {english === 0
                  ? '0% Center'
                  : english < 0
                    ? `${Math.round(Math.abs(english) * 100)}% Left`
                    : `${Math.round(english * 100)}% Right`}
              </span>
              {english !== 0 && (
                <button
                  type="button"
                  onClick={() => onChangeEnglish(0)}
                  aria-label="Reset side spin"
                  className="text-slate-400 hover:text-slate-200"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={english}
            onChange={(e) => onChangeEnglish(parseFloat(e.target.value))}
            className="precision-slider mt-2 w-full"
          />
        </div>

        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200">Follow / Draw Deflection</span>
            <div className="flex items-center gap-2">
              <span className="font-mono-tabular text-violet-400">
                {followDraw === 0
                  ? 'Stun (90°)'
                  : followDraw < 0
                    ? `${Math.round(Math.abs(followDraw) * 100)}% Draw`
                    : `${Math.round(followDraw * 100)}% Follow`}
              </span>
              {followDraw !== 0 && (
                <button
                  type="button"
                  onClick={() => onChangeFollowDraw(0)}
                  aria-label="Reset follow draw"
                  className="text-slate-400 hover:text-slate-200"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={followDraw}
            onChange={(e) => onChangeFollowDraw(parseFloat(e.target.value))}
            className="precision-slider mt-2 w-full"
          />
        </div>

        <div className="pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200">Overlay Opacity</span>
            <span className="font-mono-tabular text-slate-400">
              {Math.round(visualSettings.lineOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.35}
            max={1}
            step={0.05}
            value={visualSettings.lineOpacity}
            onChange={(e) =>
              onChangeVisualSettings({
                ...visualSettings,
                lineOpacity: parseFloat(e.target.value),
              })
            }
            className="precision-slider mt-2 w-full"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() =>
              onChangeVisualSettings({
                ...visualSettings,
                showCueDeflection: !visualSettings.showCueDeflection,
              })
            }
            className={`min-h-[38px] rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              visualSettings.showCueDeflection
                ? 'border-violet-500/50 bg-violet-500/15 text-violet-200'
                : 'border-slate-800 bg-[#0B0F14] text-slate-400 hover:text-slate-200'
            }`}
          >
            Tangent Line
          </button>
          <button
            type="button"
            onClick={() =>
              onChangeVisualSettings({
                ...visualSettings,
                showDiamondGrid: !visualSettings.showDiamondGrid,
              })
            }
            className={`min-h-[38px] rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              visualSettings.showDiamondGrid
                ? 'border-sky-500/50 bg-sky-500/15 text-sky-200'
                : 'border-slate-800 bg-[#0B0F14] text-slate-400 hover:text-slate-200'
            }`}
          >
            Diamond Grid
          </button>
          <button
            type="button"
            onClick={() =>
              onChangeVisualSettings({
                ...visualSettings,
                showReboundAngles: !visualSettings.showReboundAngles,
              })
            }
            className={`min-h-[38px] rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              visualSettings.showReboundAngles
                ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                : 'border-slate-800 bg-[#0B0F14] text-slate-400 hover:text-slate-200'
            }`}
          >
            Angle Labels
          </button>
          <button
            type="button"
            onClick={() =>
              onChangeVisualSettings({
                ...visualSettings,
                showTableRuler: !visualSettings.showTableRuler,
              })
            }
            className={`min-h-[38px] rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              visualSettings.showTableRuler
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                : 'border-slate-800 bg-[#0B0F14] text-slate-400 hover:text-slate-200'
            }`}
          >
            Table Ruler
          </button>
        </div>
      </section>
    </aside>
  );
};
