from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from analytics import run_comparison_benchmark, run_optimize_experiment, run_scale_benchmark
from app import create_app
from benchmarks import (
    BUILTIN_FUNCTIONS,
    SafeFormulaEvaluator,
    ackley,
    himmelblau,
    rastrigin,
    resolve_objective,
    rosenbrock,
    sphere,
)
from models import BoundaryStrategy, OptimizeConfig, PSOVariant, TopologyType
from optimizers import HistoryCollectorObserver, create_pso_optimizer


def test_config_validation() -> None:
    """Тест 1: Валидация параметров OptimizeConfig."""
    cfg = OptimizeConfig(function_id="rastrigin", dim=4, num_particles=20, max_iterations=50)
    assert cfg.variant == PSOVariant.LDIW
    assert cfg.topology == TopologyType.GBEST

    with pytest.raises(ValueError):
        OptimizeConfig(dim=1)
    with pytest.raises(ValueError):
        OptimizeConfig(num_particles=1)
    with pytest.raises(ValueError):
        OptimizeConfig(w_min=0.9, w_max=0.4)
    with pytest.raises(ValueError):
        OptimizeConfig(axis_x=1, axis_y=1)
    with pytest.raises(ValueError):
        OptimizeConfig(function_id="custom", custom_formula="")


def test_builtin_functions_at_optima() -> None:
    """Тест 2: Все 5 эталонных функций равны 0 в известных глобальных минимумах."""
    assert math.isclose(sphere([0.0, 0.0, 0.0]), 0.0, abs_tol=1e-9)
    assert math.isclose(rosenbrock([1.0, 1.0, 1.0]), 0.0, abs_tol=1e-9)
    assert math.isclose(rastrigin([0.0, 0.0, 0.0]), 0.0, abs_tol=1e-9)
    assert math.isclose(ackley([0.0, 0.0, 0.0]), 0.0, abs_tol=1e-9)
    assert math.isclose(himmelblau([3.0, 2.0]), 0.0, abs_tol=1e-9)
    assert len(BUILTIN_FUNCTIONS) == 5


def test_safe_formula_valid_expressions() -> None:
    """Тест 3: Безопасный AST-парсер корректно вычисляет 2D и многомерные формулы."""
    ev_2d = SafeFormulaEvaluator("(x - 2)^2 + (y + 1)^2", dim=2)
    assert math.isclose(ev_2d.evaluate([2.0, -1.0]), 0.0, abs_tol=1e-9)
    assert math.isclose(ev_2d.evaluate([3.0, 1.0]), 5.0, abs_tol=1e-9)

    ev_nd = SafeFormulaEvaluator("x1**2 + x2**2 + sin(pi * x3)", dim=3)
    assert math.isclose(ev_nd.evaluate([1.0, 2.0, 0.5]), 6.0, abs_tol=1e-9)


def test_safe_formula_blocks_unsafe_code() -> None:
    """Тест 4: AST-парсер блокирует попытки инъекции кода и опасные вызовы."""
    for malicious in (
        "__import__('os').system('echo pwn')",
        "open('app.py').read()",
        "(lambda t: t)(x)",
        "x.__class__",
        "unknown_var + 1",
    ):
        with pytest.raises(ValueError):
            SafeFormulaEvaluator(malicious, dim=2)


def test_classic_pso_converges_on_sphere() -> None:
    """Тест 5: Классический PSO уверенно сходится к минимуму на функции Сферы."""
    cfg = OptimizeConfig(
        function_id="sphere",
        dim=2,
        num_particles=25,
        max_iterations=60,
        variant=PSOVariant.CLASSIC,
        seed=42,
        heatmap_resolution=0,
    )
    res = run_optimize_experiment(cfg, measure_memory=False)
    assert res.summary.best_fitness < 1e-4
    assert res.summary.convergence_iteration is not None


def test_ldiw_inertia_linear_decay() -> None:
    """Тест 6: LDIW-PSO линейно снижает инерцию от w_max до w_min."""
    cfg = OptimizeConfig(
        function_id="sphere",
        variant=PSOVariant.LDIW,
        w_max=0.9,
        w_min=0.4,
        max_iterations=20,
        num_particles=12,
        heatmap_resolution=0,
    )
    res = run_optimize_experiment(cfg, measure_memory=False)
    assert math.isclose(res.history[0].inertia_w, 0.9, abs_tol=1e-4)
    assert math.isclose(res.history[-1].inertia_w, 0.4, abs_tol=1e-4)
    assert res.history[10].inertia_w < res.history[0].inertia_w


def test_constriction_pso_on_rosenbrock() -> None:
    """Тест 7: PSO со сжатием Клерка — Кеннеди сходится на овражной функции Розенброка."""
    cfg = OptimizeConfig(
        function_id="rosenbrock",
        dim=2,
        num_particles=30,
        max_iterations=100,
        variant=PSOVariant.CONSTRICTION,
        seed=7,
        heatmap_resolution=0,
    )
    res = run_optimize_experiment(cfg, measure_memory=False)
    assert res.summary.best_fitness < 0.05


def test_ring_lbest_topology_and_observer() -> None:
    """Тест 8: Кольцевая топология lbest и паттерн Observer корректно работают на Растригине."""
    cfg = OptimizeConfig(
        function_id="rastrigin",
        dim=2,
        num_particles=30,
        max_iterations=80,
        variant=PSOVariant.LDIW,
        topology=TopologyType.LBEST,
        seed=42,
        heatmap_resolution=0,
    )
    _, fn, bounds = resolve_objective(cfg.function_id, cfg.dim)
    obs = HistoryCollectorObserver()
    opt = create_pso_optimizer(cfg, bounds, fn, observers=[obs])
    hist = opt.run()
    assert len(obs.records) == len(hist) == cfg.max_iterations + 1
    assert opt.global_best_fitness < 1.0


