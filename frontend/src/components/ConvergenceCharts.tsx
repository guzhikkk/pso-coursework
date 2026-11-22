import { useState } from 'react';
import type { IterationRecord } from '../types/api';
import './ConvergenceCharts.css';

interface ConvergenceChartsProps {
  history: IterationRecord[];
  currentStep: number;
}

const SVG_W = 480;
const SVG_H = 190;
const PAD_L = 52;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 26;

function formatAxisVal(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs < 0.01 || abs >= 10000) return v.toExponential(1);
  if (abs < 1) return v.toFixed(3);
  if (abs < 100) return v.toFixed(1);
  return v.toFixed(0);
}

function buildPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  return points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
    .join(' ');
}

export function ConvergenceCharts({ history, currentStep }: ConvergenceChartsProps) {
  const [logScale, setLogScale] = useState(false);

  const plotW = SVG_W - PAD_L - PAD_R;
  const plotH = SVG_H - PAD_T - PAD_B;
  const maxIter = Math.max(1, history.length - 1);

  const toX = (idx: number) => PAD_L + (idx / maxIter) * plotW;

  // --- График 1: Сходимость f(G_best) и среднего f(x) ---
  const transformFit = (v: number) => (logScale ? Math.log10(Math.max(1e-8, v)) : v);

  let fitMin = 0;
  let fitMax = 1;
  if (history.length > 0) {
    const allVals = history.flatMap((r) => [
      transformFit(r.global_best_fitness),
      transformFit(r.mean_fitness),
    ]);
    fitMin = Math.min(...allVals);
    fitMax = Math.max(...allVals);
    if (Math.abs(fitMax - fitMin) < 1e-9) {
      fitMax = fitMin + 1;
    }
  }

  const toFitY = (raw: number) => {
    const v = transformFit(raw);
    const norm = (v - fitMin) / Math.max(1e-9, fitMax - fitMin);
    return PAD_T + (1 - norm) * plotH;
  };

  const bestPoints = history.map((r, i) => ({ x: toX(i), y: toFitY(r.global_best_fitness) }));
  const meanPoints = history.map((r, i) => ({ x: toX(i), y: toFitY(r.mean_fitness) }));

  // --- График 2: Разнообразие роя и средняя скорость ---
  let divMax = 1;
  if (history.length > 0) {
    divMax = Math.max(
      1e-6,
      ...history.map((r) => Math.max(r.diversity, r.mean_speed))
    );
  }

  const toDivY = (v: number) => {
    const norm = Math.max(0, v) / divMax;
    return PAD_T + (1 - norm) * plotH;
  };

  const diversityPoints = history.map((r, i) => ({ x: toX(i), y: toDivY(r.diversity) }));
  const speedPoints = history.map((r, i) => ({ x: toX(i), y: toDivY(r.mean_speed) }));

  const cursorX = toX(Math.min(currentStep, maxIter));

  return (
    <div className="charts-grid">
      <section className="card chart-card">
        <div className="chart-header">
          <h3 className="card-title" style={{ marginBottom: 0 }}>
            Кривая сходимости
          </h3>
          <button
            type="button"
            className="btn btn-sm mono"
            onClick={() => setLogScale((prev) => !prev)}
            disabled={history.length === 0}
            title="Переключить линейную и логарифмическую шкалу"
          >
            {logScale ? 'Шкала: log₁₀' : 'Шкала: лин.'}
          </button>
        </div>

        <div className="chart-svg-wrap">
          {history.length > 0 ? (
            <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="chart-svg" role="img" aria-label="График сходимости">
              {[0, 0.5, 1].map((frac) => {
                const y = PAD_T + frac * plotH;
                const val = fitMax - frac * (fitMax - fitMin);
                const label = logScale ? `1e${val.toFixed(1)}` : formatAxisVal(val);
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
                      x={PAD_L - 6}
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

              <path
                d={buildPath(meanPoints)}
                fill="none"
                stroke="var(--text-muted)"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
              <path
                d={buildPath(bestPoints)}
                fill="none"
                stroke="var(--accent-primary)"
                strokeWidth="2.2"
              />

              <line
                x1={cursorX}
                y1={PAD_T}
                x2={cursorX}
                y2={SVG_H - PAD_B}
                stroke="var(--accent-warning)"
                strokeWidth="1.4"
                strokeDasharray="3 2"
              />
              {bestPoints[currentStep] && (
                <circle
                  cx={bestPoints[currentStep].x}
                  cy={bestPoints[currentStep].y}
                  r="4"
                  fill="var(--accent-primary)"
                  stroke="var(--bg-surface)"
                  strokeWidth="1.5"
                />
              )}
            </svg>
          ) : (
            <div className="chart-empty">Запустите оптимизацию для построения графика сходимости</div>
          )}
        </div>

        <div className="chart-legend">
          <span className="chart-legend-item">
            <span className="chart-swatch" style={{ background: 'var(--accent-primary)' }} />
            Лучшее f(G_best)
          </span>
          <span className="chart-legend-item">
            <span className="chart-swatch" style={{ background: 'var(--text-muted)' }} />
            Среднее по рою
          </span>
        </div>
      </section>

      <section className="card chart-card">
        <div className="chart-header">
          <h3 className="card-title" style={{ marginBottom: 0 }}>
            Разнообразие и скорость роя
          </h3>
          <span className="badge mono">сжатие роя</span>
        </div>

        <div className="chart-svg-wrap">
          {history.length > 0 ? (
            <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="chart-svg" role="img" aria-label="График разнообразия роя">
              {[0, 0.5, 1].map((frac) => {
                const y = PAD_T + frac * plotH;
                const val = divMax * (1 - frac);
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
                      x={PAD_L - 6}
                      y={y + 4}
                      textAnchor="end"
                      fontSize="10"
                      fill="var(--text-muted)"
                      className="mono"
                    >
                      {formatAxisVal(val)}
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

              <path
                d={buildPath(speedPoints)}
                fill="none"
                stroke="var(--accent-success)"
                strokeWidth="1.7"
              />
              <path
                d={buildPath(diversityPoints)}
                fill="none"
                stroke="var(--accent-secondary)"
                strokeWidth="2.2"
              />

              <line
                x1={cursorX}
                y1={PAD_T}
                x2={cursorX}
                y2={SVG_H - PAD_B}
                stroke="var(--accent-warning)"
                strokeWidth="1.4"
                strokeDasharray="3 2"
              />
              {diversityPoints[currentStep] && (
                <circle
                  cx={diversityPoints[currentStep].x}
                  cy={diversityPoints[currentStep].y}
                  r="4"
                  fill="var(--accent-secondary)"
                  stroke="var(--bg-surface)"
                  strokeWidth="1.5"
                />
              )}
            </svg>
          ) : (
            <div className="chart-empty">Здесь отобразится динамика разброса и скорости частиц</div>
          )}
        </div>

        <div className="chart-legend">
          <span className="chart-legend-item">
            <span className="chart-swatch" style={{ background: 'var(--accent-secondary)' }} />
            Разнообразие (разброс)
          </span>
          <span className="chart-legend-item">
            <span className="chart-swatch" style={{ background: 'var(--accent-success)' }} />
            Средняя скорость |V|
          </span>
        </div>
      </section>
    </div>
  );
}