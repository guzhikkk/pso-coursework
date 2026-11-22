from __future__ import annotations

from dataclasses import dataclass, replace
import statistics
import time
import tracemalloc
from typing import Any, Dict, List, Optional

from benchmarks import compute_heatmap_grid, resolve_objective
from models import (
    OptimizeConfig,
    OptimizeResult,
    OptimizeSummary,
    PSOVariant,
    TopologyType,
)
from optimizers import create_pso_optimizer

CONVERGENCE_TOLERANCE = 1e-2


@dataclass(frozen=True)
class PSOPreset:
    """Эталонная конфигурация PSO для вкладки «Сравнение модификаций»."""

    preset_id: str
    label: str
    variant: PSOVariant
    topology: TopologyType


DEFAULT_PSO_PRESETS: List[PSOPreset] = [
    PSOPreset(
        preset_id="classic_gbest",
        label="Классический PSO (gbest)",
        variant=PSOVariant.CLASSIC,
        topology=TopologyType.GBEST,
    ),
    PSOPreset(
        preset_id="ldiw_gbest",
        label="Убывающая инерция LDIW (gbest)",
        variant=PSOVariant.LDIW,
        topology=TopologyType.GBEST,
    ),
    PSOPreset(
        preset_id="constriction_gbest",
        label="Сжатие Клерка — Кеннеди χ (gbest)",
        variant=PSOVariant.CONSTRICTION,
        topology=TopologyType.GBEST,
    ),
    PSOPreset(
        preset_id="ldiw_lbest",
        label="Кольцевая топология LDIW (lbest)",
        variant=PSOVariant.LDIW,
        topology=TopologyType.LBEST,
    ),
]


def _safe_std(values: List[float]) -> float:
    if len(values) <= 1:
        return 0.0
    return round(statistics.stdev(values), 6)


def run_optimize_experiment(
    config: OptimizeConfig,
    measure_memory: bool = True,
) -> OptimizeResult:
    """Выполняет одиночный запуск PSO с полным логированием и расчётом 2D-тепловой карты."""
    meta, objective_fn, bounds = resolve_objective(
        function_id=config.function_id,
        dim=config.dim,
        custom_formula=config.custom_formula,
        custom_bounds=config.custom_bounds,
    )

    optimizer = create_pso_optimizer(
        config=config,
        bounds=bounds,
        objective_fn=objective_fn,
        seed=config.seed,
        record_particles=True,
    )

    peak_kb = 0.0
    should_trace = measure_memory and not tracemalloc.is_tracing()
    if should_trace:
        tracemalloc.start()

    started = time.perf_counter()
    try:
        history = optimizer.run()
        elapsed_ms = round((time.perf_counter() - started) * 1000.0, 3)
        if should_trace:
            _, peak_bytes = tracemalloc.get_traced_memory()
            peak_kb = round(peak_bytes / 1024.0, 2)
    finally:
        if should_trace:
            tracemalloc.stop()

    best_fit = round(optimizer.global_best_fitness, 6)
    best_pos = [round(v, 5) for v in optimizer.global_best_position]

    err_opt: Optional[float] = None
    conv_iter: Optional[int] = None
    if meta.global_optimum_value is not None:
        err_opt = round(abs(best_fit - meta.global_optimum_value), 6)
        for rec in history:
            if abs(rec.global_best_fitness - meta.global_optimum_value) <= CONVERGENCE_TOLERANCE:
                conv_iter = rec.iteration
                break

    heatmap = None
    if config.heatmap_resolution > 0:
        heatmap = compute_heatmap_grid(
            fn=objective_fn,
            bounds=bounds,
            axis_x=config.axis_x,
            axis_y=config.axis_y,
            resolution=config.heatmap_resolution,
            fixed_point=optimizer.global_best_position,
            optimum_x=meta.global_optimum_x,
        )

    summary = OptimizeSummary(
        best_fitness=best_fit,
        best_position=best_pos,
        error_to_optimum=err_opt,
        convergence_iteration=conv_iter,
        total_nfe=optimizer.nfe,
        elapsed_ms=elapsed_ms,
        peak_memory_kb=peak_kb,
    )

    return OptimizeResult(
        config=config,
        function_meta=meta,
        summary=summary,
        heatmap=heatmap,
        history=history,
    )


