from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
import math
import random
from typing import Callable, List, Optional, Tuple

from models import (
    BoundaryStrategy,
    IterationRecord,
    OptimizeConfig,
    ParticleStateSnapshot,
    PSOVariant,
    TopologyType,
)

ObjectiveFn = Callable[[List[float]], float]


def _round_vec(vec: List[float], digits: int = 5) -> List[float]:
    return [round(float(v), digits) for v in vec]


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _vec_norm(vec: List[float]) -> float:
    return math.sqrt(sum(v * v for v in vec))


@dataclass
class _Particle:
    """Внутреннее состояние частицы в D-мерном пространстве поиска."""

    particle_id: int
    position: List[float]
    velocity: List[float]
    fitness: float
    best_position: List[float]
    best_fitness: float

    def to_snapshot(self) -> ParticleStateSnapshot:
        return ParticleStateSnapshot(
            id=self.particle_id,
            position=_round_vec(self.position),
            velocity=_round_vec(self.velocity),
            fitness=round(self.fitness, 6),
            best_position=_round_vec(self.best_position),
            best_fitness=round(self.best_fitness, 6),
            speed=round(_vec_norm(self.velocity), 6),
        )


class BaseSwarmObserver(ABC):
    """Абстрактный наблюдатель за итерациями роя (паттерн Observer)."""

    @abstractmethod
    def on_iteration(self, record: IterationRecord) -> None:
        """Вызывается после завершения каждой итерации оптимизации."""


class HistoryCollectorObserver(BaseSwarmObserver):
    """Наблюдатель, сохраняющий историю итераций для графиков и пошагового плеера."""

    def __init__(self) -> None:
        self.records: List[IterationRecord] = []

    def on_iteration(self, record: IterationRecord) -> None:
        self.records.append(record)


