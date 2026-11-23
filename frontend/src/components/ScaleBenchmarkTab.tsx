import { useState, type MouseEvent } from 'react';
import { Cpu, Download, Play } from 'lucide-react';
import { apiClient } from '../services/apiClient';
import type {
  FunctionMeta,
  OptimizeConfig,
  PSOVariant,
  ScaleBenchmarkReport,
  ScalePoint,
} from '../types/api';
import './ScaleBenchmarkTab.css';

interface ScaleBenchmarkTabProps {
  functions: FunctionMeta[];
  config: OptimizeConfig;
}

interface ScaleLineChartProps {
  points: ScalePoint[];
  xKey: 'dim' | 'num_particles';
  xLabelPrefix: string;
  xFullTitle: string;
  color: string;
}

interface HoverTipState {
  idx: number;
  leftPx: number;
  flipLeft: boolean;
}

const SVG_W = 460;
const SVG_H = 190;
const PAD_L = 52;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 26;

function formatFitness(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs < 0.0001 || abs >= 100000) return v.toExponential(2);
  if (abs < 1) return v.toFixed(4);
  return v.toFixed(2);
}

function clientToSvgX(svg: SVGSVGElement, clientX: number, clientY: number, fallbackW: number): number {
  const ctm = svg.getScreenCTM();
  if (ctm) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(ctm.inverse()).x;
  }
  const rect = svg.getBoundingClientRect();
  return ((clientX - rect.left) / Math.max(1, rect.width)) * fallbackW;
}

function svgToBoxPosition(
  svg: SVGSVGElement,
  svgX: number,
  fallbackW: number
): { leftPx: number; flipLeft: boolean } {
  const box = svg.parentElement ?? svg;
  const boxRect = box.getBoundingClientRect();
  const ctm = svg.getScreenCTM();
  if (ctm && boxRect.width > 0) {
    const pt = svg.createSVGPoint();
    pt.x = svgX;
    pt.y = 0;
    const screenPt = pt.matrixTransform(ctm);
    const leftPx = screenPt.x - boxRect.left;
    return { leftPx, flipLeft: leftPx > boxRect.width * 0.55 };
  }
  const pct = svgX / fallbackW;
  return { leftPx: pct * boxRect.width, flipLeft: pct > 0.55 };
}

