import { useState, type CSSProperties } from 'react';
import { CheckCircle2, Play, RotateCcw } from 'lucide-react';
import { apiClient } from '../services/apiClient';
import type {
  BoundaryStrategy,
  FunctionMeta,
  OptimizeConfig,
  PSOVariant,
  TopologyType,
  ValidateFormulaResponse,
} from '../types/api';
import './ControlPanel.css';

interface ControlPanelProps {
  functions: FunctionMeta[];
  config: OptimizeConfig;
  onChange: (next: OptimizeConfig) => void;
  onRun: () => void;
  onResetDefaults: () => void;
  isLoading: boolean;
}

function rangeStyle(value: number, min: number, max: number): CSSProperties {
  const pct = Math.max(0, Math.min(100, ((value - min) / Math.max(1e-9, max - min)) * 100));
  return { '--range-progress': `${pct}%` } as CSSProperties;
}

function getShortFormula(id: string): string {
  const key = id.toLowerCase();
  if (key.includes('sphere')) return 'Σ xᵢ²';
  if (key.includes('rastrigin')) return '10n + Σ(xᵢ² − 10cos)';
  if (key.includes('rosenbrock')) return 'Σ[100(y−x²)² + (1−x)²]';
  if (key.includes('ackley')) return '−20e^(−0.2√…) − e^(cos)';
  return 'f(x₁, …, xₙ)';
}

function FunctionReliefIcon({ id }: { id: string }) {
  const key = id.toLowerCase();

  if (key.includes('sphere')) {
    return (
      <svg className="preset-card-svg" viewBox="0 0 80 36" fill="none" aria-hidden="true">
        <circle cx="40" cy="18" r="15" stroke="#f59e0b" strokeOpacity="0.28" strokeWidth="1.2" />
        <circle cx="40" cy="18" r="10" stroke="#f59e0b" strokeOpacity="0.55" strokeWidth="1.2" />
        <circle cx="40" cy="18" r="5" stroke="#fbbf24" strokeOpacity="0.85" strokeWidth="1.4" />
        <circle cx="40" cy="18" r="2" fill="#fcd34d" />
      </svg>
    );
  }

  if (key.includes('rastrigin')) {
    return (
      <svg className="preset-card-svg" viewBox="0 0 80 36" fill="none" aria-hidden="true">
        {[14, 27, 40, 53, 66].map((cx) =>
          [10, 18, 26].map((cy) => (
            <circle
              key={`${cx}-${cy}`}
              cx={cx}
              cy={cy}
              r={cx === 40 && cy === 18 ? 2.6 : 1.7}
              fill={cx === 40 && cy === 18 ? '#fcd34d' : '#f59e0b'}
              fillOpacity={cx === 40 && cy === 18 ? 1 : 0.45}
            />
          ))
        )}
      </svg>
    );
  }

  if (key.includes('rosenbrock')) {
    return (
      <svg className="preset-card-svg" viewBox="0 0 80 36" fill="none" aria-hidden="true">
        <path
          d="M10 8 C24 32, 56 32, 70 8"
          stroke="#f59e0b"
          strokeOpacity="0.35"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d="M16 10 C28 28, 52 28, 64 10"
          stroke="#fbbf24"
          strokeOpacity="0.75"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="40" cy="23" r="2.2" fill="#fcd34d" />
      </svg>
    );
  }

  return (
    <svg className="preset-card-svg" viewBox="0 0 80 36" fill="none" aria-hidden="true">
      <path
        d="M8 18 Q26 18 40 4 Q54 18 72 18 Q54 18 40 32 Q26 18 8 18 Z"
        stroke="#f59e0b"
        strokeOpacity="0.45"
        strokeWidth="1.2"
        fill="#f59e0b"
        fillOpacity="0.1"
      />
      <path
        d="M22 18 Q34 18 40 10 Q46 18 58 18 Q46 18 40 26 Q34 18 22 18 Z"
        stroke="#fbbf24"
        strokeOpacity="0.8"
        strokeWidth="1.2"
      />
      <circle cx="40" cy="18" r="2.2" fill="#fcd34d" />
    </svg>
  );
}