class BasePSOOptimizer(ABC):
    """
    Базовый класс алгоритма метода роя частиц (паттерн Strategy).
    Реализует общую механику инициализации, топологий соседства (gbest / lbest),
    обработки границ (reflect / clamp / absorb), подсчёта NFE и разнообразия роя.
    """

    variant: PSOVariant

    def __init__(
        self,
        config: OptimizeConfig,
        bounds: List[Tuple[float, float]],
        objective_fn: ObjectiveFn,
        seed: Optional[int] = None,
        record_particles: bool = True,
        observers: Optional[List[BaseSwarmObserver]] = None,
    ) -> None:
        self.config = config
        self.bounds = list(bounds)
        self.dim = len(bounds)
        self.objective_fn = objective_fn
        self.seed = config.seed if seed is None else seed
        self.record_particles = record_particles
        self._observers: List[BaseSwarmObserver] = list(observers) if observers else []

        self._rng = random.Random(self.seed)
        self._particles: List[_Particle] = []
        self.iteration: int = 0
        self.nfe: int = 0

        self.global_best_position: List[float] = []
        self.global_best_fitness: float = float("inf")
        self.history: List[IterationRecord] = []

    def _eval(self, position: List[float]) -> float:
        self.nfe += 1
        return float(self.objective_fn(position))

    def _update_global_best(self, position: List[float], fitness: float) -> None:
        if fitness < self.global_best_fitness:
            self.global_best_fitness = fitness
            self.global_best_position = list(position)

    def _get_social_target(self, idx: int) -> List[float]:
        """Возвращает целевую позицию для социальной составляющей: G_best или локальный оптимум кольца."""
        if self.config.topology == TopologyType.GBEST:
            return self.global_best_position

        # Кольцевая топология lbest: сравниваем личные рекорды соседей (i-1, i, i+1) по модулю N
        n = len(self._particles)
        neighbors = (
            self._particles[(idx - 1) % n],
            self._particles[idx],
            self._particles[(idx + 1) % n],
        )
        best_neighbor = min(neighbors, key=lambda p: p.best_fitness)
        return best_neighbor.best_position

    def _apply_boundary(self, pos: float, vel: float, low: float, high: float) -> Tuple[float, float]:
        if low <= pos <= high:
            return pos, vel

        strategy = self.config.boundary_strategy
        clamped = low if pos < low else high

        if strategy == BoundaryStrategy.REFLECT:
            return clamped, -0.5 * vel
        if strategy == BoundaryStrategy.CLAMP:
            return clamped, 0.0
        return clamped, 0.25 * vel

    def _compute_diversity(self) -> float:
        """Среднее евклидово расстояние частиц от центра масс роя (индикатор сходимости)."""
        n = len(self._particles)
        if n == 0:
            return 0.0
        centroid = [
            sum(p.position[d] for p in self._particles) / n for d in range(self.dim)
        ]
        dist_sum = 0.0
        for p in self._particles:
            dist_sum += math.sqrt(
                sum((p.position[d] - centroid[d]) ** 2 for d in range(self.dim))
            )
        return dist_sum / n

    @abstractmethod
    def _effective_inertia(self, iteration: int) -> float:
        """Возвращает текущее значение коэффициента инерции w на итерации."""

    @abstractmethod
    def _compute_next_velocity(
        self,
        particle: _Particle,
        social_target: List[float],
        dim_idx: int,
        inertia_w: float,
    ) -> float:
        """Вычисляет обновлённую компоненту скорости частицы по координате dim_idx."""

    def _record_step(self, inertia_w: float) -> IterationRecord:
        n = len(self._particles)
        mean_fit = sum(p.fitness for p in self._particles) / max(1, n)
        mean_speed = sum(_vec_norm(p.velocity) for p in self._particles) / max(1, n)
        diversity = self._compute_diversity()

        snapshots = (
            [p.to_snapshot() for p in self._particles] if self.record_particles else []
        )

        record = IterationRecord(
            iteration=self.iteration,
            global_best_position=_round_vec(self.global_best_position),
            global_best_fitness=round(self.global_best_fitness, 6),
            mean_fitness=round(mean_fit, 6),
            diversity=round(diversity, 6),
            mean_speed=round(mean_speed, 6),
            inertia_w=round(inertia_w, 4),
            nfe=self.nfe,
            particles=snapshots,
        )
        self.history.append(record)
        for obs in self._observers:
            obs.on_iteration(record)
        return record

    def initialize(self) -> IterationRecord:
        """Инициализация роя (итерация 0) равномерно в заданных границах."""
        self._rng = random.Random(self.seed)
        self._particles = []
        self.history = []
        self.iteration = 0
        self.nfe = 0
        self.global_best_position = []
        self.global_best_fitness = float("inf")

        for pid in range(self.config.num_particles):
            pos = [self._rng.uniform(lo, hi) for lo, hi in self.bounds]
            vel = [
                self._rng.uniform(-(hi - lo) * 0.1, (hi - lo) * 0.1)
                for lo, hi in self.bounds
            ]
            fit = self._eval(pos)
            particle = _Particle(
                particle_id=pid,
                position=pos,
                velocity=vel,
                fitness=fit,
                best_position=list(pos),
                best_fitness=fit,
            )
            self._particles.append(particle)
            self._update_global_best(pos, fit)

        return self._record_step(self._effective_inertia(0))

    def step(self) -> IterationRecord:
        """Выполнение одной итерации движения роя."""
        if not self._particles:
            self.initialize()

        self.iteration += 1
        inertia_w = self._effective_inertia(self.iteration)

        social_targets = [
            list(self._get_social_target(idx)) for idx in range(len(self._particles))
        ]

        for idx, particle in enumerate(self._particles):
            social_target = social_targets[idx]
            for d, (lo, hi) in enumerate(self.bounds):
                raw_vel = self._compute_next_velocity(particle, social_target, d, inertia_w)
                max_vel = (hi - lo) * self.config.max_vel_ratio
                new_vel = _clamp(raw_vel, -max_vel, max_vel)
                new_pos = particle.position[d] + new_vel
                new_pos, new_vel = self._apply_boundary(new_pos, new_vel, lo, hi)
                particle.velocity[d] = new_vel
                particle.position[d] = new_pos

            fit = self._eval(particle.position)
            particle.fitness = fit
            if fit < particle.best_fitness:
                particle.best_fitness = fit
                particle.best_position = list(particle.position)
            self._update_global_best(particle.position, fit)

        return self._record_step(inertia_w)

    def run(self) -> List[IterationRecord]:
        """Запуск полного цикла оптимизации от итерации 0 до max_iterations."""
        self.initialize()
        for _ in range(self.config.max_iterations):
            self.step()
        return self.history


