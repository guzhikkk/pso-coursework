from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Dict, Tuple

from flask import Flask, Response, jsonify, request
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from analytics import (
    DEFAULT_PSO_PRESETS,
    run_comparison_benchmark,
    run_optimize_experiment,
    run_scale_benchmark,
)
from benchmarks import SafeFormulaEvaluator, list_builtin_functions
from models import (
    BoundaryStrategy,
    OptimizeConfig,
    PSOVariant,
    TopologyType,
)


def _parse_json_body() -> Dict[str, Any]:
    if not request.data:
        return {}
    payload = request.get_json(silent=True)
    if payload is None:
        raise ValueError("Некорректный JSON в теле запроса.")
    if not isinstance(payload, dict):
        raise ValueError("Тело запроса должно быть JSON-объектом.")
    return payload


def create_app() -> Flask:
    """Фабрика приложения Flask для PSO Visualizer v2."""
    flask_app = Flask(__name__)
    CORS(flask_app)

    @flask_app.route("/", methods=["GET"])
    @flask_app.route("/api/health", methods=["GET"])
    def health() -> Tuple[Response, int]:
        return (
            jsonify(
                {
                    "status": "ok",
                    "service": "pso-coursework-backend",
                    "version": "2.0.0",
                }
            ),
            200,
        )

    @flask_app.route("/api/functions", methods=["GET"])
    def get_functions() -> Tuple[Response, int]:
        return (
            jsonify(
                {
                    "functions": [meta.to_dict() for meta in list_builtin_functions()],
                    "options": {
                        "variants": [v.value for v in PSOVariant],
                        "topologies": [t.value for t in TopologyType],
                        "boundary_strategies": [b.value for b in BoundaryStrategy],
                    },
                    "comparison_presets": [
                        {
                            "preset_id": p.preset_id,
                            "label": p.label,
                            "variant": p.variant.value,
                            "topology": p.topology.value,
                        }
                        for p in DEFAULT_PSO_PRESETS
                    ],
                }
            ),
            200,
        )

    @flask_app.route("/api/validate-formula", methods=["POST"])
    def validate_formula() -> Tuple[Response, int]:
        try:
            payload = _parse_json_body()
            formula = payload.get("formula", "")
            dim = int(payload.get("dim", 2))
            if not (2 <= dim <= 100):
                raise ValueError("Размерность dim должна лежать в [2, 100].")
            evaluator = SafeFormulaEvaluator(formula, dim=dim)
            sample = evaluator.evaluate([0.5] * dim)
            return (
                jsonify(
                    {
                        "valid": True,
                        "normalized_formula": evaluator.formula,
                        "sample_value": round(sample, 6),
                        "error": None,
                    }
                ),
                200,
            )
        except (ValueError, TypeError) as exc:
            return (
                jsonify(
                    {
                        "valid": False,
                        "normalized_formula": None,
                        "sample_value": None,
                        "error": str(exc),
                    }
                ),
                200,
            )

    @flask_app.route("/api/optimize", methods=["POST"])
    def optimize() -> Tuple[Response, int]:
        try:
            payload = _parse_json_body()
            config = OptimizeConfig.from_dict(payload)
            result = run_optimize_experiment(config)
            return jsonify(result.to_dict()), 200
        except (ValueError, TypeError) as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception as exc:
            return jsonify({"error": "Внутренняя ошибка сервера", "details": str(exc)}), 500

    @flask_app.route("/api/compare", methods=["POST"])
    def compare() -> Tuple[Response, int]:
        try:
            payload = _parse_json_body()
            raw_runs = payload.get("num_runs", 10)
            if isinstance(raw_runs, bool):
                raise ValueError("num_runs должно быть целым числом.")
            num_runs = int(raw_runs)
            config = OptimizeConfig.from_dict(payload)
            report = run_comparison_benchmark(config, num_runs=num_runs)
            return jsonify(report), 200
        except (ValueError, TypeError) as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception as exc:
            return jsonify({"error": "Внутренняя ошибка сервера", "details": str(exc)}), 500

    @flask_app.route("/api/scale-benchmark", methods=["POST"])
    def scale_benchmark() -> Tuple[Response, int]:
        try:
            payload = _parse_json_body()
            raw_iters = payload.get("max_iterations")
            raw_seed = payload.get("seed")
            report = run_scale_benchmark(
                function_id=str(payload.get("function_id") or "rastrigin"),
                dimensions=payload.get("dimensions"),
                particle_counts=payload.get("particle_counts"),
                max_iterations=int(raw_iters) if raw_iters is not None else 40,
                variant=str(payload.get("variant") or "ldiw"),
                topology=str(payload.get("topology") or "gbest"),
                seed=int(raw_seed) if raw_seed is not None else 42,
            )
            return jsonify(report), 200
        except (ValueError, TypeError) as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception as exc:
            return jsonify({"error": "Внутренняя ошибка сервера", "details": str(exc)}), 500

    return flask_app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
