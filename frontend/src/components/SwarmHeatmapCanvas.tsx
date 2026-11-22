import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { HeatmapData, IterationRecord, ThemeMode } from '../types/api';
import './SwarmHeatmapCanvas.css';

interface SwarmHeatmapCanvasProps {
  heatmap: HeatmapData | null;
  history: IterationRecord[];
  currentStep: number;
  selectedParticleId: number | null;
  onSelectParticle: (particleId: number | null) => void;
  theme: ThemeMode;
}

function interpolateHeatmapColor(t: number, theme: ThemeMode): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const stops: Array<[number, number, number]> =
    theme === 'dark'
      ? [
          [11, 18, 36],    // глубокий тёмно-синий (минимум)
          [54, 34, 46],    // тёмный сливово-коричневый
          [124, 58, 22],   // тёплый янтарно-коричневый
          [217, 119, 6],   // насыщенный медовый
          [252, 211, 77],  // светлое золото (максимум)
        ]
      : [
          [120, 53, 15],   // тёмный медовый шоколад (минимум)
          [180, 83, 9],    // карамельный янтарь
          [217, 119, 6],   // тёплый мёд
          [245, 180, 65],  // золотистый
          [254, 243, 199], // мягкий кремовый (максимум)
        ];

  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const c0 = stops[idx];
  const c1 = stops[idx + 1];

  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * frac),
    Math.round(c0[1] + (c1[1] - c0[1]) * frac),
    Math.round(c0[2] + (c1[2] - c0[2]) * frac),
  ];
}

