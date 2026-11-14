export interface SampleScreenshotSpec {
  id: string;
  label: string;
  clothStyle: 'emerald' | 'tournament-blue' | 'crimson';
  aspectLabel: string;
}

export const SAMPLE_SCREENSHOTS: SampleScreenshotSpec[] = [
  {
    id: 'android-8ball-green',
    label: '8-Ball Classic Felt (9 ft)',
    clothStyle: 'emerald',
    aspectLabel: '1280 × 720',
  },
  {
    id: 'android-9ball-blue',
    label: 'Tournament Blue Cloth (8 ft)',
    clothStyle: 'tournament-blue',
    aspectLabel: '1280 × 720',
  },
  {
    id: 'android-barbox-crimson',
    label: 'Bar Box Crimson (7 ft)',
    clothStyle: 'crimson',
    aspectLabel: '1280 × 720',
  },
];

export function generateAndroidPoolScreenshot(spec: SampleScreenshotSpec): string {
  const w = 1280;
  const h = 720;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Android dark game backdrop
  ctx.fillStyle = '#0A0D12';
  ctx.fillRect(0, 0, w, h);

  // Subtle top Android game HUD bar (player cards + timer)
  ctx.fillStyle = '#151B24';
  ctx.fillRect(0, 0, w, 72);
  ctx.fillStyle = '#242E3D';
  ctx.fillRect(140, 14, 240, 44);
  ctx.fillRect(w - 380, 14, 240, 44);
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '600 16px sans-serif';
  ctx.fillText('Player 1 · Solids', 160, 42);
  ctx.fillText('Opponent · Stripes', w - 355, 42);

  // Left Android power meter rail
  ctx.fillStyle = '#151B24';
  ctx.fillRect(24, 150, 46, 440);
  const pwrGrad = ctx.createLinearGradient(0, 170, 0, 570);
  pwrGrad.addColorStop(0, '#EF4444');
  pwrGrad.addColorStop(0.5, '#F59E0B');
  pwrGrad.addColorStop(1, '#10B981');
  ctx.fillStyle = pwrGrad;
  ctx.fillRect(36, 170, 22, 400);

  // Outer wooden/slate table frame
  let tableX = 148;
  let tableY = 124;
  let tableW = 1000;
  let tableH = 500;

  if (spec.clothStyle === 'crimson') {
    tableX = 188;
    tableY = 144;
    tableW = 920;
    tableH = 460;
  } else if (spec.clothStyle === 'tournament-blue') {
    tableX = 160;
    tableY = 132;
    tableW = 960;
    tableH = 480;
  }

  const railPad = 42;
  ctx.fillStyle = spec.clothStyle === 'tournament-blue' ? '#1E242E' : '#4A2511';
  ctx.beginPath();
  ctx.roundRect(tableX - railPad, tableY - railPad, tableW + railPad * 2, tableH + railPad * 2, 26);
  ctx.fill();

  // Inner cushion bevel
  const clothColors = {
    emerald: { base: '#0F5C3A', cushion: '#0B462C' },
    'tournament-blue': { base: '#125B9A', cushion: '#0D4373' },
    crimson: { base: '#7B1E26', cushion: '#5C141B' },
  }[spec.clothStyle];

  ctx.fillStyle = clothColors.cushion;
  ctx.fillRect(tableX - 14, tableY - 14, tableW + 28, tableH + 28);

  // Main felt playing area
  ctx.fillStyle = clothColors.base;
  ctx.fillRect(tableX, tableY, tableW, tableH);

  // Head string line
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tableX + tableW * 0.25, tableY);
  ctx.lineTo(tableX + tableW * 0.25, tableY + tableH);
  ctx.stroke();

  // 6 pockets
  const pocketR = Math.round(tableW / 44) * 1.6;
  const pocketCoords = [
    [tableX, tableY],
    [tableX + tableW * 0.5, tableY - 4],
    [tableX + tableW, tableY],
    [tableX, tableY + tableH],
    [tableX + tableW * 0.5, tableY + tableH + 4],
    [tableX + tableW, tableY + tableH],
  ];
  for (const [px, py] of pocketCoords) {
    ctx.fillStyle = '#07090C';
    ctx.beginPath();
    ctx.arc(px, py, pocketR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rail diamonds
  ctx.fillStyle = '#D4AF37';
  for (let i = 1; i <= 7; i++) {
    if (i === 4) continue;
    const dx = tableX + (tableW / 8) * i;
    ctx.beginPath();
    ctx.arc(dx, tableY - 26, 3.5, 0, Math.PI * 2);
    ctx.arc(dx, tableY + tableH + 26, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 1; i <= 3; i++) {
    const dy = tableY + (tableH / 4) * i;
    ctx.beginPath();
    ctx.arc(tableX - 26, dy, 3.5, 0, Math.PI * 2);
    ctx.arc(tableX + tableW + 26, dy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Balls
  const ballR = Math.round(tableW / 46);
  const drawBall = (x: number, y: number, color: string, num?: number) => {
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.arc(x + 3, y + 4, ballR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, ballR, 0, Math.PI * 2);
    ctx.fill();

    if (num) {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(x, y, ballR * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111827';
      ctx.font = `700 ${Math.round(ballR * 0.65)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(num), x, y + 1);
    }
  };

  if (spec.clothStyle === 'emerald') {
    drawBall(tableX + tableW * 0.25, tableY + tableH * 0.52, '#F8FAFC'); // Cue
    drawBall(tableX + tableW * 0.66, tableY + tableH * 0.34, '#EAB308', 1);
    drawBall(tableX + tableW * 0.78, tableY + tableH * 0.65, '#DC2626', 3);
    drawBall(tableX + tableW * 0.56, tableY + tableH * 0.72, '#1E293B', 8);
    drawBall(tableX + tableW * 0.84, tableY + tableH * 0.28, '#2563EB', 2);
  } else if (spec.clothStyle === 'tournament-blue') {
    drawBall(tableX + tableW * 0.3, tableY + tableH * 0.64, '#F8FAFC'); // Cue
    drawBall(tableX + tableW * 0.58, tableY + tableH * 0.35, '#F97316', 5);
    drawBall(tableX + tableW * 0.76, tableY + tableH * 0.54, '#EAB308', 9);
    drawBall(tableX + tableW * 0.42, tableY + tableH * 0.28, '#7C3AED', 4);
  } else {
    drawBall(tableX + tableW * 0.22, tableY + tableH * 0.45, '#F8FAFC'); // Cue
    drawBall(tableX + tableW * 0.61, tableY + tableH * 0.52, '#EAB308', 1);
    drawBall(tableX + tableW * 0.82, tableY + tableH * 0.36, '#10B981', 6);
    drawBall(tableX + tableW * 0.71, tableY + tableH * 0.78, '#1E293B', 8);
  }

  return canvas.toDataURL('image/png');
}
