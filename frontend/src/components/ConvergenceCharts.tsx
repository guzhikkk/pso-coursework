import { useState, type MouseEvent } from 'react';
import type { IterationRecord } from '../types/api';
import './ConvergenceCharts.css';

interface ConvergenceChartsProps {
  history: IterationRecord[];
  currentStep: number;
}

interface HoverTipState {
  idx: number;
  leftPx: number;
  flipLeft: boolean;
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

function formatTooltipVal(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs < 0.0001 || abs >= 100000) return v.toExponential(3);
  if (abs < 1) return v.toFixed(5);
  if (abs < 100) return v.toFixed(3);
  return v.toFixed(1);
}

function buildPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  return points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
    .join(' ');
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
    return { leftPx, flipLeft: leftPx > boxRect.width * 0.58 };
  }
  const pct = svgX / fallbackW;
  return { leftPx: pct * boxRect.width, flipLeft: pct > 0.58 };
}

export function ConvergenceCharts({ history, currentStep }: ConvergenceChartsProps) {
  const [logScale, setLogScale] = useState(false);
  const [fitTip, setFitTip] = useState<HoverTipState | null>(null);
  const [divTip, setDivTip] = useState<HoverTipState | null>(null);

  const plotW = SVG_W - PAD_L - PAD_R;
  const plotH = SVG_H - PAD_T - PAD_B;
  const maxIter = Math.max(1, history.length - 1);

  const toX = (idx: number) => PAD_L + (idx / maxIter) * plotW;

  const computeTip = (e: MouseEvent<SVGSVGElement>): HoverTipState | null => {
    if (history.length === 0) return null;
    const svg = e.currentTarget;
    const svgX = clientToSvgX(svg, e.clientX, e.clientY, SVG_W);
    const frac = Math.max(0, Math.min(1, (svgX - PAD_L) / plotW));
    const idx = Math.round(frac * (history.length - 1));
    const pos = svgToBoxPosition(svg, toX(idx), SVG_W);
    return { idx, leftPx: pos.leftPx, flipLeft: pos.flipLeft };
  };

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
    divMax = Math.max(1e-6, ...history.map((r) => Math.max(r.diversity, r.mean_speed)));
  }
  const toDivY = (v: number) => {
    const norm = Math.max(0, v) / divMax;
    return PAD_T + (1 - norm) * plotH;
  };

  const diversityPoints = history.map((r, i) => ({ x: toX(i), y: toDivY(r.diversity) }));
  const speedPoints = history.map((r, i) => ({ x: toX(i), y: toDivY(r.mean_speed) }));

  const cursorX = toX(Math.min(currentStep, maxIter));

  const hoverFitIdx = fitTip?.idx ?? null;
  const fitHoverRecord = hoverFitIdx !== null ? history[hoverFitIdx] : null;
  const fitHoverX = hoverFitIdx !== null ? toX(hoverFitIdx) : 0;

  const hoverDivIdx = divTip?.idx ?? null;
  const divHoverRecord = hoverDivIdx !== null ? history[hoverDivIdx] : null;
  const divHoverX = hoverDivIdx !== null ? toX(hoverDivIdx) : 0;

  return (
    <div className="charts-grid">
      {/* График 1 */}
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

        <div className="chart-svg-wrap" style={{ position: 'relative' }}>
          {history.length > 0 ? (
            <>
              <svg
                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                className="chart-svg chart-svg-interactive"
                role="img"
                aria-label="График сходимости"
                onMouseMove={(e) => setFitTip(computeTip(e))}
                onMouseLeave={() => setFitTip(null)}
              >
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

                {hoverFitIdx !== null && bestPoints[hoverFitIdx] && meanPoints[hoverFitIdx] && (
                  <g pointerEvents="none">
                    <line
                      x1={fitHoverX}
                      y1={PAD_T}
                      x2={fitHoverX}
                      y2={SVG_H - PAD_B}
                      stroke="var(--text-primary)"
                      strokeOpacity="0.45"
                      strokeWidth="1.2"
                    />
                    <circle
                      cx={meanPoints[hoverFitIdx].x}
                      cy={meanPoints[hoverFitIdx].y}
                      r="4"
                      fill="var(--text-muted)"
                      stroke="var(--bg-surface)"
                      strokeWidth="1.5"
                    />
                    <circle
                      cx={bestPoints[hoverFitIdx].x}
                      cy={bestPoints[hoverFitIdx].y}
                      r="5"
                      fill="var(--accent-primary)"
                      stroke="var(--bg-surface)"
                      strokeWidth="1.8"
                    />
                  </g>
                )}
              </svg>

              {fitTip && fitHoverRecord && (
                <div
                  className={`chart-tooltip${fitTip.flipLeft ? ' flip-left' : ''}`}
                  style={{ left: `${fitTip.leftPx}px` }}
                >
                  <div className="chart-tooltip-title mono">
                    Итерация {fitHoverRecord.iteration}
                  </div>
                  <div className="chart-tooltip-row">
                    <span
                      className="chart-tooltip-dot"
                      style={{ background: 'var(--accent-primary)' }}
                    />
                    <span>f(G_best):</span>
                    <strong className="mono">
                      {formatTooltipVal(fitHoverRecord.global_best_fitness)}
                    </strong>
                  </div>
                  <div className="chart-tooltip-row">
                    <span className="chart-tooltip-dot" style={{ background: 'var(--text-muted)' }} />
                    <span>Среднее:</span>
                    <strong className="mono">{formatTooltipVal(fitHoverRecord.mean_fitness)}</strong>
                  </div>
                </div>
              )}
            </>
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

      {/* График 2 */}
      <section className="card chart-card">
        <div className="chart-header">
          <h3 className="card-title" style={{ marginBottom: 0 }}>
            Разнообразие и скорость роя
          </h3>
          <span className="badge mono">сжатие роя</span>
        </div>

        <div className="chart-svg-wrap" style={{ position: 'relative' }}>
          {history.length > 0 ? (
            <>
              <svg
                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                className="chart-svg chart-svg-interactive"
                role="img"
                aria-label="График разнообразия роя"
                onMouseMove={(e) => setDivTip(computeTip(e))}
                onMouseLeave={() => setDivTip(null)}
              >
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

                {hoverDivIdx !== null && diversityPoints[hoverDivIdx] && speedPoints[hoverDivIdx] && (
                  <g pointerEvents="none">
                    <line
                      x1={divHoverX}
                      y1={PAD_T}
                      x2={divHoverX}
                      y2={SVG_H - PAD_B}
                      stroke="var(--text-primary)"
                      strokeOpacity="0.45"
                      strokeWidth="1.2"
                    />
                    <circle
                      cx={speedPoints[hoverDivIdx].x}
                      cy={speedPoints[hoverDivIdx].y}
                      r="4.2"
                      fill="var(--accent-success)"
                      stroke="var(--bg-surface)"
                      strokeWidth="1.5"
                    />
                    <circle
                      cx={diversityPoints[hoverDivIdx].x}
                      cy={diversityPoints[hoverDivIdx].y}
                      r="4.8"
                      fill="var(--accent-secondary)"
                      stroke="var(--bg-surface)"
                      strokeWidth="1.8"
                    />
                  </g>
                )}
              </svg>

              {divTip && divHoverRecord && (
                <div
                  className={`chart-tooltip${divTip.flipLeft ? ' flip-left' : ''}`}
                  style={{ left: `${divTip.leftPx}px` }}
                >
                  <div className="chart-tooltip-title mono">
                    Итерация {divHoverRecord.iteration}
                  </div>
                  <div className="chart-tooltip-row">
                    <span
                      className="chart-tooltip-dot"
                      style={{ background: 'var(--accent-secondary)' }}
                    />
                    <span>Разнообразие:</span>
                    <strong className="mono">{formatTooltipVal(divHoverRecord.diversity)}</strong>
                  </div>
                  <div className="chart-tooltip-row">
                    <span
                      className="chart-tooltip-dot"
                      style={{ background: 'var(--accent-success)' }}
                    />
                    <span>Скорость |V|:</span>
                    <strong className="mono">{formatTooltipVal(divHoverRecord.mean_speed)}</strong>
                  </div>
                </div>
              )}
            </>
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