class ClassicPSO(BasePSOOptimizer):
    """Классический PSO с постоянным весом инерции w."""

    variant = PSOVariant.CLASSIC

    def _effective_inertia(self, iteration: int) -> float:
        _ = iteration
        return self.config.w

    def _compute_next_velocity(
        self,
        particle: _Particle,
        social_target: List[float],
        dim_idx: int,
        inertia_w: float,
    ) -> float:
        r1 = self._rng.random()
        r2 = self._rng.random()
        cognitive = self.config.c1 * r1 * (particle.best_position[dim_idx] - particle.position[dim_idx])
        social = self.config.c2 * r2 * (social_target[dim_idx] - particle.position[dim_idx])
        return inertia_w * particle.velocity[dim_idx] + cognitive + social


class LinearDecayInertiaPSO(BasePSOOptimizer):
    """
    Модификация LDIW-PSO (Linearly Decreasing Inertia Weight):
    инерция линейно убывает от w_max (глобальная разведка) к w_min (точное схождение).
    """

    variant = PSOVariant.LDIW

    def _effective_inertia(self, iteration: int) -> float:
        max_it = max(1, self.config.max_iterations)
        progress = min(1.0, iteration / float(max_it))
        return self.config.w_max - (self.config.w_max - self.config.w_min) * progress

    def _compute_next_velocity(
        self,
        particle: _Particle,
        social_target: List[float],
        dim_idx: int,
        inertia_w: float,
    ) -> float:
        r1 = self._rng.random()
        r2 = self._rng.random()
        cognitive = self.config.c1 * r1 * (particle.best_position[dim_idx] - particle.position[dim_idx])
        social = self.config.c2 * r2 * (social_target[dim_idx] - particle.position[dim_idx])
        return inertia_w * particle.velocity[dim_idx] + cognitive + social


class ConstrictionPSO(BasePSOOptimizer):
    """
    Модификация Клерка — Кеннеди с коэффициентом сжатия chi:
    V^{t+1} = chi * [V^t + c1*r1*(P_best - X^t) + c2*r2*(G_best - X^t)].
    """

    variant = PSOVariant.CONSTRICTION

    def _effective_inertia(self, iteration: int) -> float:
        _ = iteration
        return self.config.chi

    def _compute_next_velocity(
        self,
        particle: _Particle,
        social_target: List[float],
        dim_idx: int,
        inertia_w: float,
    ) -> float:
        r1 = self._rng.random()
        r2 = self._rng.random()
        c1 = self.config.c1 if self.config.c1 >= 1.8 else 2.05
        c2 = self.config.c2 if self.config.c2 >= 1.8 else 2.05
        cognitive = c1 * r1 * (particle.best_position[dim_idx] - particle.position[dim_idx])
        social = c2 * r2 * (social_target[dim_idx] - particle.position[dim_idx])
        return inertia_w * (particle.velocity[dim_idx] + cognitive + social)


def create_pso_optimizer(
    config: OptimizeConfig,
    bounds: List[Tuple[float, float]],
    objective_fn: ObjectiveFn,
    seed: Optional[int] = None,
    record_particles: bool = True,
    observers: Optional[List[BaseSwarmObserver]] = None,
) -> BasePSOOptimizer:
    """Фабричный метод создания выбранной модификации PSO (паттерн Factory Method)."""
    mapping = {
        PSOVariant.CLASSIC: ClassicPSO,
        PSOVariant.LDIW: LinearDecayInertiaPSO,
        PSOVariant.CONSTRICTION: ConstrictionPSO,
    }
    cls = mapping[config.variant]
    return cls(
        config=config,
        bounds=bounds,
        objective_fn=objective_fn,
        seed=seed,
        record_particles=record_particles,
        observers=observers,
    )
