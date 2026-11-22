import { useEffect, useState } from 'react';
import { ComparisonTab } from './components/ComparisonTab';
import { ControlPanel } from './components/ControlPanel';
import { ConvergenceCharts } from './components/ConvergenceCharts';
import { Header, type BackendStatus } from './components/Header';
import { ParticleInspector } from './components/ParticleInspector';
import { PlaybackBar } from './components/PlaybackBar';
import { ScaleBenchmarkTab } from './components/ScaleBenchmarkTab';
import { SwarmHeatmapCanvas } from './components/SwarmHeatmapCanvas';
import { apiClient } from './services/apiClient';
import type {
  AppTab,
  FunctionMeta,
  OptimizeConfig,
  OptimizeResult,
  ThemeMode,
} from './types/api';
import './App.css';

const DEFAULT_CONFIG: OptimizeConfig = {
  function_id: 'rastrigin',
  custom_formula: '(x - 1)^2 + (y + 2)^2',
  custom_bounds: [-5, 5],
  dim: 2,
  num_particles: 30,
  max_iterations: 80,
  variant: 'ldiw',
  topology: 'gbest',
  boundary_strategy: 'reflect',
  w: 0.72,
  w_max: 0.9,
  w_min: 0.4,
  chi: 0.7298,
  c1: 1.5,
  c2: 1.5,
  seed: 42,
  axis_x: 0,
  axis_y: 1,
  max_vel_ratio: 0.2,
  heatmap_resolution: 50,
};

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('pso-theme');
    return saved === 'light' ? 'light' : 'dark';
  });
  const [activeTab, setActiveTab] = useState<AppTab>('simulator');
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [functions, setFunctions] = useState<FunctionMeta[]>([]);
  const [config, setConfig] = useState<OptimizeConfig>(DEFAULT_CONFIG);

  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedParticleId, setSelectedParticleId] = useState<number | null>(null);

  // Синхронизация темы с DOM и localStorage
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('pso-theme', theme);
  }, [theme]);

  // Проверка подключения к Flask API и загрузка каталога функций
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await apiClient.health();
        const catalog = await apiClient.getFunctions();
        if (!cancelled) {
          setBackendStatus('online');
          setFunctions(catalog.functions);
        }
      } catch {
        if (!cancelled) {
          setBackendStatus('offline');
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // Таймер анимации плеера итераций
  const totalSteps = result?.history.length ?? 0;

  useEffect(() => {
    if (!isPlaying || totalSteps === 0) return;

    const intervalMs = Math.max(40, Math.round(220 / speed));
    const timer = window.setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= totalSteps - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [isPlaying, speed, totalSteps]);

  const handleRunOptimize = async () => {
    setIsLoading(true);
    setError(null);
    setIsPlaying(false);
    setSelectedParticleId(null);

    try {
      const data = await apiClient.optimize(config);
      setResult(data);
      setCurrentStep(0);
      setIsPlaying(true);
      setBackendStatus('online');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось выполнить оптимизацию. Проверьте, запущен ли Flask-сервер.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleTogglePlay = () => {
    if (totalSteps === 0) return;
    if (!isPlaying && currentStep >= totalSteps - 1) {
      setCurrentStep(0);
    }
    setIsPlaying((prev) => !prev);
  };

  const handleStepChange = (step: number) => {
    setIsPlaying(false);
    setCurrentStep(step);
  };

  const currentRecord = result?.history[currentStep] ?? null;

  return (
    <div className="app-shell">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        backendStatus={backendStatus}
      />

      <main className="app-main">
        {backendStatus === 'offline' && (
          <div className="error-banner" style={{ marginBottom: 'var(--space-4)' }}>
            Не удалось подключиться к бэкенду ({apiClient.baseUrl}). Убедитесь, что Flask-сервер запущен.
          </div>
        )}

        {activeTab === 'simulator' && (
          <div className="simulator-layout">
            <ControlPanel
              functions={functions}
              config={config}
              onChange={setConfig}
              onRun={handleRunOptimize}
              onResetDefaults={() => setConfig(DEFAULT_CONFIG)}
              isLoading={isLoading}
            />

            <div className="simulator-workspace">
              {error && <div className="error-banner">{error}</div>}

              <SwarmHeatmapCanvas
                heatmap={result?.heatmap ?? null}
                history={result?.history ?? []}
                currentStep={currentStep}
                selectedParticleId={selectedParticleId}
                onSelectParticle={setSelectedParticleId}
                theme={theme}
              />

              <PlaybackBar
                currentStep={currentStep}
                totalSteps={totalSteps}
                isPlaying={isPlaying}
                speed={speed}
                disabled={totalSteps === 0}
                onTogglePlay={handleTogglePlay}
                onStepChange={handleStepChange}
                onSpeedChange={setSpeed}
              />

              <ParticleInspector
                summary={result?.summary ?? null}
                record={currentRecord}
                selectedParticleId={selectedParticleId}
                onClearSelection={() => setSelectedParticleId(null)}
              />

              <ConvergenceCharts
                history={result?.history ?? []}
                currentStep={currentStep}
              />
            </div>
          </div>
        )}

        {activeTab === 'compare' && (
          <ComparisonTab
            functions={functions}
            config={config}
            onConfigChange={setConfig}
          />
        )}

        {activeTab === 'scale' && (
          <ScaleBenchmarkTab functions={functions} config={config} />
        )}
      </main>
    </div>
  );
}

export default App;