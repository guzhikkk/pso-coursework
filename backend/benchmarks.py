from __future__ import annotations

import ast
import math
from typing import Callable, Dict, List, Optional, Tuple

from models import FunctionMeta, HeatmapData

ObjectiveFn = Callable[[List[float]], float]

# Разрешённые математические функции и константы для безопасного AST-парсера
_SAFE_FUNCS: Dict[str, Callable[..., float]] = {
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "exp": math.exp,
    "log": math.log,
    "sqrt": math.sqrt,
    "abs": abs,
    "pow": pow,
    "floor": math.floor,
    "ceil": math.ceil,
}

_SAFE_CONSTS: Dict[str, float] = {
    "pi": math.pi,
    "e": math.e,
}

_MAX_FORMULA_LEN = 300
_OVERFLOW_PENALTY = 1e12


def sphere(x: List[float]) -> float:
    """Функция Сферы (унимодальная, выпуклая): f(0,...,0) = 0."""
    return sum(v * v for v in x)


def rosenbrock(x: List[float]) -> float:
    """Функция Розенброка («банановая» долина): f(1,...,1) = 0."""
    total = 0.0
    for i in range(len(x) - 1):
        a = x[i + 1] - x[i] * x[i]
        b = 1.0 - x[i]
        total += 100.0 * a * a + b * b
    return total


def rastrigin(x: List[float]) -> float:
    """Функция Растригина (многоэкстремальная, множество локальных ям): f(0,...,0) = 0."""
    n = len(x)
    return 10.0 * n + sum(v * v - 10.0 * math.cos(2.0 * math.pi * v) for v in x)


def ackley(x: List[float]) -> float:
    """Функция Экли (плоская внешняя зона и глубокая центральная воронка): f(0,...,0) = 0."""
    n = len(x)
    sum_sq = sum(v * v for v in x)
    sum_cos = sum(math.cos(2.0 * math.pi * v) for v in x)
    term1 = -20.0 * math.exp(-0.2 * math.sqrt(sum_sq / n))
    term2 = -math.exp(sum_cos / n)
    return term1 + term2 + 20.0 + math.e


def himmelblau(x: List[float]) -> float:
    """Функция Химмельблау (2D, четыре равных глобальных минимума f = 0)."""
    x0, x1 = x[0], x[1]
    return (x0 * x0 + x1 - 11.0) ** 2 + (x0 + x1 * x1 - 7.0) ** 2


BUILTIN_FUNCTIONS: Dict[str, Tuple[FunctionMeta, ObjectiveFn]] = {
    "sphere": (
        FunctionMeta(
            id="sphere",
            name="Функция Сферы",
            formula_display="f(x) = Σ x_i²",
            description="Гладкая унимодальная функция. Идеальна для проверки базовой скорости сходимости роя.",
            bounds=(-5.12, 5.12),
            default_dim=2,
            supports_nd=True,
            global_optimum_x=[0.0, 0.0],
            global_optimum_value=0.0,
            category="unimodal",
        ),
        sphere,
    ),
    "rosenbrock": (
        FunctionMeta(
            id="rosenbrock",
            name="Функция Розенброка",
            formula_display="f(x) = Σ [100·(x_{i+1} − x_i²)² + (1 − x_i)²]",
            description="Классическая овражная функция с узкой изогнутой долиной, ведущей к оптимуму (1, ..., 1).",
            bounds=(-2.5, 2.5),
            default_dim=2,
            supports_nd=True,
            global_optimum_x=[1.0, 1.0],
            global_optimum_value=0.0,
            category="valley",
        ),
        rosenbrock,
    ),
    "rastrigin": (
        FunctionMeta(
            id="rastrigin",
            name="Функция Растригина",
            formula_display="f(x) = 10·D + Σ [x_i² − 10·cos(2π·x_i)]",
            description="Сложная многоэкстремальная функция с регулярной сеткой локальных минимумов.",
            bounds=(-5.12, 5.12),
            default_dim=2,
            supports_nd=True,
            global_optimum_x=[0.0, 0.0],
            global_optimum_value=0.0,
            category="multimodal",
        ),
        rastrigin,
    ),
    "ackley": (
        FunctionMeta(
            id="ackley",
            name="Функция Экли",
            formula_display="f(x) = −20·exp(−0.2·√(Σx_i²/D)) − exp(Σcos(2πx_i)/D) + 20 + e",
            description="Многоэкстремальная поверхность с почти плоской периферией и резкой воронкой в центре.",
            bounds=(-5.0, 5.0),
            default_dim=2,
            supports_nd=True,
            global_optimum_x=[0.0, 0.0],
            global_optimum_value=0.0,
            category="multimodal",
        ),
        ackley,
    ),
    "himmelblau": (
        FunctionMeta(
            id="himmelblau",
            name="Функция Химмельблау",
            formula_display="f(x, y) = (x² + y − 11)² + (x + y² − 7)²",
            description="Двумерная функция с четырьмя равнозначными глобальными минимумами (наглядное разделение роя).",
            bounds=(-5.0, 5.0),
            default_dim=2,
            supports_nd=False,
            global_optimum_x=[3.0, 2.0],
            global_optimum_value=0.0,
            category="multimodal",
        ),
        himmelblau,
    ),
}


