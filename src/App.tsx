import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Crosshair, ImagePlus, Lock, RotateCcw, Smartphone, Unlock } from 'lucide-react';
import {
  PoolBall,
  TableBounds,
  Vec2,
  analyzePoolShot,
  calculateTableMetrics,
  normalize,
} from './physics/poolMath';
import { TableDetectionResult, detectPoolTableFromImageData } from './vision/tableDetector';
import { SAMPLE_SCREENSHOTS, SampleScreenshotSpec, generateAndroidPoolScreenshot } from './vision/sampleScreenshots';
import { OverlayCanvas, OverlayVisualSettings } from './components/OverlayCanvas';
import { AngleInspector } from './components/AngleInspector';
import { AndroidExportView } from './components/AndroidExportView';

type AppTab = 'lab' | 'calibrate' | 'android';

interface TablePreset {
  id: string;
  label: string;
  bounds: TableBounds;
  cueBall: Vec2;
  objectBalls: PoolBall[];
  aimDir: Vec2;
}

const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;

const TABLE_PRESETS: TablePreset[] = [
  {
    id: 'cut-9ft',
    label: '9 ft Pro · Cut & Bank',
    bounds: { x: 140, y: 110, width: 1000, height: 500 },
    cueBall: { x: 390, y: 405 },
    objectBalls: [
      { id: 1, x: 760, y: 270, color: '#EAB308' },
      { id: 8, x: 890, y: 455, color: '#1E293B' },
      { id: 3, x: 640, y: 495, color: '#DC2626' },
    ],
    aimDir: normalize({ x: 356, y: -120 }),
  },
  {
    id: 'bank-8ft',
    label: '8 ft Home · Cross-Rail Bank',
    bounds: { x: 180, y: 130, width: 920, height: 460 },
    cueBall: { x: 420, y: 360 },
    objectBalls: [
      { id: 2, x: 690, y: 265, color: '#2563EB' },
      { id: 9, x: 910, y: 360, color: '#EAB308', stripe: true },
    ],
    aimDir: normalize({ x: 265, y: -115 }),
  },
  {
    id: 'kick-7ft',
    label: '7 ft Bar Box · 2-Rail Kick',
    bounds: { x: 240, y: 160, width: 800, height: 400 },
    cueBall: { x: 380, y: 460 },
    objectBalls: [
      { id: 5, x: 845, y: 265, color: '#F97316' },
      { id: 8, x: 620, y: 360, color: '#1E293B' },
    ],
    aimDir: normalize({ x: 195, y: -275 }),
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('lab');
  const [activePresetId, setActivePresetId] = useState<string>(TABLE_PRESETS[0].id);

  const [bounds, setBounds] = useState<TableBounds>(TABLE_PRESETS[0].bounds);
  const [cueBall, setCueBall] = useState<Vec2>(TABLE_PRESETS[0].cueBall);
  const [objectBalls, setObjectBalls] = useState<PoolBall[]>(TABLE_PRESETS[0].objectBalls);
  const [aimDir, setAimDir] = useState<Vec2>(TABLE_PRESETS[0].aimDir);

  const [maxRebounds, setMaxRebounds] = useState<number>(3);
  const [english, setEnglish] = useState<number>(0);
  const [followDraw, setFollowDraw] = useState<number>(0);
  const [calibrationEditMode, setCalibrationEditMode] = useState<boolean>(false);
  const [overlayLocked, setOverlayLocked] = useState<boolean>(false);

  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [detectionInfo, setDetectionInfo] = useState<TableDetectionResult | null>(null);
  const [detectedBallRadius, setDetectedBallRadius] = useState<number | undefined>(undefined);
  const [detectError, setDetectError] = useState<string | null>(null);

  const [visualSettings, setVisualSettings] = useState<OverlayVisualSettings>({
    showExtendedAim: true,
    showReboundAngles: true,
    showCueDeflection: true,
    showDiamondGrid: false,
    showTableRuler: true,
    lineOpacity: 0.92,
    lineWidth: 2.5,
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const metrics = useMemo(
    () => calculateTableMetrics(bounds, detectedBallRadius),
    [bounds, detectedBallRadius]
  );

  const shotAnalysis = useMemo(
    () =>
      analyzePoolShot({
        cueBall,
        aimDir,
        objectBalls,
        bounds,
        ballRadius: metrics.recommendedBallRadiusPx,
        maxBounces: maxRebounds,
        english,
        followDraw,
      }),
    [cueBall, aimDir, objectBalls, bounds, metrics.recommendedBallRadiusPx, maxRebounds, english, followDraw]
  );

  const runDetectionOnImageUrl = useCallback((url: string) => {
    setDetectError(null);
    const img = new Image();
    img.onload = () => {
      const offscreen = document.createElement('canvas');
      offscreen.width = STAGE_WIDTH;
      offscreen.height = STAGE_HEIGHT;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;

      // Fit screenshot proportionally inside stage or fill stage cleanly
      ctx.fillStyle = '#0A0D12';
      ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
      const scale = Math.min(STAGE_WIDTH / img.width, STAGE_HEIGHT / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const drawX = (STAGE_WIDTH - drawW) * 0.5;
      const drawY = (STAGE_HEIGHT - drawH) * 0.5;
      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      const normalizedUrl = offscreen.toDataURL('image/png');
      const imageData = ctx.getImageData(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
      const result = detectPoolTableFromImageData(imageData);

      setScreenshotUrl(normalizedUrl);
      setDetectionInfo(result);
      setBounds(result.bounds);
      setDetectedBallRadius(result.metrics.recommendedBallRadiusPx);

      if (result.detectedBalls.length >= 2) {
        const [cue, ...others] = result.detectedBalls;
        setCueBall({ x: cue.x, y: cue.y });
        setObjectBalls(others);
        setAimDir(normalize({ x: others[0].x - cue.x, y: others[0].y - cue.y }));
      } else {
        setCueBall({
          x: result.bounds.x + result.bounds.width * 0.28,
          y: result.bounds.y + result.bounds.height * 0.5,
        });
        setObjectBalls([
          {
            id: 1,
            x: result.bounds.x + result.bounds.width * 0.72,
            y: result.bounds.y + result.bounds.height * 0.36,
            color: '#EAB308',
          },
        ]);
        setAimDir(normalize({ x: 1, y: -0.25 }));
      }
      setActiveTab('calibrate');
    };
    img.onerror = () => {
      setDetectError('Unable to decode image frame. Try a PNG or JPG pool screenshot.');
    };
    img.src = url;
  }, []);

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        runDetectionOnImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleLoadSampleFrame = (spec: SampleScreenshotSpec) => {
    const dataUrl = generateAndroidPoolScreenshot(spec);
    runDetectionOnImageUrl(dataUrl);
  };

  const handleSelectPreset = (preset: TablePreset) => {
    setActivePresetId(preset.id);
    setScreenshotUrl(null);
    setDetectionInfo(null);
    setDetectedBallRadius(undefined);
    setBounds(preset.bounds);
    setCueBall(preset.cueBall);
    setObjectBalls(preset.objectBalls);
    setAimDir(preset.aimDir);
    setCalibrationEditMode(false);
    setActiveTab('lab');
  };

  const handleClearScreenshot = () => {
    const preset = TABLE_PRESETS.find((p) => p.id === activePresetId) ?? TABLE_PRESETS[0];
    handleSelectPreset(preset);
  };

  const handleChangeObjectBall = (id: number, pos: Vec2) => {
    setObjectBalls((prev) => prev.map((b) => (b.id === id ? { ...b, x: pos.x, y: pos.y } : b)));
  };

  return (
    <div className="min-h-screen bg-[#0B0F14] text-slate-100">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#0B0F14]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-8 px-4 sm:px-6">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('lab')}
            className="font-display text-lg font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
          >
            CueSight
          </button>

          {/* Zone 2: Clean single-line text navigation links */}
          <nav className="flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setActiveTab('lab')}
              className={`border-b-2 py-4 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'lab'
                  ? 'border-sky-400 text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Overlay Lab
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('calibrate')}
              className={`border-b-2 py-4 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'calibrate'
                  ? 'border-sky-400 text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Auto-Calibrate
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('android')}
              className={`border-b-2 py-4 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'android'
                  ? 'border-sky-400 text-slate-100'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Android Service
            </button>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[38px] items-center gap-2 rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-sky-400 whitespace-nowrap shrink-0"
            >
              <ImagePlus className="h-4 w-4" />
              <span className="hidden sm:inline">Upload Screenshot</span>
              <span className="sm:hidden">Upload</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6">
        {activeTab === 'android' ? (
          <AndroidExportView />
        ) : (
          <div className="space-y-4">
            {/* Workspace Sub-Toolbar (below header) */}
            <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-[#111720] p-3 sm:flex-row sm:items-center sm:justify-between">
              {activeTab === 'lab' && !screenshotUrl ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {TABLE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        activePresetId === preset.id
                          ? 'bg-slate-800 text-sky-300'
                          : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-300">Sample Android Frames:</span>
                  {SAMPLE_SCREENSHOTS.map((spec) => (
                    <button
                      key={spec.id}
                      type="button"
                      onClick={() => handleLoadSampleFrame(spec)}
                      className="min-h-[36px] rounded-lg border border-slate-700/80 bg-[#0B0F14] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-sky-500/50 hover:text-sky-300 whitespace-nowrap shrink-0"
                    >
                      {spec.label}
                    </button>
                  ))}
                  {screenshotUrl && (
                    <button
                      type="button"
                      onClick={handleClearScreenshot}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Back to Live Table
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <button
                  type="button"
                  onClick={() => setOverlayLocked((v) => !v)}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    overlayLocked
                      ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                      : 'border border-slate-700 bg-slate-800/80 text-slate-100 hover:bg-slate-700'
                  }`}
                >
                  {overlayLocked ? (
                    <>
                      <Lock className="h-3.5 w-3.5" />
                      LOCKED · Shoot
                    </>
                  ) : (
                    <>
                      <Unlock className="h-3.5 w-3.5 text-sky-400" />
                      Lock to Shoot
                    </>
                  )}
                </button>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <Crosshair className="h-3.5 w-3.5 text-sky-400" />
                  {overlayLocked ? 'Overlay locked against taps' : 'Drag balls or tap felt to aim'}
                </span>
                {activeTab === 'lab' && !screenshotUrl && (
                  <button
                    type="button"
                    onClick={() => handleLoadSampleFrame(SAMPLE_SCREENSHOTS[0])}
                    className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                    Test Auto-Detect Frame
                  </button>
                )}
              </div>
            </div>

            {detectError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
                {detectError}
              </div>
            )}

            {/* Main 2-Column Workspace: Dominant Table Viewport + Precision Telemetry Inspector */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
              <div className="space-y-3">
                <OverlayCanvas
                  stageWidth={STAGE_WIDTH}
                  stageHeight={STAGE_HEIGHT}
                  screenshotUrl={screenshotUrl}
                  bounds={bounds}
                  metrics={metrics}
                  cueBall={cueBall}
                  objectBalls={objectBalls}
                  aimDir={aimDir}
                  ballRadius={metrics.recommendedBallRadiusPx}
                  shotAnalysis={shotAnalysis}
                  visualSettings={visualSettings}
                  calibrationEditMode={calibrationEditMode}
                  overlayLocked={overlayLocked}
                  onChangeCueBall={setCueBall}
                  onChangeObjectBall={handleChangeObjectBall}
                  onChangeAimDir={setAimDir}
                  onChangeBounds={(next) => {
                    setBounds(next);
                    setDetectedBallRadius(undefined);
                  }}
                />

                {/* Compact Legend Strip under table */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-[#111720] px-4 py-2.5 text-xs text-slate-300">
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-4 bg-sky-400" />
                      Extended Cue Line
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-4 bg-amber-400" />
                      Bank Rebounds
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-4 bg-emerald-400" />
                      Object Ball Target
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-4 bg-violet-400" />
                      90° Tangent / Spin
                    </span>
                  </div>
                  <div className="font-mono-tabular text-slate-400">
                    {metrics.pixelWidth} × {metrics.pixelHeight} px · {metrics.estimatedClass}
                  </div>
                </div>
              </div>

              <AngleInspector
                metrics={metrics}
                detectionInfo={detectionInfo}
                shotAnalysis={shotAnalysis}
                maxRebounds={maxRebounds}
                english={english}
                followDraw={followDraw}
                visualSettings={visualSettings}
                calibrationEditMode={calibrationEditMode}
                onChangeMaxRebounds={setMaxRebounds}
                onChangeEnglish={setEnglish}
                onChangeFollowDraw={setFollowDraw}
                onChangeVisualSettings={setVisualSettings}
                onToggleCalibrationEdit={() => setCalibrationEditMode((v) => !v)}
                onReRunAutoDetect={() => {
                  if (screenshotUrl) runDetectionOnImageUrl(screenshotUrl);
                }}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
