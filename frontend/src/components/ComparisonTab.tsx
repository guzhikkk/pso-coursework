import { useState } from 'react';
import { Download, Play, Trophy } from 'lucide-react';
import { apiClient } from '../services/apiClient';
import type { ComparisonReport, FunctionMeta, OptimizeConfig } from '../types/api';
import './ComparisonTab.css';

interface ComparisonTabProps {
  functions: FunctionMeta[];
  config: OptimizeConfig;
  onConfigChange: (next: OptimizeConfig) => void;
}

const CURVE_COLORS = ['#58a6ff', '#3fb950', '#a78bfa', '#f97316'];
const SVG_W = 720;
const SVG_H = 240;
const PAD_L = 58;
const PAD_R = 16;
const PAD_T = 16;
const PAD_B = 28;

function formatNum(v: number | null, digits = 4): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs > 0 && abs < 1e-4) return v.toExponential(2);
  if (abs >= 1e6) return v.toExponential(2);
  return v.toFixed(digits);
}

export function ComparisonTab({
  functions,
  config,
  onConfigChange,
}: ComparisonTabProps) {
  const [numRuns, setNumRuns] = useState(10);
  const [report, setReport] = useState<ComparisonReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logScale, setLogScale] = useState(false);

  const handleRunCompare = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.compare(config, numRuns);
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить сравнение.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (!report) return;
    const headers = [
      'preset_id',
      'label',
      'variant',
      'topology',
      'mean_best_fitness',
      'median_best_fitness',
      'std_best_fitness',
      'min_best_fitness',
      'success_rate_pct',
      'mean_convergence_iter',
      'mean_elapsed_ms',
    ];
    const rows = report.summary_table.map((r) =>
      [
        r.preset_id,
        `"${r.label}"`,
        r.variant,
        r.topology,
        r.mean_best_fitness,
        r.median_best_fitness,
        r.std_best_fitness,
        r.min_best_fitness,
        r.success_rate_pct,
        r.mean_convergence_iter ?? '',
        r.mean_elapsed_ms,
      ].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pso-compare-${report.function_meta.id}-D${report.dim}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const plotW = SVG_W - PAD_L - PAD_R;
  const plotH = SVG_H - PAD_T - PAD_B;

  const transformY = (v: number) => (logScale ? Math.log10(Math.max(1e-8, v)) : v);

  let yMin = 0;
  let yMax = 1;
  let maxIter = 1;

  if (report && report.curves.length > 0) {
    const allY = report.curves.flatMap((c) => c.points.map((p) => transformY(p.mean_best_fitness)));
    yMin = Math.min(...allY);
    yMax = Math.max(...allY);
    if (Math.abs(yMax - yMin) < 1e-9) yMax = yMin + 1;
    maxIter = Math.max(1, ...report.curves.map((c) => Math.max(0, c.points.length - 1)));
  }

  const toX = (iter: number) => PAD_L + (iter / maxIter) * plotW;
  const toY = (raw: number) => {
    const val = transformY(raw);
    const norm = (val - yMin) / Math.max(1e-9, yMax - yMin);
    return PAD_T + (1 - norm) * plotH;
  };

  return (
    <div className="compare-tab">
      <section className="card compare-toolbar">
        <div className="compare-controls">
          <div className="compare-field">
            <label htmlFor="cmp-fn">Целевая функция</label>
            <select
              id="cmp-fn"
              className="select"
              value={config.function_id === 'custom' ? 'rastrigin' : config.function_id}
              onChange={(e) => {
                const nextId = e.target.value;
                const meta = functions.find((f) => f.id === nextId);
                onConfigChange({
                  ...config,
                  function_id: nextId,
                  dim: meta && !meta.supports_nd ? 2 : config.dim,
                });
              }}
            >
              {functions.map((fn) => (
                <option key={fn.id} value={fn.id}>
                  {fn.name}
                </option>
              ))}
            </select>
          </div>

          <div className="compare-field" style={{ minWidth: 96 }}>
            <label htmlFor="cmp-dim">Размерность D</label>
            <input
              id="cmp-dim"
              type="number"
              min={2}
              max={50}
              className="input mono"
              value={config.dim}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  dim: Math.max(2, Math.min(50, Number(e.target.value) || 2)),
                })
              }
            />
          </div>

          <div className="compare-field" style={{ minWidth: 96 }}>
            <label htmlFor="cmp-n">Частиц N</label>
            <input
              id="cmp-n"
              type="number"
              min={5}
              max={200}
              className="input mono"
              value={config.num_particles}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  num_particles: Math.max(5, Math.min(200, Number(e.target.value) || 20)),
                })
              }
            />
          </div>

          <div className="compare-field" style={{ minWidth: 96 }}>
            <label htmlFor="cmp-iters">Итераций I</label>
            <input
              id="cmp-iters"
              type="number"
              min={10}
              max={300}
              className="input mono"
              value={config.max_iterations}
              onChange={(e) =>
                onConfigChange({
                  ...config,
                  max_iterations: Math.max(10, Math.min(300, Number(e.target.value) || 60)),
                })
              }
            />
          </div>

          <div className="compare-field" style={{ minWidth: 100 }}>
            <label htmlFor="cmp-runs">Прогонов M</label>
            <input
              id="cmp-runs"
              type="number"
              min={1}
              max={30}
              className="input mono"
              value={numRuns}
              onChange={(e) => setNumRuns(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleRunCompare}
            disabled={isLoading}
          >
            <Play size={15} />
            <span>{isLoading ? 'Сравнение...' : 'Запустить сравнение'}</span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={handleExportCsv}
            disabled={!report}
            title="Скачать сводную таблицу в CSV"
          >
            <Download size={15} />
            <span>CSV</span>
          </button>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      {report && (
        <>
          <div className="winner-banner">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <Trophy size={16} />
              <span>Лидер серии: {report.winner_label}</span>
            </span>
            <span className="mono">
              {report.function_meta.name} · D={report.dim}, N={report.num_particles}, I={report.max_iterations}, M={report.num_runs}
            </span>
          </div>

          <section className="card">
            <div className="card-title">
              <span>Средние кривые сходимости по {report.num_runs} прогонам</span>
              <button
                type="button"
                className="btn btn-sm mono"
                onClick={() => setLogScale((prev) => !prev)}
              >
                {logScale ? 'Шкала: log₁₀' : 'Шкала: лин.'}
              </button>
            </div>

            <div className="compare-chart-wrap">
              <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="compare-svg" role="img" aria-label="Сравнение кривых сходимости">
                {[0, 0.5, 1].map((frac) => {
                  const y = PAD_T + frac * plotH;
                  const val = yMax - frac * (yMax - yMin);
                  const label = logScale ? `1e${val.toFixed(1)}` : formatNum(val, 2);
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
                        {label}
                      </text>
                    </g>
                  );
                })}

                <text x={PAD_L} y={SVG_H - 6} fontSize="10" fill="var(--text-muted)" className="mono">
                  0
                </text>
                <text
                  x={SVG_W - PAD_R}
                  y={SVG_H - 6}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--text-muted)"
                  className="mono"
                >
                  итер. {maxIter}
                </text>

                {report.curves.map((curve, idx) => {
                  const color = CURVE_COLORS[idx % CURVE_COLORS.length];
                  const d = curve.points
                    .map(
                      (pt, i) =>
                        `${i === 0 ? 'M' : 'L'}${toX(pt.iteration).toFixed(1)},${toY(pt.mean_best_fitness).toFixed(1)}`
                    )
                    .join(' ');
                  return (
                    <path
                      key={curve.preset_id}
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeWidth="2.2"
                    />
                  );
                })}
              </svg>

              <div className="compare-legend">
                {report.curves.map((curve, idx) => (
                  <span key={curve.preset_id} className="compare-legend-item">
                    <span
                      className="compare-dot"
                      style={{ background: CURVE_COLORS[idx % CURVE_COLORS.length] }}
                    />
                    <span>{curve.label}</span>
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="card">
            <h3 className="card-title">Сводная таблица статистики</h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Модификация</th>
                    <th>Среднее f</th>
                    <th>Медиана f</th>
                    <th>Стд. откл. σ</th>
                    <th>Мин. f</th>
                    <th>Успех (%)</th>
                    <th>Ср. итер. сход.</th>
                    <th>Время (мс)</th>
                  </tr>
                </thead>
                <tbody>
                  {report.summary_table.map((row) => {
                    const isWinner = row.preset_id === report.winner_preset_id;
                    return (
                      <tr key={row.preset_id} className={isWinner ? 'winner-row' : undefined}>
                        <td>{row.label}</td>
                        <td className="mono">{formatNum(row.mean_best_fitness)}</td>
                        <td className="mono">{formatNum(row.median_best_fitness)}</td>
                        <td className="mono">{formatNum(row.std_best_fitness)}</td>
                        <td className="mono">{formatNum(row.min_best_fitness)}</td>
                        <td className="mono">{row.success_rate_pct.toFixed(1)}%</td>
                        <td className="mono">
                          {row.mean_convergence_iter !== null
                            ? row.mean_convergence_iter.toFixed(1)
                            : '—'}
                        </td>
                        <td className="mono">{row.mean_elapsed_ms.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}