def list_builtin_functions() -> List[FunctionMeta]:
    """Возвращает список метаданных всех встроенных тестовых функций."""
    return [meta for meta, _ in BUILTIN_FUNCTIONS.values()]


class SafeFormulaEvaluator:
    """
    Безопасный AST-вычислитель пользовательских математических формул (без eval).
    Поддерживает переменные x, y, z (для 2D/3D) и x1..xD (1-индексация), а также
    операторы +, -, *, /, ** (или ^) и функции sin, cos, tan, exp, log, sqrt, abs, pow.
    """

    def __init__(self, formula: str, dim: int = 2) -> None:
        if not isinstance(formula, str) or not formula.strip():
            raise ValueError("Формула не может быть пустой.")
        cleaned = formula.strip().replace("^", "**")
        if len(cleaned) > _MAX_FORMULA_LEN:
            raise ValueError(f"Формула слишком длинная (максимум {_MAX_FORMULA_LEN} символов).")

        self.formula = cleaned
        self.dim = dim
        self._allowed_vars = self._build_var_index_map(dim)

        try:
            self._tree = ast.parse(cleaned, mode="eval")
        except SyntaxError as exc:
            raise ValueError(f"Синтаксическая ошибка в формуле: {exc.msg}.") from exc

        self._validate_node(self._tree)

        # Пробный запуск в точке (0.5, ..., 0.5), чтобы сразу выявить ошибки области определения
        sample_val = self.evaluate([0.5] * dim)
        if not math.isfinite(sample_val):
            raise ValueError("Формула возвращает некорректное значение (NaN или Inf).")

    @staticmethod
    def _build_var_index_map(dim: int) -> Dict[str, int]:
        mapping: Dict[str, int] = {"x": 0}
        if dim >= 2:
            mapping["y"] = 1
        if dim >= 3:
            mapping["z"] = 2
        for idx in range(1, dim + 1):
            mapping[f"x{idx}"] = idx - 1
        return mapping

    def _validate_node(self, node: ast.AST) -> None:
        if isinstance(node, ast.Expression):
            self._validate_node(node.body)
        elif isinstance(node, ast.Constant):
            if not isinstance(node.value, (int, float)) or isinstance(node.value, bool):
                raise ValueError("В формуле допустимы только числовые константы.")
        elif isinstance(node, ast.Name):
            if node.id not in self._allowed_vars and node.id not in _SAFE_CONSTS:
                allowed_hint = ", ".join(sorted(list(self._allowed_vars.keys())[:6]))
                raise ValueError(
                    f"Неизвестная переменная или константа '{node.id}'. "
                    f"Доступны: {allowed_hint}, pi, e."
                )
        elif isinstance(node, ast.UnaryOp):
            if not isinstance(node.op, (ast.UAdd, ast.USub)):
                raise ValueError("Неподдерживаемая унарная операция в формуле.")
            self._validate_node(node.operand)
        elif isinstance(node, ast.BinOp):
            if not isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow)):
                raise ValueError("Допустимы только операции +, -, *, /, ** (или ^).")
            self._validate_node(node.left)
            self._validate_node(node.right)
        elif isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in _SAFE_FUNCS:
                func_name = node.func.id if isinstance(node.func, ast.Name) else "вызов"
                raise ValueError(
                    f"Функция '{func_name}' запрещена или неизвестна. "
                    f"Допустимы: {', '.join(sorted(_SAFE_FUNCS.keys()))}."
                )
            if node.keywords:
                raise ValueError("Именованные аргументы в функциях не поддерживаются.")
            for arg in node.args:
                self._validate_node(arg)
        else:
            raise ValueError(f"Запрещённая синтаксическая конструкция: {type(node).__name__}.")

    def _eval_node(self, node: ast.AST, vec: List[float]) -> float:
        if isinstance(node, ast.Expression):
            return self._eval_node(node.body, vec)
        if isinstance(node, ast.Constant):
            return float(node.value)
        if isinstance(node, ast.Name):
            if node.id in _SAFE_CONSTS:
                return _SAFE_CONSTS[node.id]
            return float(vec[self._allowed_vars[node.id]])
        if isinstance(node, ast.UnaryOp):
            val = self._eval_node(node.operand, vec)
            return val if isinstance(node.op, ast.UAdd) else -val
        if isinstance(node, ast.BinOp):
            left = self._eval_node(node.left, vec)
            right = self._eval_node(node.right, vec)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                if abs(right) < 1e-12:
                    return _OVERFLOW_PENALTY
                return left / right
            if isinstance(node.op, ast.Pow):
                if abs(right) > 20.0:
                    return _OVERFLOW_PENALTY
                return float(left ** right)
        if isinstance(node, ast.Call):
            assert isinstance(node.func, ast.Name)
            fn = _SAFE_FUNCS[node.func.id]
            args = [self._eval_node(arg, vec) for arg in node.args]
            return float(fn(*args))
        raise ValueError("Недопустимый узел AST.")

    def evaluate(self, vec: List[float]) -> float:
        try:
            res = self._eval_node(self._tree, vec)
            if isinstance(res, complex) or not math.isfinite(res):
                return _OVERFLOW_PENALTY
            return float(res)
        except (ValueError, ZeroDivisionError, OverflowError, TypeError):
            return _OVERFLOW_PENALTY


