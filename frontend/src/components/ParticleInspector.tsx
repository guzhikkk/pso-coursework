import { Crosshair, X } from 'lucide-react';
import type { IterationRecord, OptimizeSummary } from '../types/api';
import './ParticleInspector.css';

interface ParticleInspectorProps {
  summary: OptimizeSummary | null;
  record: IterationRecord | null;
  selectedParticleId: number | null;
  onClearSelection: () => void;
}

function formatNum(value: number | null | undefined, digits = 5): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs > 0 && abs < 1e-4) return value.toExponential(2);
  if (abs >= 1e6) return value.toExponential(2);
  return value.toFixed(digits);
}

function formatVec(vec: number[] | undefined): string {
  if (!vec || vec.length === 0) return '—';
  const preview = vec.slice(0, 4).map((v) => v.toFixed(3)).join(', ');
  return vec.length > 4 ? `[${preview}, … +${vec.length - 4}]` : `[${preview}]`;
}

export function ParticleInspector({
  summary,
  record,
  selectedParticleId,
  onClearSelection,
}: ParticleInspectorProps) {
  const selectedParticle =
    record && selectedParticleId !== null
      ? record.particles.find((p) => p.id === selectedParticleId) ?? null
      : null;

  return (
    <section className="card inspector-wrapper">
      <h2 className="card-title" style={{ marginBottom: 0 }}>
        <span>Метрики роя и инспектор частицы</span>
        {summary?.convergence_iteration !== null && summary?.convergence_iteration !== undefined && (
          <span className="badge badge-success mono">
            Сходимость: итер. {summary.convergence_iteration}
          </span>
        )}
      </h2>

      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Лучшее f(G_best)</span>
          <span className="kpi-value accent mono">
            {formatNum(record?.global_best_fitness ?? summary?.best_fitness)}
          </span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Среднее f(x)</span>
          <span className="kpi-value mono">{formatNum(record?.mean_fitness)}</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Ошибка |f − f*|</span>
          <span className="kpi-value success mono">
            {formatNum(summary?.error_to_optimum)}
          </span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Разнообразие</span>
          <span className="kpi-value mono">{formatNum(record?.diversity, 4)}</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Инерция ω</span>
          <span className="kpi-value mono">{formatNum(record?.inertia_w, 3)}</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Вычислений NFE</span>
          <span className="kpi-value mono">{record ? record.nfe : '—'}</span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Время запуска</span>
          <span className="kpi-value mono">
            {summary ? `${summary.elapsed_ms.toFixed(1)} мс` : '—'}
          </span>
        </div>

        <div className="kpi-card">
          <span className="kpi-label">Пик памяти</span>
          <span className="kpi-value mono">
            {summary ? `${summary.peak_memory_kb.toFixed(1)} КБ` : '—'}
          </span>
        </div>
      </div>

      <div className="particle-box">
        <div className="particle-box-header">
          <span className="badge badge-accent">
            <Crosshair size={13} />
            <span>
              {selectedParticle ? `Частица #${selectedParticle.id}` : 'Инспектор частицы'}
            </span>
          </span>

          {selectedParticle && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={onClearSelection}
              title="Сбросить выбор частицы"
            >
              <X size={13} />
              <span>Снять выбор</span>
            </button>
          )}
        </div>

        {selectedParticle ? (
          <div>
            <div className="particle-kv">
              <span className="particle-k">Позиция X</span>
              <span className="particle-v mono">{formatVec(selectedParticle.position)}</span>
            </div>
            <div className="particle-kv">
              <span className="particle-k">Скорость V</span>
              <span className="particle-v mono">{formatVec(selectedParticle.velocity)}</span>
            </div>
            <div className="particle-kv">
              <span className="particle-k">Модуль |V|</span>
              <span className="particle-v mono">{formatNum(selectedParticle.speed, 4)}</span>
            </div>
            <div className="particle-kv">
              <span className="particle-k">Текущее f(X)</span>
              <span className="particle-v mono">{formatNum(selectedParticle.fitness)}</span>
            </div>
            <div className="particle-kv">
              <span className="particle-k">Личный рекорд P_best</span>
              <span className="particle-v mono">{formatVec(selectedParticle.best_position)}</span>
            </div>
            <div className="particle-kv">
              <span className="particle-k">Лучшее f(P_best)</span>
              <span className="particle-v mono">{formatNum(selectedParticle.best_fitness)}</span>
            </div>
          </div>
        ) : (
          <p className="particle-empty">
            Нажмите на любую частицу на тепловой карте выше, чтобы увидеть её координаты, вектор скорости и личный рекорд P_best.
          </p>
        )}
      </div>
    </section>
  );
}