def test_monotonic_global_best_invariant() -> None:
    """Тест 9: Инвариант минимизации — глобальный рекорд f(G_best) монотонно не возрастает."""
    for variant in PSOVariant:
        cfg = OptimizeConfig(
            function_id="ackley",
            dim=3,
            num_particles=15,
            max_iterations=25,
            variant=variant,
            seed=11,
            heatmap_resolution=0,
        )
        res = run_optimize_experiment(cfg, measure_memory=False)
        for i in range(1, len(res.history)):
            assert res.history[i].global_best_fitness <= res.history[i - 1].global_best_fitness + 1e-9


def test_boundary_strategies_keep_particles_inside() -> None:
    """Тест 10: Все стратегии границ (reflect, clamp, absorb) удерживают частицы в [low, high]."""
    for b_strat in BoundaryStrategy:
        cfg = OptimizeConfig(
            function_id="rastrigin",
            dim=2,
            num_particles=15,
            max_iterations=20,
            variant=PSOVariant.CLASSIC,
            w=1.6,
            boundary_strategy=b_strat,
            seed=5,
            heatmap_resolution=0,
        )
        res = run_optimize_experiment(cfg, measure_memory=False)
        lo, hi = res.function_meta.bounds
        for rec in res.history:
            for snap in rec.particles:
                for coord in snap.position:
                    assert lo <= coord <= hi


def test_multidimensional_and_heatmap_generation() -> None:
    """Тест 11: Многомерный запуск (D = 10) с 2D-тепловой картой проекции (x_2, x_5)."""
    cfg = OptimizeConfig(
        function_id="sphere",
        dim=10,
        num_particles=20,
        max_iterations=30,
        axis_x=2,
        axis_y=5,
        heatmap_resolution=16,
        seed=42,
    )
    res = run_optimize_experiment(cfg, measure_memory=False)
    assert res.heatmap is not None
    assert res.heatmap.resolution == 16
    assert len(res.heatmap.values) == 16
    assert len(res.heatmap.values[0]) == 16
    assert res.heatmap.axis_x == 2 and res.heatmap.axis_y == 5


def test_comparison_benchmark_four_presets() -> None:
    """Тест 12: Серия сравнения 4 модификаций PSO возвращает сводную таблицу и лидера."""
    cfg = OptimizeConfig(
        function_id="sphere",
        dim=2,
        num_particles=15,
        max_iterations=25,
        seed=42,
    )
    report = run_comparison_benchmark(cfg, num_runs=4)
    assert len(report["summary_table"]) == 4
    assert len(report["curves"]) == 4
    assert report["winner_preset_id"] in {r["preset_id"] for r in report["summary_table"]}


def test_scale_benchmark_performance() -> None:
    """Тест 13: Бенчмарк масштабирования измеряет время и NFE при росте D и N."""
    report = run_scale_benchmark(
        function_id="rastrigin",
        dimensions=[2, 10, 30],
        particle_counts=[10, 30, 60],
        max_iterations=15,
    )
    assert len(report["by_dimension"]) == 3
    assert len(report["by_particles"]) == 3
    assert report["by_particles"][-1]["nfe"] > report["by_particles"][0]["nfe"]
    assert report["theoretical_time_complexity"] == "O(I * N * D)"


def test_flask_api_all_endpoints() -> None:
    """Тест 14: Интеграционная проверка всех 6 эндпоинтов Flask REST API."""
    client = create_app().test_client()

    r_health = client.get("/api/health")
    assert r_health.status_code == 200
    assert r_health.get_json()["status"] == "ok"

    r_funcs = client.get("/api/functions")
    assert r_funcs.status_code == 200
    assert len(r_funcs.get_json()["functions"]) == 5

    r_val_ok = client.post("/api/validate-formula", json={"formula": "x^2 + y^2", "dim": 2})
    assert r_val_ok.status_code == 200
    assert r_val_ok.get_json()["valid"] is True

    r_val_bad = client.post("/api/validate-formula", json={"formula": "__import__('os')", "dim": 2})
    assert r_val_bad.status_code == 200
    assert r_val_bad.get_json()["valid"] is False

    r_opt = client.post(
        "/api/optimize",
        json={
            "function_id": "custom",
            "custom_formula": "(x - 1)^2 + (y + 2)^2",
            "custom_bounds": [-5, 5],
            "dim": 2,
            "num_particles": 15,
            "max_iterations": 20,
            "heatmap_resolution": 16,
        },
    )
    assert r_opt.status_code == 200
    opt_data = r_opt.get_json()
    assert opt_data["summary"]["best_fitness"] < 0.2
    assert len(opt_data["history"]) == 21

    r_opt_bad = client.post("/api/optimize", json={"dim": 1})
    assert r_opt_bad.status_code == 400

    r_cmp = client.post(
        "/api/compare",
        json={"function_id": "sphere", "dim": 2, "num_particles": 10, "max_iterations": 15, "num_runs": 3},
    )
    assert r_cmp.status_code == 200
    assert len(r_cmp.get_json()["summary_table"]) == 4

    r_scale = client.post(
        "/api/scale-benchmark",
        json={"function_id": "rastrigin", "dimensions": [2, 10], "particle_counts": [10, 20], "max_iterations": 10},
    )
    assert r_scale.status_code == 200
    assert len(r_scale.get_json()["by_dimension"]) == 2