def resolve_objective(
    function_id: str,
    dim: int,
    custom_formula: Optional[str] = None,
    custom_bounds: Tuple[float, float] = (-5.12, 5.12),
) -> Tuple[FunctionMeta, ObjectiveFn, List[Tuple[float, float]]]:
    """Возвращает (метаданные, callable f(x), список границ по каждой координате)."""
    fid = function_id.strip().lower()
    if fid == "custom":
        if not custom_formula:
            raise ValueError("Не передана пользовательская формула custom_formula.")
        evaluator = SafeFormulaEvaluator(custom_formula, dim=dim)
        meta = FunctionMeta(
            id="custom",
            name="Пользовательская функция",
            formula_display=f"f(x) = {evaluator.formula}",
            description="Задана пользователем через безопасный AST-парсер.",
            bounds=custom_bounds,
            default_dim=dim,
            supports_nd=True,
            global_optimum_x=None,
            global_optimum_value=None,
            category="custom",
        )
        bounds = [custom_bounds] * dim
        return meta, evaluator.evaluate, bounds

    if fid not in BUILTIN_FUNCTIONS:
        available = ", ".join(BUILTIN_FUNCTIONS.keys())
        raise ValueError(f"Неизвестная функция '{fid}'. Доступны: {available}, custom.")

    base_meta, fn = BUILTIN_FUNCTIONS[fid]
    if not base_meta.supports_nd and dim != 2:
        raise ValueError(f"Функция '{base_meta.name}' определена только для размерности D = 2.")

    opt_x: Optional[List[float]] = None
    if base_meta.global_optimum_x is not None:
        if fid == "rosenbrock":
            opt_x = [1.0] * dim
        elif fid in ("sphere", "rastrigin", "ackley"):
            opt_x = [0.0] * dim
        else:
            opt_x = list(base_meta.global_optimum_x)

    meta = FunctionMeta(
        id=base_meta.id,
        name=base_meta.name,
        formula_display=base_meta.formula_display,
        description=base_meta.description,
        bounds=base_meta.bounds,
        default_dim=dim,
        supports_nd=base_meta.supports_nd,
        global_optimum_x=opt_x,
        global_optimum_value=base_meta.global_optimum_value,
        category=base_meta.category,
    )
    bounds = [base_meta.bounds] * dim
    return meta, fn, bounds


def compute_heatmap_grid(
    fn: ObjectiveFn,
    bounds: List[Tuple[float, float]],
    axis_x: int = 0,
    axis_y: int = 1,
    resolution: int = 44,
    fixed_point: Optional[List[float]] = None,
    optimum_x: Optional[List[float]] = None,
) -> HeatmapData:
    """
    Вычисляет 2D-сетку значений целевой функции по выбранной паре осей (axis_x, axis_y).
    Для D > 2 остальные координаты фиксируются в точке fixed_point (по умолчанию 0).
    """
    dim = len(bounds)
    base_vec = list(fixed_point) if fixed_point is not None else [0.0] * dim
    x_min, x_max = bounds[axis_x]
    y_min, y_max = bounds[axis_y]

    values: List[List[float]] = []
    min_val = float("inf")
    max_val = float("-inf")

    denom = max(1, resolution - 1)
    for row_idx in range(resolution):
        y_val = y_min + (row_idx / denom) * (y_max - y_min)
        row_vals: List[float] = []
        for col_idx in range(resolution):
            x_val = x_min + (col_idx / denom) * (x_max - x_min)
            base_vec[axis_x] = x_val
            base_vec[axis_y] = y_val
            z = fn(base_vec)
            if not math.isfinite(z):
                z = _OVERFLOW_PENALTY
            z_rounded = round(z, 6)
            row_vals.append(z_rounded)
            if z_rounded < min_val:
                min_val = z_rounded
            if z_rounded > max_val:
                max_val = z_rounded
        values.append(row_vals)

    opt_point = (
        [optimum_x[axis_x], optimum_x[axis_y]]
        if optimum_x is not None and len(optimum_x) > max(axis_x, axis_y)
        else None
    )

    return HeatmapData(
        axis_x=axis_x,
        axis_y=axis_y,
        x_min=x_min,
        x_max=x_max,
        y_min=y_min,
        y_max=y_max,
        resolution=resolution,
        values=values,
        min_value=min_val,
        max_value=max_val,
        optimum_point=opt_point,
    )