function ScaleLineChart({
  points,
  xKey,
  xLabelPrefix,
  xFullTitle,
  color,
}: ScaleLineChartProps) {
  const [hoverTip, setHoverTip] = useState<HoverTipState | null>(null);

  const plotW = SVG_W - PAD_L - PAD_R;
  const plotH = SVG_H - PAD_T - PAD_B;

  const maxMs = Math.max(1, ...points.map((p) => p.elapsed_ms));
  const stepX = points.length > 1 ? plotW / (points.length - 1) : plotW;

  const coords = points.map((pt, idx) => ({
    x: PAD_L + (points.length > 1 ? idx * stepX : plotW / 2),
    y: PAD_T + (1 - pt.elapsed_ms / maxMs) * plotH,
    label: `${xLabelPrefix}=${pt[xKey]}`,
    point: pt,
  }));

  const pathD = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(' ');

  const handleMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    if (coords.length === 0) return;
    const svg = e.currentTarget;
    const svgX = clientToSvgX(svg, e.clientX, e.clientY, SVG_W);

    let nearest = 0;
    let minDist = Math.abs(coords[0].x - svgX);
    for (let i = 1; i < coords.length; i++) {
      const d = Math.abs(coords[i].x - svgX);
      if (d < minDist) {
        minDist = d;
        nearest = i;
      }
    }
    const pos = svgToBoxPosition(svg, coords[nearest].x, SVG_W);
    setHoverTip({ idx: nearest, leftPx: pos.leftPx, flipLeft: pos.flipLeft });
  };

  const active = hoverTip ? coords[hoverTip.idx] : null;

  return (
    <div className="scale-svg-box">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="scale-svg scale-svg-interactive"
        role="img"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverTip(null)}
      >
        {[0, 0.5, 1].map((frac) => {
          const y = PAD_T + frac * plotH;
          const val = maxMs * (1 - frac);
          return (
            <g key={frac}>
              <line
                x1={PAD_L}
                y1={y}
                x2={SVG_W - PAD_R}
                y2={y}
                stroke="var(--border-subtle)"
                strokeDasharray="3 3"
              />
              <text
                x={PAD_L - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--text-muted)"
                className="mono"
              >
                {val.toFixed(0)} мс
              </text>
            </g>
          );
        })}

        <path d={pathD} fill="none" stroke={color} strokeWidth="2.2" />

        {active && (
          <line
            x1={active.x}
            y1={PAD_T}
            x2={active.x}
            y2={SVG_H - PAD_B}
            stroke="var(--text-primary)"
            strokeOpacity="0.45"
            strokeWidth="1.2"
            pointerEvents="none"
          />
        )}

        {coords.map((c, idx) => {
          const isHovered = hoverTip?.idx === idx;
          return (
            <g key={c.label}>
              <circle
                cx={c.x}
                cy={c.y}
                r={isHovered ? 6 : 4}
                fill={color}
                stroke="var(--bg-surface)"
                strokeWidth={isHovered ? 2 : 1.5}
              />
              <text
                x={c.x}
                y={SVG_H - 6}
                textAnchor="middle"
                fontSize="10"
                fill={isHovered ? 'var(--text-primary)' : 'var(--text-muted)'}
                fontWeight={isHovered ? 700 : 400}
                className="mono"
              >
                {c.label}
              </text>
            </g>
          );
        })}
      </svg>

      {hoverTip && active && (
        <div
          className={`scale-tooltip${hoverTip.flipLeft ? ' flip-left' : ''}`}
          style={{ left: `${hoverTip.leftPx}px` }}
        >
          <div className="scale-tooltip-title mono">
            {xFullTitle}: {active.point[xKey]}
          </div>
          <div className="scale-tooltip-row">
            <span className="scale-tooltip-dot" style={{ background: color }} />
            <span>Время:</span>
            <strong className="mono">{active.point.elapsed_ms.toFixed(2)} мс</strong>
          </div>
          <div className="scale-tooltip-row">
            <span className="scale-tooltip-dot" style={{ background: 'var(--text-muted)' }} />
            <span>Память:</span>
            <strong className="mono">{active.point.peak_memory_kb.toFixed(1)} КБ</strong>
          </div>
          <div className="scale-tooltip-row">
            <span className="scale-tooltip-dot" style={{ background: 'var(--accent-success)' }} />
            <span>Лучшее f:</span>
            <strong className="mono">{formatFitness(active.point.best_fitness)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

export function ScaleBenchmarkTab({ functions, config }: ScaleBenchmarkTabProps) {
  const ndFunctions = functions.filter((f) => f.supports_nd);
  const defaultFn =
    ndFunctions.find((f) => f.id === config.function_id)?.id ??
    ndFunctions[0]?.id ??
    'rastrigin';

  const [functionId, setFunctionId] = useState(defaultFn);
  const [variant, setVariant] = useState<PSOVariant>(config.variant);
  const [maxIterations, setMaxIterations] = useState(80);
  const [report, setReport] = useState<ScaleBenchmarkReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.scaleBenchmark({
        function_id: functionId,
        variant,
        topology: config.topology,
        max_iterations: maxIterations,
        dimensions: [2, 5, 10, 20, 30],
        particle_counts: [20, 40, 80, 120, 160],
      });
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при выполнении бенчмарка.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (!report) return;
    const headers = [
      'series',
      'dim',
      'num_particles',
      'elapsed_ms',
      'peak_memory_kb',
      'best_fitness',
    ];
    const dimRows = report.by_dimension.map((r) =>
      ['by_dimension', r.dim, r.num_particles, r.elapsed_ms, r.peak_memory_kb, r.best_fitness].join(
        ','
      )
    );
    const partRows = report.by_particles.map((r) =>
      ['by_particles', r.dim, r.num_particles, r.elapsed_ms, r.peak_memory_kb, r.best_fitness].join(
        ','
      )
    );
    const csv = [headers.join(','), ...dimRows, ...partRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pso-scale-${functionId}-${variant}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="scale-tab">
      <section className="card scale-toolbar">
        <div className="scale-controls">
          <div className="scale-field">
            <label htmlFor="scale-fn">Многомерная функция</label>
            <select
              id="scale-fn"
              className="select"
              value={functionId}
              onChange={(e) => setFunctionId(e.target.value)}
            >
              {(ndFunctions.length > 0 ? ndFunctions : functions).map((fn) => (
                <option key={fn.id} value={fn.id}>
                  {fn.name}
                </option>
              ))}
            </select>
          </div>

          <div className="scale-field">
            <label htmlFor="scale-variant">Модификация PSO</label>
            <select
              id="scale-variant"
              className="select"
              value={variant}
              onChange={(e) => setVariant(e.target.value as PSOVariant)}
            >
              <option value="classic">Классический PSO</option>
              <option value="ldiw">LDIW (убывающая инерция)</option>
              <option value="constriction">Сжатие Клерка — Кеннеди</option>
            </select>
          </div>

          <div className="scale-field" style={{ minWidth: 110 }}>
            <label htmlFor="scale-iters">Итераций I</label>
            <input
              id="scale-iters"
              type="number"
              min={20}
              max={300}
              className="input mono"
              value={maxIterations}
              onChange={(e) =>
                setMaxIterations(Math.max(20, Math.min(300, Number(e.target.value) || 80)))
              }
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleRun}
            disabled={isLoading}
          >
            <Play size={15} />
            <span>{isLoading ? 'Замер...' : 'Запустить бенчмарк'}</span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={handleExportCsv}
            disabled={!report}
            title="Скачать результаты замеров в CSV"
          >
            <Download size={15} />
            <span>CSV</span>
          </button>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <div className="complexity-strip">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
          <Cpu size={16} />
          <span>Теоретическая оценка сложности PSO</span>
        </span>
        <span className="mono">Время: O(I · N · D) · Память: Θ(N · D)</span>
      </div>

      {report && (
        <div className="scale-grid">
          <section className="card">
            <h3 className="card-title">
              <span>Рост размерности D</span>
              <span className="badge mono">фикс. N=40, I={maxIterations}</span>
            </h3>

            <div className="scale-chart-wrap">
              <ScaleLineChart
                points={report.by_dimension}
                xKey="dim"
                xLabelPrefix="D"
                xFullTitle="Размерность D"
                color="var(--accent-primary)"
              />
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Размерность D</th>
                    <th>Время (мс)</th>
                    <th>Память (КБ)</th>
                    <th>Лучшее f</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_dimension.map((row) => (
                    <tr key={row.dim}>
                      <td className="mono">{row.dim}</td>
                      <td className="mono">{row.elapsed_ms.toFixed(2)}</td>
                      <td className="mono">{row.peak_memory_kb.toFixed(1)}</td>
                      <td className="mono">{row.best_fitness.toExponential(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h3 className="card-title">
              <span>Рост числа частиц N</span>
              <span className="badge mono">фикс. D=10, I={maxIterations}</span>
            </h3>

            <div className="scale-chart-wrap">
              <ScaleLineChart
                points={report.by_particles}
                xKey="num_particles"
                xLabelPrefix="N"
                xFullTitle="Частиц N"
                color="var(--accent-secondary)"
              />
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Частиц N</th>
                    <th>Время (мс)</th>
                    <th>Память (КБ)</th>
                    <th>Лучшее f</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_particles.map((row) => (
                    <tr key={row.num_particles}>
                      <td className="mono">{row.num_particles}</td>
                      <td className="mono">{row.elapsed_ms.toFixed(2)}</td>
                      <td className="mono">{row.peak_memory_kb.toFixed(1)}</td>
                      <td className="mono">{row.best_fitness.toExponential(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}