def run_comparison_benchmark(
    base_config: OptimizeConfig,
    num_runs: int = 10,
) -> Dict[str, Any]:
    """
    Серия из M независимых прогонов для сравнения 4 модификаций и топологий PSO
    на одной целевой функции и одинаковом бюджете вычислений.
    """
    if not (1 <= num_runs <= 30):
        raise ValueError("num_runs должно лежать в диапазоне [1, 30].")

    meta, objective_fn, bounds = resolve_objective(
        function_id=base_config.function_id,
        dim=base_config.dim,
        custom_formula=base_config.custom_formula,
        custom_bounds=base_config.custom_bounds,
    )

    base_seed = base_config.seed if base_config.seed is not None else 42
    results_rows: List[Dict[str, Any]] = []
    curves_by_preset: List[Dict[str, Any]] = []

    for preset in DEFAULT_PSO_PRESETS:
        preset_cfg = replace(
            base_config,
            variant=preset.variant,
            topology=preset.topology,
            heatmap_resolution=0,
        )

        final_fits: List[float] = []
        elapsed_list: List[float] = []
        conv_iters: List[int] = []
        all_curves: List[List[float]] = []

        for r in range(num_runs):
            opt = create_pso_optimizer(
                config=preset_cfg,
                bounds=bounds,
                objective_fn=objective_fn,
                seed=base_seed + r,
                record_particles=False,
            )
            t0 = time.perf_counter()
            hist = opt.run()
            elapsed_list.append((time.perf_counter() - t0) * 1000.0)

            final_fits.append(opt.global_best_fitness)
            all_curves.append([rec.global_best_fitness for rec in hist])

            if meta.global_optimum_value is not None:
                for rec in hist:
                    if abs(rec.global_best_fitness - meta.global_optimum_value) <= CONVERGENCE_TOLERANCE:
                        conv_iters.append(rec.iteration)
                        break

        num_steps = len(all_curves[0]) if all_curves else 0
        mean_curve = [
            {
                "iteration": step_i,
                "mean_best_fitness": round(
                    sum(curve[step_i] for curve in all_curves) / num_runs, 6
                ),
            }
            for step_i in range(num_steps)
        ]

        success_rate = round((len(conv_iters) / num_runs) * 100.0, 1)
        mean_conv = round(statistics.mean(conv_iters), 2) if conv_iters else None

        results_rows.append(
            {
                "preset_id": preset.preset_id,
                "label": preset.label,
                "variant": preset.variant.value,
                "topology": preset.topology.value,
                "mean_best_fitness": round(statistics.mean(final_fits), 6),
                "median_best_fitness": round(statistics.median(final_fits), 6),
                "std_best_fitness": _safe_std(final_fits),
                "min_best_fitness": round(min(final_fits), 6),
                "success_rate_pct": success_rate,
                "mean_convergence_iter": mean_conv,
                "mean_elapsed_ms": round(statistics.mean(elapsed_list), 2),
            }
        )
        curves_by_preset.append(
            {
                "preset_id": preset.preset_id,
                "label": preset.label,
                "points": mean_curve,
            }
        )

    winner = min(results_rows, key=lambda row: row["mean_best_fitness"])

    return {
        "function_meta": meta.to_dict(),
        "dim": base_config.dim,
        "num_particles": base_config.num_particles,
        "max_iterations": base_config.max_iterations,
        "num_runs": num_runs,
        "tolerance": CONVERGENCE_TOLERANCE,
        "winner_preset_id": winner["preset_id"],
        "winner_label": winner["label"],
        "summary_table": results_rows,
        "curves": curves_by_preset,
    }


def run_scale_benchmark(
    function_id: str = "rastrigin",
    dimensions: Optional[List[int]] = None,
    particle_counts: Optional[List[int]] = None,
    max_iterations: int = 40,
    variant: str = "ldiw",
    topology: str = "gbest",
    seed: int = 42,
) -> Dict[str, Any]:
    """
    Экспериментальная оценка производительности на больших данных:
    замер времени (мс) и пиковой памяти (КБ) при росте размерности D и числа частиц N
    для подтверждения асимптотики O(I * N * D) и Theta(N * D).
    """
    fid = function_id.strip().lower()
    if fid in ("himmelblau", "custom"):
        fid = "rastrigin"

    dims = dimensions if dimensions is not None else [2, 10, 30, 50, 100]
    counts = particle_counts if particle_counts is not None else [20, 50, 100, 200, 300]

    dims = [max(2, min(100, int(d))) for d in dims][:8]
    counts = [max(5, min(300, int(n))) for n in counts][:8]
    iters = max(5, min(100, int(max_iterations)))

    fixed_n_for_dim = 40
    fixed_d_for_n = 10

    def _measure_point(dim: int, n_particles: int) -> Dict[str, Any]:
        cfg = OptimizeConfig(
            function_id=fid,
            dim=dim,
            num_particles=n_particles,
            max_iterations=iters,
            variant=PSOVariant(variant.lower()),
            topology=TopologyType(topology.lower()),
            seed=seed,
            heatmap_resolution=0,
        )
        _, fn, bounds = resolve_objective(fid, dim=dim)
        opt = create_pso_optimizer(
            config=cfg,
            bounds=bounds,
            objective_fn=fn,
            seed=seed,
            record_particles=False,
        )

        should_trace = not tracemalloc.is_tracing()
        if should_trace:
            tracemalloc.start()
        t0 = time.perf_counter()
        try:
            opt.run()
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            peak_kb = (
                tracemalloc.get_traced_memory()[1] / 1024.0 if should_trace else 0.0
            )
        finally:
            if should_trace:
                tracemalloc.stop()

        time_per_eval_us = (elapsed_ms * 1000.0) / max(1, opt.nfe)
        return {
            "dim": dim,
            "num_particles": n_particles,
            "max_iterations": iters,
            "nfe": opt.nfe,
            "elapsed_ms": round(elapsed_ms, 3),
            "peak_memory_kb": round(peak_kb, 2),
            "time_per_eval_us": round(time_per_eval_us, 3),
            "best_fitness": round(opt.global_best_fitness, 6),
        }

    by_dimension = [_measure_point(d, fixed_n_for_dim) for d in dims]
    by_particles = [_measure_point(fixed_d_for_n, n) for n in counts]

    return {
        "function_id": fid,
        "variant": variant.lower(),
        "topology": topology.lower(),
        "max_iterations": iters,
        "fixed_particles_for_dim_sweep": fixed_n_for_dim,
        "fixed_dim_for_particles_sweep": fixed_d_for_n,
        "theoretical_time_complexity": "O(I * N * D)",
        "theoretical_space_complexity": "Theta(N * D)",
        "by_dimension": by_dimension,
        "by_particles": by_particles,
    }
