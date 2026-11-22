export type PSOVariant = 'classic' | 'ldiw' | 'constriction';
export type TopologyType = 'gbest' | 'lbest';
export type BoundaryStrategy = 'reflect' | 'clamp' | 'absorb';
export type FunctionCategory = 'unimodal' | 'valley' | 'multimodal' | 'custom';
export type ThemeMode = 'dark' | 'light';
export type AppTab = 'simulator' | 'compare' | 'scale';

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
}

export interface FunctionMeta {
  id: string;
  name: string;
  formula_display: string;
  description: string;
  bounds: [number, number];
  default_dim: number;
  supports_nd: boolean;
  global_optimum_x: number[] | null;
  global_optimum_value: number | null;
  category: FunctionCategory;
}

export interface ComparisonPresetMeta {
  preset_id: string;
  label: string;
  variant: PSOVariant;
  topology: TopologyType;
}

export interface FunctionsCatalogResponse {
  functions: FunctionMeta[];
  options: {
    variants: PSOVariant[];
    topologies: TopologyType[];
    boundary_strategies: BoundaryStrategy[];
  };
  comparison_presets: ComparisonPresetMeta[];
}

export interface ValidateFormulaRequest {
  formula: string;
  dim?: number;
}

export interface ValidateFormulaResponse {
  valid: boolean;
  normalized_formula: string | null;
  sample_value: number | null;
  error: string | null;
}

export interface OptimizeConfig {
  function_id: string;
  custom_formula: string | null;
  custom_bounds: [number, number];
  dim: number;
  num_particles: number;
  max_iterations: number;
  variant: PSOVariant;
  topology: TopologyType;
  boundary_strategy: BoundaryStrategy;
  w: number;
  w_max: number;
  w_min: number;
  c1: number;
  c2: number;
  chi: number;
  max_vel_ratio: number;
  seed: number | null;
  axis_x: number;
  axis_y: number;
  heatmap_resolution: number;
}

export interface ParticleStateSnapshot {
  id: number;
  position: number[];
  velocity: number[];
  fitness: number;
  best_position: number[];
  best_fitness: number;
  speed: number;
}

export interface IterationRecord {
  iteration: number;
  global_best_position: number[];
  global_best_fitness: number;
  mean_fitness: number;
  diversity: number;
  mean_speed: number;
  inertia_w: number;
  nfe: number;
  particles: ParticleStateSnapshot[];
}

export interface HeatmapData {
  axis_x: number;
  axis_y: number;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
  resolution: number;
  values: number[][];
  min_value: number;
  max_value: number;
  optimum_point: [number, number] | null;
}

export interface OptimizeSummary {
  best_fitness: number;
  best_position: number[];
  error_to_optimum: number | null;
  convergence_iteration: number | null;
  total_nfe: number;
  elapsed_ms: number;
  peak_memory_kb: number;
}

export interface OptimizeResult {
  config: OptimizeConfig;
  function_meta: FunctionMeta;
  summary: OptimizeSummary;
  heatmap: HeatmapData | null;
  history: IterationRecord[];
}

export interface ComparisonRow {
  preset_id: string;
  label: string;
  variant: PSOVariant;
  topology: TopologyType;
  mean_best_fitness: number;
  median_best_fitness: number;
  std_best_fitness: number;
  min_best_fitness: number;
  success_rate_pct: number;
  mean_convergence_iter: number | null;
  mean_elapsed_ms: number;
}

export interface ComparisonCurvePoint {
  iteration: number;
  mean_best_fitness: number;
}

export interface ComparisonCurve {
  preset_id: string;
  label: string;
  points: ComparisonCurvePoint[];
}

export interface ComparisonReport {
  function_meta: FunctionMeta;
  dim: number;
  num_particles: number;
  max_iterations: number;
  num_runs: number;
  tolerance: number;
  winner_preset_id: string;
  winner_label: string;
  summary_table: ComparisonRow[];
  curves: ComparisonCurve[];
}

export interface ScaleBenchmarkRequest {
  function_id?: string;
  dimensions?: number[];
  particle_counts?: number[];
  max_iterations?: number;
  variant?: PSOVariant;
  topology?: TopologyType;
  seed?: number;
}

export interface ScalePoint {
  dim: number;
  num_particles: number;
  max_iterations: number;
  nfe: number;
  elapsed_ms: number;
  peak_memory_kb: number;
  time_per_eval_us: number;
  best_fitness: number;
}

export interface ScaleBenchmarkReport {
  function_id: string;
  variant: PSOVariant;
  topology: TopologyType;
  max_iterations: number;
  fixed_particles_for_dim_sweep: number;
  fixed_dim_for_particles_sweep: number;
  theoretical_time_complexity: string;
  theoretical_space_complexity: string;
  by_dimension: ScalePoint[];
  by_particles: ScalePoint[];
}