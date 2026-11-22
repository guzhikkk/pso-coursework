from __future__ import annotations

from dataclasses import dataclass, field, fields, is_dataclass
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


class PSOVariant(str, Enum):
    """Модификации алгоритма метода роя частиц (паттерн Strategy)."""

    CLASSIC = "classic"              # Классический PSO с фиксированной инерцией w
    LDIW = "ldiw"                    # Линейно убывающая инерция (w_max -> w_min)
    CONSTRICTION = "constriction"    # Коэффициент сжатия Клерка — Кеннеди (chi)


class TopologyType(str, Enum):
    """Топология соседства роя частиц."""

    GBEST = "gbest"  # Глобальная топология (полносвязный граф)
    LBEST = "lbest"  # Локальная кольцевая топология (соседи i-1, i, i+1)


class BoundaryStrategy(str, Enum):
    """Стратегия обработки выхода частицы за границы области поиска."""

    REFLECT = "reflect"  # Упругое отражение с гашением скорости (* -0.5)
    CLAMP = "clamp"      # Ограничение координат и обнуление скорости
    ABSORB = "absorb"    # Остановка на границе с мягким затуханием (* 0.25)


def to_serializable(obj: Any) -> Any:
    """Рекурсивно преобразует dataclass, Enum и коллекции в чистый JSON-совместимый формат."""
    if isinstance(obj, Enum):
        return obj.value
    if is_dataclass(obj):
        return {f.name: to_serializable(getattr(obj, f.name)) for f in fields(obj)}
    if isinstance(obj, dict):
        return {str(k): to_serializable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_serializable(item) for item in obj]
    return obj


@dataclass(frozen=True)
class FunctionMeta:
    """Метаданные тестовой целевой функции оптимизации."""

    id: str
    name: str
    formula_display: str
    description: str
    bounds: Tuple[float, float]
    default_dim: int
    supports_nd: bool
    global_optimum_x: Optional[List[float]]
    global_optimum_value: Optional[float]

    category: str  # unimodal | valley | multimodal | custom
    def to_dict(self) -> Dict[str, Any]:
        return to_serializable(self)