function drawHexagon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number
) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawBee(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  scale: number,
  isSelected: boolean,
  wingPhase: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  // Мягкое золотое свечение
  ctx.shadowColor = isSelected ? '#fef08a' : 'rgba(251, 191, 36, 0.7)';
  ctx.shadowBlur = isSelected ? 14 : 7;

  // Полупрозрачные крылышки (слегка взмахивают на каждом шаге)
  const flap = Math.sin(wingPhase) * 0.25;
  ctx.fillStyle = 'rgba(255, 251, 235, 0.78)';
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
  ctx.lineWidth = 0.7;

  ctx.save();
  ctx.translate(-1, -4.5);
  ctx.rotate(-0.45 + flap);
  ctx.beginPath();
  ctx.ellipse(0, -3, 3.2, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(-1, 4.5);
  ctx.rotate(0.45 - flap);
  ctx.beginPath();
  ctx.ellipse(0, 3, 3.2, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Тельце пчёлки (золотой овал)
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.ellipse(0, 0, 6.8, 4.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = isSelected ? '#fef08a' : '#fbbf24';
  ctx.fill();

  // Тёмно-коричневые полоски (обрезанные по контуру тельца)
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#2b1608';
  ctx.fillRect(-4.2, -5, 1.8, 10);
  ctx.fillRect(-0.8, -5, 1.9, 10);
  // Головка
  ctx.beginPath();
  ctx.arc(5.4, 0, 2.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Тонкий контур тельца
  ctx.beginPath();
  ctx.ellipse(0, 0, 6.8, 4.4, 0, 0, Math.PI * 2);
  ctx.strokeStyle = isSelected ? '#ffffff' : '#451a03';
  ctx.lineWidth = isSelected ? 1.4 : 0.9;
  ctx.stroke();

  ctx.restore();
}

export function SwarmHeatmapCanvas({
  heatmap,
  history,
  currentStep,
  selectedParticleId,
  onSelectParticle,
  theme,
}: SwarmHeatmapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [size, setSize] = useState<{ width: number; height: number }>({ width: 520, height: 520 });
  const [showVelocities, setShowVelocities] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [showPBest, setShowPBest] = useState(false);
  const [useBees, setUseBees] = useState(true);

  const currentRecord = history[currentStep] ?? null;

  const bestFitness =
    currentRecord
      ? ((currentRecord as unknown as Record<string, unknown>).global_best_value as number | undefined) ??
        ((currentRecord as unknown as Record<string, unknown>).global_best_fitness as number | undefined)
      : undefined;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(240, Math.floor(entry.contentRect.width));
        const h = Math.max(240, Math.floor(entry.contentRect.height));
        setSize({ width: w, height: h });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !heatmap || !currentRecord) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = size;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = 34;
    const plotW = Math.max(40, width - pad * 2);
    const plotH = Math.max(40, height - pad * 2);

    const xSpan = Math.max(1e-9, heatmap.x_max - heatmap.x_min);
    const ySpan = Math.max(1e-9, heatmap.y_max - heatmap.y_min);

    const toCanvasX = (wx: number) => pad + ((wx - heatmap.x_min) / xSpan) * plotW;
    const toCanvasY = (wy: number) => pad + (1 - (wy - heatmap.y_min) / ySpan) * plotH;

    // 1. Фон
    ctx.fillStyle = theme === 'dark' ? '#0b1222' : '#faf4e8';
    ctx.fillRect(0, 0, width, height);

    // 2. Тепловая карта (логарифмическое сжатие контраста)
    const rows = heatmap.values.length;
    const cols = rows > 0 ? heatmap.values[0].length : 0;
    if (rows > 0 && cols > 0) {
      const cellW = plotW / cols;
      const cellH = plotH / rows;
      const logMin = Math.log1p(Math.max(0, heatmap.min_value - heatmap.min_value));
      const logMax = Math.log1p(Math.max(1e-9, heatmap.max_value - heatmap.min_value));

      for (let r = 0; r < rows; r++) {
        const yPos = pad + ((rows - 1 - r) / rows) * plotH;
        for (let c = 0; c < cols; c++) {
          const val = heatmap.values[r][c];
          const norm =
            (Math.log1p(Math.max(0, val - heatmap.min_value)) - logMin) /
            Math.max(1e-9, logMax - logMin);
          const [red, green, blue] = interpolateHeatmapColor(norm, theme);
          ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
          ctx.fillRect(pad + c * cellW, yPos, cellW + 0.6, cellH + 0.6);
        }
      }
    }

    // 3. Рамка и подписи осей
    ctx.strokeStyle = theme === 'dark' ? 'rgba(251, 191, 36, 0.35)' : 'rgba(180, 83, 9, 0.32)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, plotW, plotH);

    ctx.fillStyle = theme === 'dark' ? '#a8b3c7' : '#6b4f35';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      `x${heatmap.axis_x + 1} [${heatmap.x_min.toFixed(1)}, ${heatmap.x_max.toFixed(1)}]`,
      pad + plotW / 2,
      height - 10
    );

    ctx.save();
    ctx.translate(13, pad + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(
      `x${heatmap.axis_y + 1} [${heatmap.y_min.toFixed(1)}, ${heatmap.y_max.toFixed(1)}]`,
      0,
      0
    );
    ctx.restore();

    // 4. Истинный глобальный оптимум X*
    if (heatmap.optimum_point) {
      const ox = toCanvasX(heatmap.optimum_point[0]);
      const oy = toCanvasY(heatmap.optimum_point[1]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox - 6, oy);
      ctx.lineTo(ox + 6, oy);
      ctx.moveTo(ox, oy - 6);
      ctx.lineTo(ox, oy + 6);
      ctx.stroke();
    }

    const ax = heatmap.axis_x;
    const ay = heatmap.axis_y;

    // 5. Золотые затухающие траектории движения частиц (последние 8 шагов)
    if (showTrails && currentStep > 0) {
      const trailLen = 8;
      const startStep = Math.max(0, currentStep - trailLen);
      for (const p of currentRecord.particles) {
        const isSelected = p.id === selectedParticleId;
        const points: Array<[number, number]> = [];
        for (let s = startStep; s <= currentStep; s++) {
          const histParticle = history[s]?.particles.find((item) => item.id === p.id);
          if (!histParticle) continue;
          points.push([
            toCanvasX(histParticle.position[ax] ?? 0),
            toCanvasY(histParticle.position[ay] ?? 0),
          ]);
        }
        for (let i = 1; i < points.length; i++) {
          const alpha = (i / points.length) * (isSelected ? 0.95 : 0.55);
          ctx.beginPath();
          ctx.moveTo(points[i - 1][0], points[i - 1][1]);
          ctx.lineTo(points[i][0], points[i][1]);
          ctx.strokeStyle = isSelected
            ? `rgba(254, 240, 138, ${alpha})`
            : `rgba(251, 191, 36, ${alpha})`;
          ctx.lineWidth = isSelected ? 2.4 : 1.4;
          ctx.stroke();
        }
      }
    }

    // 6. Личные рекорды P_best
    if (showPBest) {
      for (const p of currentRecord.particles) {
        const bx = toCanvasX(p.best_position[ax] ?? 0);
        const by = toCanvasY(p.best_position[ay] ?? 0);
        ctx.fillStyle = 'rgba(251, 146, 60, 0.85)';
        ctx.fillRect(bx - 2.5, by - 2.5, 5, 5);
      }
    }

    // 7. Векторы скоростей V_i и сами частицы (пчёлки или точки)
    for (const p of currentRecord.particles) {
      const px = toCanvasX(p.position[ax] ?? 0);
      const py = toCanvasY(p.position[ay] ?? 0);
      const isSelected = p.id === selectedParticleId;

      const vx = p.velocity[ax] ?? 0;
      const vy = p.velocity[ay] ?? 0;
      const endX = toCanvasX((p.position[ax] ?? 0) + vx * 0.65);
      const endY = toCanvasY((p.position[ay] ?? 0) + vy * 0.65);

      if (showVelocities) {
        ctx.strokeStyle = isSelected ? '#fef08a' : 'rgba(255, 251, 235, 0.65)';
        ctx.lineWidth = isSelected ? 2 : 1.1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      if (useBees) {
        const dx = endX - px;
        const dy = endY - py;
        const angle = Math.hypot(dx, dy) > 0.5 ? Math.atan2(dy, dx) : 0;
        const beeScale = isSelected ? 1.35 : 0.95;
        drawBee(ctx, px, py, angle, beeScale, isSelected, currentStep * 1.4 + p.id);
      } else {
        ctx.save();
        ctx.shadowColor = isSelected ? '#fef08a' : '#f59e0b';
        ctx.shadowBlur = isSelected ? 12 : 6;
        ctx.beginPath();
        ctx.arc(px, py, isSelected ? 6.5 : 4.2, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? '#fef08a' : '#fbbf24';
        ctx.fill();
        ctx.strokeStyle = '#2b1608';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
      }
    }

    // 8. Глобальный лидер G_best (золотая сота-маяк)
    if (currentRecord.global_best_position.length > Math.max(ax, ay)) {
      const gx = toCanvasX(currentRecord.global_best_position[ax]);
      const gy = toCanvasY(currentRecord.global_best_position[ay]);

      ctx.save();
      // Концентрические кольца радара
      for (const r of [14, 21]) {
        ctx.beginPath();
        ctx.arc(gx, gy, r, 0, Math.PI * 2);
        ctx.strokeStyle =
          r === 14 ? 'rgba(252, 211, 77, 0.55)' : 'rgba(245, 158, 11, 0.28)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // Золотая сота в центре
      ctx.shadowColor = '#f59e0b';
      ctx.shadowBlur = 16;
      drawHexagon(ctx, gx, gy, 9.5);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
      ctx.strokeStyle = '#fffbeb';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }, [
    heatmap,
    history,
    currentStep,
    currentRecord,
    selectedParticleId,
    size,
    showVelocities,
    showTrails,
    showPBest,
    useBees,
    theme,
  ]);

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!heatmap || !currentRecord || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    const pad = 34;
    const plotW = Math.max(40, size.width - pad * 2);
    const plotH = Math.max(40, size.height - pad * 2);
    const xSpan = Math.max(1e-9, heatmap.x_max - heatmap.x_min);
    const ySpan = Math.max(1e-9, heatmap.y_max - heatmap.y_min);

    let nearestId: number | null = null;
    let nearestDist = 18;

    for (const p of currentRecord.particles) {
      const px = pad + (((p.position[heatmap.axis_x] ?? 0) - heatmap.x_min) / xSpan) * plotW;
      const py = pad + (1 - ((p.position[heatmap.axis_y] ?? 0) - heatmap.y_min) / ySpan) * plotH;
      const dist = Math.hypot(px - clickX, py - clickY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = p.id;
      }
    }

    onSelectParticle(nearestId);
  };

  const handleExportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `pso-swarm-iter-${currentRecord?.iteration ?? 0}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <section className="card heatmap-card">
      <div className="heatmap-header">
        <h2 className="card-title" style={{ marginBottom: 0 }}>
          2D-поле поиска и движение роя
        </h2>

        <div className="heatmap-layers">
          <button
            type="button"
            className={`layer-toggle${showVelocities ? ' active' : ''}`}
            onClick={() => setShowVelocities((v) => !v)}
          >
            Скорости V
          </button>
          <button
            type="button"
            className={`layer-toggle${showTrails ? ' active' : ''}`}
            onClick={() => setShowTrails((v) => !v)}
          >
            Траектории
          </button>
          <button
            type="button"
            className={`layer-toggle${showPBest ? ' active' : ''}`}
            onClick={() => setShowPBest((v) => !v)}
          >
            P_best
          </button>
          <button
            type="button"
            className={`layer-toggle${useBees ? ' active' : ''}`}
            onClick={() => setUseBees((v) => !v)}
            title="Переключить отображение частиц: пчёлки или точки"
          >
            🐝 Пчёлки
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={handleExportPng}
            disabled={!heatmap}
            title="Сохранить снимок холста в PNG"
          >
            <Download size={13} />
            <span>PNG</span>
          </button>
        </div>
      </div>

      <div ref={containerRef} className="heatmap-stage">
        {heatmap && currentRecord ? (
          <>
            <canvas
              ref={canvasRef}
              className="heatmap-canvas"
              onClick={handleCanvasClick}
              title="Нажмите на частицу, чтобы открыть её в инспекторе"
            />
            <div className="heatmap-hud">
              <div className="heatmap-hud-row">
                <span className="heatmap-hud-label">Итерация</span>
                <span className="heatmap-hud-val mono">
                  {currentRecord.iteration} / {Math.max(0, history.length - 1)}
                </span>
              </div>
              {typeof bestFitness === 'number' && (
                <div className="heatmap-hud-row">
                  <span className="heatmap-hud-label">f(g_best)</span>
                  <span className="heatmap-hud-val mono">
                    {Math.abs(bestFitness) < 0.001 && bestFitness !== 0
                      ? bestFitness.toExponential(2)
                      : bestFitness.toFixed(5)}
                  </span>
                </div>
              )}
              <div className="heatmap-hud-row">
                <span className="heatmap-hud-label">{useBees ? 'Пчёл в рое' : 'Частиц'}</span>
                <span className="heatmap-hud-val mono">{currentRecord.particles.length}</span>
              </div>
            </div>
          </>
        ) : (
          <div className="heatmap-empty">
            Нажмите «Запустить оптимизацию», чтобы построить тепловую карту и увидеть полёт роя.
          </div>
        )}
      </div>

      <div className="heatmap-legend">
        <div className="legend-items">
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#fbbf24' }} />
            {useBees ? 'Пчёлка' : 'Частица'}
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#f59e0b' }} />
            Сота G_best
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#fef08a' }} />
            Выбранная
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#fb923c' }} />
            P_best
          </span>
          <span className="legend-item">
            <span className="mono">+</span> Оптимум X*
          </span>
        </div>
        <span className="mono">Клик по частице — инспектор</span>
      </div>
    </section>
  );
}