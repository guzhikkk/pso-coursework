import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

interface ParticleData {
  id: number;
  position: [number, number];
  velocity: [number, number];
  best_position: [number, number];
  score: number;
  trajectory: [number, number][];
}

interface SwarmState {
  function: string;
  iteration: number;
  global_best_position: [number, number];
  global_best_score: number;
  optimum: [number, number];
  bounds: [[number, number], [number, number]];
  particles: ParticleData[];
  history: { iteration: number; best_score: number }[];
}

const API_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:5000/api'
  :'https://pso-coursework.onrender.com/api';

// Математические функции на клиенте для быстрой отрисовки тепловой карты рельефа
const evalFunc = (fn: string, x: number, y: number): number => {
  if (fn === 'sphere') return x * x + y * y;
  if (fn === 'rosenbrock') return 100 * Math.pow(y - x * x, 2) + Math.pow(1 - x, 2);
  return 20 + (x * x - 10 * Math.cos(2 * Math.PI * x)) + (y * y - 10 * Math.cos(2 * Math.PI * y));
};

export function App() {
  const [funcName, setFuncName] = useState<string>('rastrigin');
  const [numParticles, setNumParticles] = useState<number>(30);
  const [w, setW] = useState<number>(0.7);
  const [c1, setC1] = useState<number>(1.5);
  const [c2, setC2] = useState<number>(1.5);

  const [showVelocity, setShowVelocity] = useState<boolean>(true);
  const [showTrajectories, setShowTrajectories] = useState<boolean>(true);
  const [showPersonalBest, setShowPersonalBest] = useState<boolean>(true);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  const [swarmState, setSwarmState] = useState<SwarmState | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const heatmapCacheRef = useRef<ImageData | null>(null);

  const initSwarm = useCallback(async () => {
    setIsRunning(false);
    const res = await fetch(`${API_URL}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ function: funcName, num_particles: numParticles, w, c1, c2 }),
    });
    const data: SwarmState = await res.json();
    heatmapCacheRef.current = null; // Сброс кэша тепловой карты при смене функции
    setSwarmState(data);
  }, [funcName, numParticles, w, c1, c2]);

  const stepSwarm = useCallback(async (steps = 1) => {
    const res = await fetch(`${API_URL}/step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps, w, c1, c2 }),
    });
    if (res.ok) {
      const data: SwarmState = await res.json();
      setSwarmState(data);
    }
  }, [w, c1, c2]);

  useEffect(() => {
    initSwarm();
  }, [funcName]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      stepSwarm(1);
    }, 100);
    return () => clearInterval(timer);
  }, [isRunning, stepSwarm]);

  // Отрисовка тепловой карты и роя на Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !swarmState) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const [[xMin, xMax], [yMin, yMax]] = swarmState.bounds;

    const toPx = (x: number, y: number): [number, number] => [
      ((x - xMin) / (xMax - xMin)) * width,
      height - ((y - yMin) / (yMax - yMin)) * height,
    ];

    // 1. Генерация и кэширование тепловой карты целевой функции
    if (!heatmapCacheRef.current) {
      const imgData = ctx.createImageData(width, height);
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const x = xMin + (px / width) * (xMax - xMin);
          const y = yMax - (py / height) * (yMax - yMin);
          const val = evalFunc(swarmState.function, x, y);

          // Логарифмическая нормализация цвета для наглядности оврагов и минимумов
          const norm = Math.min(1, Math.log10(val + 1) / (swarmState.function === 'rosenbrock' ? 3.2 : 2.0));
          const idx = (py * width + px) * 4;
          imgData.data[idx] = Math.floor(12 + norm * 35);     // R
          imgData.data[idx + 1] = Math.floor(20 + norm * 55); // G
          imgData.data[idx + 2] = Math.floor(45 + norm * 95); // B
          imgData.data[idx + 3] = 255;                        // A
        }
      }
      heatmapCacheRef.current = imgData;
    }
    ctx.putImageData(heatmapCacheRef.current, 0, 0);

    // 2. Отрисовка истинного аналитического оптимума (зеленый крестик)
    const [optX, optY] = toPx(swarmState.optimum[0], swarmState.optimum[1]);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(optX - 8, optY); ctx.lineTo(optX + 8, optY);
    ctx.moveTo(optX, optY - 8); ctx.lineTo(optX, optY + 8);
    ctx.stroke();

    // 3. Отрисовка частиц, траекторий, векторов скоростей и P_best
    swarmState.particles.forEach((p) => {
      const [px, py] = toPx(p.position[0], p.position[1]);

      if (showTrajectories && p.trajectory.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.35)';
        ctx.lineWidth = 1.5;
        p.trajectory.forEach(([tx, ty], i) => {
          const [cx, cy] = toPx(tx, ty);
          if (i === 0) ctx.moveTo(cx, cy);
          else ctx.lineTo(cx, cy);
        });
        ctx.stroke();
      }

      if (showPersonalBest) {
        const [bx, by] = toPx(p.best_position[0], p.best_position[1]);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.55)';
        ctx.beginPath();
        ctx.arc(bx, by, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      if (showVelocity) {
        const [vx, vy] = toPx(p.position[0] + p.velocity[0] * 0.6, p.position[1] + p.velocity[1] * 0.6);
        ctx.beginPath();
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.moveTo(px, py);
        ctx.lineTo(vx, vy);
        ctx.stroke();
      }

      // Кибер-пчела (частица)
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // 4. Отрисовка глобального лучшего решения роя G_best (красный маяк)
    if (swarmState.global_best_position) {
      const [gx, gy] = toPx(swarmState.global_best_position[0], swarmState.global_best_position[1]);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(gx, gy, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [swarmState, showVelocity, showTrajectories, showPersonalBest]);

  return (
    <div className="app-container">
      <header className="header">
        <h1>* CyberSwarm PSO — Визуализатор метода роя частиц</h1>
        <span>Курсовая работа: Алгоритмы и структуры данных</span>
      </header>

      <div className="main-grid">
        {/* Левая панель управления */}
        <div className="panel">
          <h2>Параметры алгоритма</h2>

          <div className="control-group">
            <label>Целевая функция:</label>
            <select value={funcName} onChange={(e) => setFuncName(e.target.value)}>
              <option value="rastrigin">Функция Растригина</option>
              <option value="rosenbrock">Функция Розенброка</option>
              <option value="sphere">Функция Сферы</option>
            </select>
          </div>

          <div className="control-group">
            <label><span>Число частиц (N):</span> <strong>{numParticles}</strong></label>
            <input type="range" min="10" max="120" step="5" value={numParticles}
              onChange={(e) => setNumParticles(Number(e.target.value))} />
          </div>

          <div className="control-group">
            <label><span>Инерция (w):</span> <strong>{w.toFixed(2)}</strong></label>
            <input type="range" min="0.1" max="1.2" step="0.05" value={w}
              onChange={(e) => setW(Number(e.target.value))} />
          </div>

          <div className="control-group">
            <label><span>Когнитивный коэфф. (c1):</span> <strong>{c1.toFixed(2)}</strong></label>
            <input type="range" min="0.0" max="3.0" step="0.1" value={c1}
              onChange={(e) => setC1(Number(e.target.value))} />
          </div>

          <div className="control-group">
            <label><span>Социальный коэфф. (c2):</span> <strong>{c2.toFixed(2)}</strong></label>
            <input type="range" min="0.0" max="3.0" step="0.1" value={c2}
              onChange={(e) => setC2(Number(e.target.value))} />
          </div>

          <div className="checkbox-group">
            <label>
              <input type="checkbox" checked={showTrajectories} onChange={(e) => setShowTrajectories(e.target.checked)} />
              Показывать траектории движения
            </label>
            <label>
              <input type="checkbox" checked={showVelocity} onChange={(e) => setShowVelocity(e.target.checked)} />
              Показывать векторы скорости
            </label>
            <label>
              <input type="checkbox" checked={showPersonalBest} onChange={(e) => setShowPersonalBest(e.target.checked)} />
              Показывать личные рекорды (P_best)
            </label>
          </div>

          <div className="btn-grid">
            <button className="btn-primary" onClick={() => setIsRunning(!isRunning)}>
              {isRunning ? '* Пауза' : '* Автозапуск роя'}
            </button>
            <button className="btn-step" onClick={() => stepSwarm(1)} disabled={isRunning}>
              +1 шаг
            </button>
            <button className="btn-step" onClick={() => stepSwarm(10)} disabled={isRunning}>
              +10 шагов
            </button>
            <button className="btn-reset" onClick={initSwarm}>
              * Пересоздать рой
            </button>
          </div>
        </div>

        {/* Центральный холст визуализации */}
        <div className="canvas-wrapper">
          <canvas ref={canvasRef} width={580} height={580} />
          <div className="legend">
            <span>* Частица роя</span>
            <span>* Вектор скорости и P_best</span>
            <span>* Глобальный лидер G_best</span>
            <span>* Истинный минимум</span>
          </div>
        </div>

        {/* Правая панель метрик и графика сходимости */}
        <div className="panel">
          <h2>Телеметрия и результаты</h2>
          {swarmState && (
            <>
              <div className="stat-box">
                <div className="stat-label">Текущая итерация</div>
                <div className="stat-value">{swarmState.iteration}</div>
              </div>

              <div className="stat-box">
                <div className="stat-label">Лучшее значение функции f(G_best)</div>
                <div className="stat-value">{swarmState.global_best_score.toExponential(4)}</div>
              </div>

              <div className="stat-box">
                <div className="stat-label">Координаты лидера G_best (X, Y)</div>
                <div className="stat-value">
                  [{swarmState.global_best_position[0].toFixed(4)}, {swarmState.global_best_position[1].toFixed(4)}]
                </div>
              </div>

              <div className="stat-box">
                <div className="stat-label">Аналитический оптимум</div>
                <div className="stat-value">
                  [{swarmState.optimum[0]}, {swarmState.optimum[1]}] → f = 0.0
                </div>
              </div>

              <h2 style={{ marginTop: '18px' }}>График сходимости</h2>
              <svg width="100%" height="160" viewBox="0 0 300 160" style={{ background: '#090d16', borderRadius: '8px', padding: '8px' }}>
                {swarmState.history.length > 1 && (() => {
                  const scores = swarmState.history.map((h) => h.best_score);
                  const maxS = Math.max(...scores, 1e-6);
                  const minS = Math.min(...scores, 0);
                  const range = Math.max(maxS - minS, 1e-6);
                  const pts = swarmState.history.map((h, i) => {
                    const x = (i / (swarmState.history.length - 1)) * 280 + 10;
                    const y = 145 - ((h.best_score - minS) / range) * 130;
                    return `${x},${y}`;
                  }).join(' ');
                  return <polyline fill="none" stroke="#facc15" strokeWidth="2.5" points={pts} />;
                })()}
              </svg>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;