@dataclass
class OptimizeConfig:
    """Конфигурация запуска алгоритма PSO."""

    function_id: str = "rastrigin"
    custom_formula: Optional[str] = None
    custom_bounds: Tuple[float, float] = (-5.12, 5.12)
    dim: int = 2
    num_particles: int = 25
    max_iterations: int = 60

    variant: PSOVariant = PSOVariant.LDIW
    topology: TopologyType = TopologyType.GBEST
    boundary_strategy: BoundaryStrategy = BoundaryStrategy.REFLECT

    # Параметры обучения и инерции
    w: float = 0.72
    w_max: float = 0.90
    w_min: float = 0.40
    c1: float = 1.49
    c2: float = 1.49
    chi: float = 0.7298
    max_vel_ratio: float = 0.20

    # Воспроизводимость и параметры 2D-среза тепловой карты
    seed: Optional[int] = 42
    axis_x: int = 0
    axis_y: int = 1
    heatmap_resolution: int = 44

    def __post_init__(self) -> None:
        if isinstance(self.variant, str):
            self.variant = PSOVariant(self.variant.lower())
        if isinstance(self.topology, str):
            self.topology = TopologyType(self.topology.lower())
        if isinstance(self.boundary_strategy, str):
            self.boundary_strategy = BoundaryStrategy(self.boundary_strategy.lower())
        if isinstance(self.custom_bounds, list):
            if len(self.custom_bounds) != 2:
                raise ValueError("custom_bounds должен содержать ровно два числа [min, max].")
            self.custom_bounds = (float(self.custom_bounds[0]), float(self.custom_bounds[1]))

        if self.seed == "":
            self.seed = None
        elif self.seed is not None:
            self.seed = int(self.seed)

        self.function_id = str(self.function_id).strip().lower()
        if not self.function_id:
            raise ValueError("function_id не может быть пустым.")
        if self.function_id == "custom":
            if not self.custom_formula or not str(self.custom_formula).strip():
                raise ValueError("Для function_id='custom' необходимо передать custom_formula.")
            self.custom_formula = str(self.custom_formula).strip()

        if self.custom_bounds[0] >= self.custom_bounds[1]:
            raise ValueError("Левая граница области поиска должна быть строго меньше правой.")
        if not (2 <= int(self.dim) <= 100):
            raise ValueError("Размерность dim должна лежать в диапазоне [2, 100].")
        self.dim = int(self.dim)

        if not (2 <= int(self.num_particles) <= 300):
            raise ValueError("Число частиц num_particles должно лежать в диапазоне [2, 300].")
        self.num_particles = int(self.num_particles)

        if not (1 <= int(self.max_iterations) <= 500):
            raise ValueError("Число итераций max_iterations должно лежать в диапазоне [1, 500].")
        self.max_iterations = int(self.max_iterations)

        if not (0.0 <= float(self.w) <= 2.0):
            raise ValueError("Коэффициент инерции w должен лежать в [0.0, 2.0].")
        if not (0.0 <= float(self.w_min) <= float(self.w_max) <= 2.0):
            raise ValueError("Должно выполняться 0.0 <= w_min <= w_max <= 2.0.")
        if not (0.0 <= float(self.c1) <= 4.0) or not (0.0 <= float(self.c2) <= 4.0):
            raise ValueError("Коэффициенты c1 и c2 должны лежать в [0.0, 4.0].")
        if not (0.1 <= float(self.chi) <= 1.0):
            raise ValueError("Коэффициент сжатия chi должен лежать в [0.1, 1.0].")
        if not (0.01 <= float(self.max_vel_ratio) <= 1.0):
            raise ValueError("max_vel_ratio должен лежать в [0.01, 1.0].")

        self.axis_x = int(self.axis_x)
        self.axis_y = int(self.axis_y)
        if not (0 <= self.axis_x < self.dim) or not (0 <= self.axis_y < self.dim):
            raise ValueError("Индексы осей axis_x и axis_y должны лежать в [0, dim - 1].")
        if self.axis_x == self.axis_y:
            raise ValueError("Оси проекции axis_x и axis_y должны различаться.")

        self.heatmap_resolution = int(self.heatmap_resolution)
        if self.heatmap_resolution != 0 and not (12 <= self.heatmap_resolution <= 80):
            raise ValueError("heatmap_resolution должен быть 0 (выкл) или в диапазоне [12, 80].")

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> OptimizeConfig:
        valid_keys = {f.name for f in fields(cls)}
        filtered: Dict[str, Any] = {}
        for k, v in data.items():
            if k not in valid_keys:
                continue
            if v is not None or k in ("seed", "custom_formula"):
                filtered[k] = v
        return cls(**filtered)

    def to_dict(self) -> Dict[str, Any]:
        return to_serializable(self)


@dataclass
class ParticleStateSnapshot:
    """Снимок состояния одной частицы на конкретной итерации (для Canvas и Инспектора)."""

    id: int
    position: List[float]
    velocity: List[float]
    fitness: float
    best_position: List[float]
    best_fitness: float
    speed: float

    def to_dict(self) -> Dict[str, Any]:
        return to_serializable(self)


@dataclass
class IterationRecord:
    """Запись состояния роя на одной итерации оптимизации."""

    iteration: int
    global_best_position: List[float]
    global_best_fitness: float
    mean_fitness: float
    diversity: float
    mean_speed: float
    inertia_w: float
    nfe: int
    particles: List[ParticleStateSnapshot] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return to_serializable(self)


@dataclass
class HeatmapData:
    """2D-сетка значений целевой функции для отрисовки тепловой карты на Canvas."""

    axis_x: int
    axis_y: int
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    resolution: int
    values: List[List[float]]
    min_value: float
    max_value: float
    optimum_point: Optional[List[float]] = None

    def to_dict(self) -> Dict[str, Any]:
        return to_serializable(self)


@dataclass
class OptimizeSummary:
    """Итоговые показатели одного запуска оптимизатора."""

    best_fitness: float
    best_position: List[float]
    error_to_optimum: Optional[float]
    convergence_iteration: Optional[int]
    total_nfe: int
    elapsed_ms: float
    peak_memory_kb: float

    def to_dict(self) -> Dict[str, Any]:
        return to_serializable(self)


@dataclass
class OptimizeResult:
    """Полный ответ эндпоинта POST /api/optimize."""

    config: OptimizeConfig
    function_meta: FunctionMeta
    summary: OptimizeSummary
    heatmap: Optional[HeatmapData]
    history: List[IterationRecord]

    def to_dict(self) -> Dict[str, Any]:
        return to_serializable(self)
