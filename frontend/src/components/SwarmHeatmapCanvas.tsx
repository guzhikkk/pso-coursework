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
          [14, 24, 52],
          [24, 78, 119],
          [26, 117, 159],
          [82, 182, 154],
          [217, 237, 146],
        ]
      : [
          [30, 58, 138],
          [37, 99, 235],
          [14, 165, 233],
          [52, 211, 153],
          [254, 240, 138],
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

  const currentRecord = history[currentStep] ?? null;

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
    ctx.fillStyle = theme === 'dark' ? '#0f141b' : '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    // 2. Тепловая карта (логарифмическое сжатие контраста для наглядности)
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
          const norm = (Math.log1p(Math.max(0, val - heatmap.min_value)) - logMin) / Math.max(1e-9, logMax - logMin);
          const [red, green, blue] = interpolateHeatmapColor(norm, theme);
          ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
          ctx.fillRect(pad + c * cellW, yPos, cellW + 0.6, cellH + 0.6);
        }
      }
    }

    // 3. Рамка и подписи осей
    ctx.strokeStyle = theme === 'dark' ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, plotW, plotH);

    ctx.fillStyle = theme === 'dark' ? '#9aa7b8' : '#475569';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`x${heatmap.axis_x + 1} [${heatmap.x_min.toFixed(1)}, ${heatmap.x_max.toFixed(1)}]`, pad + plotW / 2, height - 10);

    ctx.save();
    ctx.translate(13, pad + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`x${heatmap.axis_y + 1} [${heatmap.y_min.toFixed(1)}, ${heatmap.y_max.toFixed(1)}]`, 0, 0);
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

    // 5. Траектории движения частиц (последние 6 шагов)
    if (showTrails && currentStep > 0) {
      const startStep = Math.max(0, currentStep - 6);
      for (const p of currentRecord.particles) {
        const isSelected = p.id === selectedParticleId;
        ctx.beginPath();
        let started = false;
        for (let s = startStep; s <= currentStep; s++) {
          const histParticle = history[s]?.particles.find((item) => item.id === p.id);
          if (!histParticle) continue;
          const px = toCanvasX(histParticle.position[ax] ?? 0);
          const py = toCanvasY(histParticle.position[ay] ?? 0);
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.strokeStyle = isSelected ? '#facc15' : 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = isSelected ? 2.2 : 1.1;
        ctx.stroke();
      }
    }

    // 6. Личные рекорды P_best
    if (showPBest) {
      for (const p of currentRecord.particles) {
        const bx = toCanvasX(p.best_position[ax] ?? 0);
        const by = toCanvasY(p.best_position[ay] ?? 0);
        ctx.fillStyle = 'rgba(167, 139, 250, 0.85)';
        ctx.fillRect(bx - 2.5, by - 2.5, 5, 5);
      }
    }

    // 7. Векторы скоростей V_i и сами частицы
    for (const p of currentRecord.particles) {
      const px = toCanvasX(p.position[ax] ?? 0);
      const py = toCanvasY(p.position[ay] ?? 0);
      const isSelected = p.id === selectedParticleId;

      if (showVelocities) {
        const vx = p.velocity[ax] ?? 0;
        const vy = p.velocity[ay] ?? 0;
        const endX = toCanvasX((p.position[ax] ?? 0) + vx * 0.65);
        const endY = toCanvasY((p.position[ay] ?? 0) + vy * 0.65);
        ctx.strokeStyle = isSelected ? '#facc15' : 'rgba(255, 255, 255, 0.72)';
        ctx.lineWidth = isSelected ? 2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(px, py, isSelected ? 6.5 : 4.2, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#facc15' : '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // 8. Глобальный лидер G_best
    if (currentRecord.global_best_position.length > Math.max(ax, ay)) {
      const gx = toCanvasX(currentRecord.global_best_position[ax]);
      const gy = toCanvasY(currentRecord.global_best_position[ay]);
      ctx.beginPath();
      ctx.arc(gx, gy, 7.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f97316';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [heatmap, history, currentStep, currentRecord, selectedParticleId, size, showVelocities, showTrails, showPBest, theme]);

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
          <canvas
            ref={canvasRef}
            className="heatmap-canvas"
            onClick={handleCanvasClick}
            title="Нажмите на частицу, чтобы открыть её в инспекторе"
          />
        ) : (
          <div className="heatmap-empty">
            Нажмите «Запустить оптимизацию», чтобы построить тепловую карту и увидеть движение роя частиц.
          </div>
        )}
      </div>

      <div className="heatmap-legend">
        <div className="legend-items">
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#38bdf8' }} />
            Частица
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#f97316' }} />
            Лидер G_best
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#facc15' }} />
            Выбранная
          </span>
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#a78bfa' }} />
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