export function ControlPanel({
  functions,
  config,
  onChange,
  onRun,
  onResetDefaults,
  isLoading,
}: ControlPanelProps) {
  const [formulaCheck, setFormulaCheck] = useState<ValidateFormulaResponse | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const isCustom = config.function_id === 'custom';
  const selectedMeta = functions.find((f) => f.id === config.function_id) ?? null;
  const supportsNd = isCustom ? true : (selectedMeta?.supports_nd ?? true);
  const quickPresets = functions.slice(0, 4);

  const update = <K extends keyof OptimizeConfig>(key: K, value: OptimizeConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  const handleFunctionChange = (nextId: string) => {
    setFormulaCheck(null);
    if (nextId === 'custom') {
      onChange({
        ...config,
        function_id: 'custom',
        custom_formula: config.custom_formula || '(x - 1)^2 + (y + 2)^2',
      });
      return;
    }
    const meta = functions.find((f) => f.id === nextId);
    const nextDim = meta && !meta.supports_nd ? 2 : config.dim;
    onChange({
      ...config,
      function_id: nextId,
      dim: nextDim,
      axis_x: nextDim === 2 ? 0 : Math.min(config.axis_x, nextDim - 1),
      axis_y: nextDim === 2 ? 1 : Math.min(config.axis_y, nextDim - 1),
    });
  };

  const handleDimChange = (rawDim: number) => {
    const dim = Math.max(2, Math.min(50, Number.isNaN(rawDim) ? 2 : Math.round(rawDim)));
    let axisX = Math.min(config.axis_x, dim - 1);
    let axisY = Math.min(config.axis_y, dim - 1);
    if (axisX === axisY) {
      axisX = 0;
      axisY = 1;
    }
    onChange({ ...config, dim, axis_x: axisX, axis_y: axisY });
  };

  const handleValidateFormula = async () => {
    const formula = (config.custom_formula ?? '').trim();
    if (!formula) {
      setFormulaCheck({
        valid: false,
        normalized_formula: null,
        sample_value: null,
        error: 'Введите математическую формулу.',
      });
      return;
    }
    setIsValidating(true);
    try {
      const res = await apiClient.validateFormula({ formula, dim: config.dim });
      setFormulaCheck(res);
    } catch (err) {
      setFormulaCheck({
        valid: false,
        normalized_formula: null,
        sample_value: null,
        error: err instanceof Error ? err.message : 'Ошибка проверки формулы.',
      });
    } finally {
      setIsValidating(false);
    }
  };

  const clampedParticles = Math.min(300, Math.max(5, config.num_particles));
  const clampedIterations = Math.min(500, Math.max(10, config.max_iterations));
  const clampedSeed = config.seed === null ? 0 : Math.min(1000, Math.max(0, config.seed));

  return (
    <aside className="card control-panel">
      <div className="control-section">
        <div className="card-title" style={{ marginBottom: 0 }}>
          <span>Целевая функция</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onResetDefaults}
            title="Сбросить параметры по умолчанию"
          >
            <RotateCcw size={13} />
            <span>Сброс</span>
          </button>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="fn-select">
            Тестовая функция
          </label>
          <select
            id="fn-select"
            className="select"
            value={config.function_id}
            onChange={(e) => handleFunctionChange(e.target.value)}
          >
            {functions.map((fn) => (
              <option key={fn.id} value={fn.id}>
                {fn.name}
              </option>
            ))}
            <option value="custom">Своя формула (AST-парсер)</option>
          </select>
        </div>

        {quickPresets.length > 0 && (
          <div className="preset-grid" role="group" aria-label="Быстрый выбор функции">
            {quickPresets.map((fn) => (
              <button
                key={fn.id}
                type="button"
                className={`preset-card${config.function_id === fn.id ? ' active' : ''}`}
                onClick={() => handleFunctionChange(fn.id)}
                title={fn.description}
              >
                <FunctionReliefIcon id={fn.id} />
                <span className="preset-card-name">{fn.name}</span>
                <span className="preset-card-formula mono">{getShortFormula(fn.id)}</span>
              </button>
            ))}
          </div>
        )}

        {selectedMeta && !isCustom && (
          <div className="function-preview">
            <div className="function-formula mono">{selectedMeta.formula_display}</div>
            <div>{selectedMeta.description}</div>
          </div>
        )}

        {isCustom && (
          <>
            <div className="field">
              <label className="field-label" htmlFor="custom-formula">
                Формула f(x, y) или f(x1..xD)
              </label>
              <input
                id="custom-formula"
                type="text"
                className="input mono"
                value={config.custom_formula ?? ''}
                onChange={(e) => {
                  setFormulaCheck(null);
                  update('custom_formula', e.target.value);
                }}
                placeholder="(x - 1)^2 + (y + 2)^2"
              />
            </div>

            <div className="field-row">
              <div className="field">
                <label className="field-label" htmlFor="bound-min">
                  Граница min
                </label>
                <input
                  id="bound-min"
                  type="number"
                  step="0.5"
                  className="input mono"
                  value={config.custom_bounds[0]}
                  onChange={(e) =>
                    update('custom_bounds', [Number(e.target.value), config.custom_bounds[1]])
                  }
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="bound-max">
                  Граница max
                </label>
                <input
                  id="bound-max"
                  type="number"
                  step="0.5"
                  className="input mono"
                  value={config.custom_bounds[1]}
                  onChange={(e) =>
                    update('custom_bounds', [config.custom_bounds[0], Number(e.target.value)])
                  }
                />
              </div>
            </div>

            <button
              type="button"
              className="btn btn-sm"
              onClick={handleValidateFormula}
              disabled={isValidating}
            >
              <CheckCircle2 size={14} />
              <span>{isValidating ? 'Проверка...' : 'Проверить формулу'}</span>
            </button>

            {formulaCheck && (
              <div className={`formula-feedback ${formulaCheck.valid ? 'ok' : 'err'}`}>
                {formulaCheck.valid
                  ? `Формула корректна · f(0.5) = ${formulaCheck.sample_value}`
                  : formulaCheck.error}
              </div>
            )}
          </>
        )}
      </div>

      <div className="control-section">
        <h3 className="control-section-title">Размерность и рой</h3>

        <div className="field-row">
          <div className="slider-field">
            <label className="field-label" htmlFor="dim-input">
              Размерность D
            </label>
            <input
              id="dim-input"
              type="number"
              min={2}
              max={50}
              disabled={!supportsNd}
              className="input mono"
              value={config.dim}
              onChange={(e) => handleDimChange(Number(e.target.value))}
            />
            <input
              type="range"
              min={2}
              max={50}
              disabled={!supportsNd}
              value={config.dim}
              style={rangeStyle(config.dim, 2, 50)}
              onChange={(e) => handleDimChange(Number(e.target.value))}
              aria-label="Ползунок размерности D"
            />
          </div>

          <div className="slider-field">
            <label className="field-label" htmlFor="particles-input">
              Частиц N
            </label>
            <input
              id="particles-input"
              type="number"
              min={5}
              max={300}
              className="input mono"
              value={config.num_particles}
              onChange={(e) => update('num_particles', Math.max(2, Number(e.target.value) || 2))}
            />
            <input
              type="range"
              min={5}
              max={300}
              step={5}
              value={clampedParticles}
              style={rangeStyle(clampedParticles, 5, 300)}
              onChange={(e) => update('num_particles', Number(e.target.value))}
              aria-label="Ползунок числа частиц N"
            />
          </div>
        </div>

        <div className="field-row">
          <div className="slider-field">
            <label className="field-label" htmlFor="iters-input">
              Итераций I
            </label>
            <input
              id="iters-input"
              type="number"
              min={5}
              max={500}
              className="input mono"
              value={config.max_iterations}
              onChange={(e) => update('max_iterations', Math.max(1, Number(e.target.value) || 1))}
            />
            <input
              type="range"
              min={10}
              max={500}
              step={10}
              value={clampedIterations}
              style={rangeStyle(clampedIterations, 10, 500)}
              onChange={(e) => update('max_iterations', Number(e.target.value))}
              aria-label="Ползунок числа итераций I"
            />
          </div>

          <div className="slider-field">
            <label className="field-label" htmlFor="seed-input">
              Seed (пусто = случ.)
            </label>
            <input
              id="seed-input"
              type="number"
              className="input mono"
              value={config.seed ?? ''}
              onChange={(e) => {
                const raw = e.target.value.trim();
                update('seed', raw === '' ? null : Number(raw));
              }}
              placeholder="42"
            />
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={clampedSeed}
              style={rangeStyle(clampedSeed, 0, 1000)}
              onChange={(e) => update('seed', Number(e.target.value))}
              aria-label="Ползунок Seed"
            />
          </div>
        </div>

        {config.dim > 2 && (
          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor="axis-x">
                Ось X проекции
              </label>
              <select
                id="axis-x"
                className="select mono"
                value={config.axis_x}
                onChange={(e) => {
                  const nextX = Number(e.target.value);
                  const nextY = nextX === config.axis_y ? (nextX === 0 ? 1 : 0) : config.axis_y;
                  onChange({ ...config, axis_x: nextX, axis_y: nextY });
                }}
              >
                {Array.from({ length: config.dim }, (_, idx) => (
                  <option key={idx} value={idx}>
                    x{idx + 1}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="axis-y">
                Ось Y проекции
              </label>
              <select
                id="axis-y"
                className="select mono"
                value={config.axis_y}
                onChange={(e) => {
                  const nextY = Number(e.target.value);
                  const nextX = nextY === config.axis_x ? (nextY === 0 ? 1 : 0) : config.axis_x;
                  onChange({ ...config, axis_x: nextX, axis_y: nextY });
                }}
              >
                {Array.from({ length: config.dim }, (_, idx) => (
                  <option key={idx} value={idx}>
                    x{idx + 1}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="control-section">
        <h3 className="control-section-title">Модификация и топология</h3>

        <div className="field">
          <label className="field-label" htmlFor="variant-select">
            Модификация PSO
          </label>
          <select
            id="variant-select"
            className="select"
            value={config.variant}
            onChange={(e) => update('variant', e.target.value as PSOVariant)}
          >
            <option value="classic">Классический PSO (фикс. ω)</option>
            <option value="ldiw">Убывающая инерция LDIW (ω_max → ω_min)</option>
            <option value="constriction">Сжатие Клерка — Кеннеди (χ)</option>
          </select>
        </div>

        <div className="field">
          <span className="field-label">Топология соседства</span>
          <div className="segmented">
            {(['gbest', 'lbest'] as TopologyType[]).map((topo) => (
              <button
                key={topo}
                type="button"
                className={`segmented-btn${config.topology === topo ? ' active' : ''}`}
                onClick={() => update('topology', topo)}
              >
                {topo === 'gbest' ? 'Глобальная (gbest)' : 'Кольцевая (lbest)'}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="boundary-select">
            Обработка границ
          </label>
          <select
            id="boundary-select"
            className="select"
            value={config.boundary_strategy}
            onChange={(e) => update('boundary_strategy', e.target.value as BoundaryStrategy)}
          >
            <option value="reflect">Отражение (reflect)</option>
            <option value="clamp">Ограничение (clamp)</option>
            <option value="absorb">Поглощение (absorb)</option>
          </select>
        </div>

        {config.variant === 'classic' && (
          <div className="field">
            <label className="field-label" htmlFor="w-input">
              <span>Инерция ω</span>
              <span className="mono">{config.w.toFixed(2)}</span>
            </label>
            <input
              id="w-input"
              type="range"
              min={0.1}
              max={1.2}
              step={0.02}
              value={config.w}
              style={rangeStyle(config.w, 0.1, 1.2)}
              onChange={(e) => update('w', Number(e.target.value))}
            />
          </div>
        )}

        {config.variant === 'ldiw' && (
          <div className="field-row">
            <div className="slider-field">
              <label className="field-label" htmlFor="wmax-input">
                ω_max
              </label>
              <input
                id="wmax-input"
                type="number"
                step="0.05"
                min={0.2}
                max={1.5}
                className="input mono"
                value={config.w_max}
                onChange={(e) => update('w_max', Number(e.target.value))}
              />
              <input
                type="range"
                min={0.2}
                max={1.5}
                step={0.05}
                value={Math.min(1.5, Math.max(0.2, config.w_max))}
                style={rangeStyle(config.w_max, 0.2, 1.5)}
                onChange={(e) => update('w_max', Number(e.target.value))}
                aria-label="Ползунок ω_max"
              />
            </div>
            <div className="slider-field">
              <label className="field-label" htmlFor="wmin-input">
                ω_min
              </label>
              <input
                id="wmin-input"
                type="number"
                step="0.05"
                min={0.05}
                max={1.0}
                className="input mono"
                value={config.w_min}
                onChange={(e) => update('w_min', Number(e.target.value))}
              />
              <input
                type="range"
                min={0.05}
                max={1.0}
                step={0.05}
                value={Math.min(1.0, Math.max(0.05, config.w_min))}
                style={rangeStyle(config.w_min, 0.05, 1.0)}
                onChange={(e) => update('w_min', Number(e.target.value))}
                aria-label="Ползунок ω_min"
              />
            </div>
          </div>
        )}

        {config.variant === 'constriction' && (
          <div className="slider-field">
            <label className="field-label" htmlFor="chi-input">
              <span>Коэффициент сжатия χ</span>
              <span className="mono">{config.chi.toFixed(4)}</span>
            </label>
            <input
              id="chi-input"
              type="number"
              step="0.01"
              min={0.1}
              max={1.0}
              className="input mono"
              value={config.chi}
              onChange={(e) => update('chi', Number(e.target.value))}
            />
            <input
              type="range"
              min={0.1}
              max={1.0}
              step={0.01}
              value={Math.min(1.0, Math.max(0.1, config.chi))}
              style={rangeStyle(config.chi, 0.1, 1.0)}
              onChange={(e) => update('chi', Number(e.target.value))}
              aria-label="Ползунок коэффициента сжатия χ"
            />
          </div>
        )}

        <div className="field-row">
          <div className="slider-field">
            <label className="field-label" htmlFor="c1-input">
              Когнитивный c₁
            </label>
            <input
              id="c1-input"
              type="number"
              step="0.05"
              min={0}
              max={4}
              className="input mono"
              value={config.c1}
              onChange={(e) => update('c1', Number(e.target.value))}
            />
            <input
              type="range"
              min={0}
              max={4}
              step={0.05}
              value={Math.min(4, Math.max(0, config.c1))}
              style={rangeStyle(config.c1, 0, 4)}
              onChange={(e) => update('c1', Number(e.target.value))}
              aria-label="Ползунок когнитивного коэффициента c₁"
            />
          </div>
          <div className="slider-field">
            <label className="field-label" htmlFor="c2-input">
              Социальный c₂
            </label>
            <input
              id="c2-input"
              type="number"
              step="0.05"
              min={0}
              max={4}
              className="input mono"
              value={config.c2}
              onChange={(e) => update('c2', Number(e.target.value))}
            />
            <input
              type="range"
              min={0}
              max={4}
              step={0.05}
              value={Math.min(4, Math.max(0, config.c2))}
              style={rangeStyle(config.c2, 0, 4)}
              onChange={(e) => update('c2', Number(e.target.value))}
              aria-label="Ползунок социального коэффициента c₂"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary run-btn"
        onClick={onRun}
        disabled={isLoading}
      >
        <Play size={16} />
        <span>{isLoading ? 'Вычисление роя...' : 'Запустить оптимизацию'}</span>
      </button>
    </aside>
  );
}