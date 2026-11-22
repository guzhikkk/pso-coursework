import type {
  ComparisonReport,
  FunctionsCatalogResponse,
  HealthResponse,
  OptimizeConfig,
  OptimizeResult,
  ScaleBenchmarkReport,
  ScaleBenchmarkRequest,
  ValidateFormulaRequest,
  ValidateFormulaResponse,
} from '../types/api';

const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ||
  'http://127.0.0.1:5000';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string; details?: string })
    | null;

  if (!response.ok) {
    const message =
      data?.error ||
      `Ошибка сервера (HTTP ${response.status})`;
    throw new Error(message);
  }

  if (data === null) {
    throw new Error('Сервер вернул пустой или некорректный JSON.');
  }

  return data;
}

export const apiClient = {
  baseUrl: API_BASE_URL,

  health(): Promise<HealthResponse> {
    return requestJson<HealthResponse>('/api/health', { method: 'GET' });
  },

  getFunctions(): Promise<FunctionsCatalogResponse> {
    return requestJson<FunctionsCatalogResponse>('/api/functions', { method: 'GET' });
  },

  validateFormula(payload: ValidateFormulaRequest): Promise<ValidateFormulaResponse> {
    return requestJson<ValidateFormulaResponse>('/api/validate-formula', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  optimize(config: OptimizeConfig): Promise<OptimizeResult> {
    return requestJson<OptimizeResult>('/api/optimize', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  },

  compare(config: OptimizeConfig, numRuns: number): Promise<ComparisonReport> {
    return requestJson<ComparisonReport>('/api/compare', {
      method: 'POST',
      body: JSON.stringify({ ...config, num_runs: numRuns }),
    });
  },

  scaleBenchmark(payload: ScaleBenchmarkRequest): Promise<ScaleBenchmarkReport> {
    return requestJson<ScaleBenchmarkReport>('/api/scale-benchmark', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};