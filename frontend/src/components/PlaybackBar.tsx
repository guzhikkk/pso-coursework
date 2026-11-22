import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import './PlaybackBar.css';

interface PlaybackBarProps {
  currentStep: number;
  totalSteps: number;
  isPlaying: boolean;
  speed: number;
  disabled: boolean;
  onTogglePlay: () => void;
  onStepChange: (step: number) => void;
  onSpeedChange: (speed: number) => void;
}

const SPEED_OPTIONS = [1, 2, 4];

export function PlaybackBar({
  currentStep,
  totalSteps,
  isPlaying,
  speed,
  disabled,
  onTogglePlay,
  onStepChange,
  onSpeedChange,
}: PlaybackBarProps) {
  const maxStep = Math.max(0, totalSteps - 1);

  return (
    <section className="card playback-bar" aria-label="Управление воспроизведением итераций">
      <div className="playback-controls">
        <div className="playback-buttons">
          <button
            type="button"
            className="btn playback-icon-btn"
            onClick={() => onStepChange(0)}
            disabled={disabled || currentStep === 0}
            title="В начало (итерация 0)"
            aria-label="В начало"
          >
            <SkipBack size={15} />
          </button>

          <button
            type="button"
            className="btn playback-icon-btn"
            onClick={() => onStepChange(Math.max(0, currentStep - 1))}
            disabled={disabled || currentStep === 0}
            title="Предыдущая итерация"
            aria-label="Назад на шаг"
          >
            <ChevronLeft size={16} />
          </button>

          <button
            type="button"
            className="btn btn-primary playback-icon-btn"
            onClick={onTogglePlay}
            disabled={disabled}
            title={isPlaying ? 'Пауза' : 'Воспроизвести'}
            aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
          </button>

          <button
            type="button"
            className="btn playback-icon-btn"
            onClick={() => onStepChange(Math.min(maxStep, currentStep + 1))}
            disabled={disabled || currentStep >= maxStep}
            title="Следующая итерация"
            aria-label="Вперёд на шаг"
          >
            <ChevronRight size={16} />
          </button>

          <button
            type="button"
            className="btn playback-icon-btn"
            onClick={() => onStepChange(maxStep)}
            disabled={disabled || currentStep >= maxStep}
            title="К финальной итерации"
            aria-label="В конец"
          >
            <SkipForward size={15} />
          </button>
        </div>

        <div className="playback-speed" role="group" aria-label="Скорость анимации">
          {SPEED_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`speed-btn mono${speed === opt ? ' active' : ''}`}
              onClick={() => onSpeedChange(opt)}
              disabled={disabled}
            >
              {opt}x
            </button>
          ))}
        </div>
      </div>

      <div className="playback-slider-row">
        <input
          type="range"
          className="playback-slider"
          min={0}
          max={maxStep}
          value={Math.min(currentStep, maxStep)}
          disabled={disabled}
          onChange={(e) => onStepChange(Number(e.target.value))}
          aria-label="Выбор итерации"
        />
        <span className="playback-counter mono">
          Итерация {disabled ? '—' : `${currentStep} / ${maxStep}`}
        </span>
      </div>
    </section>
  );
}