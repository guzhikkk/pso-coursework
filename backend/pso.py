import random
from typing import Callable


class Particle:
    """Отдельная частица (кибер-пчела) в пространстве поиска."""

    def __init__(self, bounds: list[tuple[float, float]]):
        # Случайная инициализация начальной позиции и скорости в пределах границ
        self.position: list[float] = [random.uniform(b[0], b[1]) for b in bounds]
        self.velocity: list[float] = [
            random.uniform(-(b[1] - b[0]) * 0.1, (b[1] - b[0]) * 0.1) for b in bounds
        ]
        # Лучшая индивидуальная позиция частицы (P_best)
        self.best_position: list[float] = list(self.position)
        self.best_score: float = float("inf")
        self.current_score: float = float("inf")

    def evaluate(self, cost_func: Callable[[list[float]], float]) -> float:
        """Вычисление значения целевой функции и обновление личного рекорда P_best."""
        self.current_score = cost_func(self.position)
        if self.current_score < self.best_score:
            self.best_score = self.current_score
            self.best_position = list(self.position)
        return self.current_score


class Swarm:
    """Рой частиц, реализующий метод роя частиц (PSO)."""

    def __init__(
        self,
        num_particles: int,
        bounds: list[tuple[float, float]],
        cost_func: Callable[[list[float]], float],
        w: float = 0.7,
        c1: float = 1.5,
        c2: float = 1.5,
    ):
        self.bounds = bounds
        self.cost_func = cost_func
        self.w = w    # Коэффициент инерции
        self.c1 = c1  # Когнитивный параметр (тяга к P_best)
        self.c2 = c2  # Социальный параметр (тяга к G_best)

        self.particles: list[Particle] = [Particle(bounds) for _ in range(num_particles)]
        self.global_best_position: list[float] = []
        self.global_best_score: float = float("inf")

        # Первичная оценка роя и выбор глобального лидера G_best
        for particle in self.particles:
            score = particle.evaluate(self.cost_func)
            if score < self.global_best_score:
                self.global_best_score = score
                self.global_best_position = list(particle.position)

    def step(self) -> None:
        """Выполнение одной итерации обновления скоростей и координат роя."""
        for particle in self.particles:
            for i in range(len(particle.position)):
                r1 = random.random()
                r2 = random.random()

                # Когнитивная и социальная составляющие скорости
                cognitive = self.c1 * r1 * (particle.best_position[i] - particle.position[i])
                social = self.c2 * r2 * (self.global_best_position[i] - particle.position[i])

                # Обновление скорости частицы
                particle.velocity[i] = self.w * particle.velocity[i] + cognitive + social

                # Ограничение максимальной скорости для предотвращения взрывного разлета
                max_vel = (self.bounds[i][1] - self.bounds[i][0]) * 0.25
                particle.velocity[i] = max(-max_vel, min(max_vel, particle.velocity[i]))

                # Обновление позиции частицы
                particle.position[i] += particle.velocity[i]

                # Удержание частицы в границах области поиска
                if particle.position[i] < self.bounds[i][0]:
                    particle.position[i] = self.bounds[i][0]
                    particle.velocity[i] *= -0.5
                elif particle.position[i] > self.bounds[i][1]:
                    particle.position[i] = self.bounds[i][1]
                    particle.velocity[i] *= -0.5

            # Пересчет целевой функции и обновление глобального оптимума G_best
            score = particle.evaluate(self.cost_func)
            if score < self.global_best_score:
                self.global_best_score = score
                self.global_best_position = list(particle.position)