from pso import Particle, Swarm
from functions import sphere, rastrigin, rosenbrock


def test_particle_initialization():
    """Тест 1: Проверка инициализации частицы в заданных границах."""
    bounds = [(-5.0, 5.0), (-2.0, 3.0)]
    p = Particle(bounds)
    assert len(p.position) == 2
    assert -5.0 <= p.position[0] <= 5.0
    assert -2.0 <= p.position[1] <= 3.0


def test_particle_evaluation_updates_personal_best():
    """Тест 2: Проверка обновления персонального рекорда частицы (P_best)."""
    bounds = [(-5.0, 5.0), (-5.0, 5.0)]
    p = Particle(bounds)
    p.position = [3.0, 4.0]
    score = p.evaluate(sphere)
    assert score == 25.0
    assert p.best_score == 25.0

    # Перемещаем в более выгодную точку
    p.position = [1.0, 2.0]
    new_score = p.evaluate(sphere)
    assert new_score == 5.0
    assert p.best_score == 5.0
    assert p.best_position == [1.0, 2.0]


def test_swarm_initialization():
    """Тест 3: Проверка создания роя и нахождения начального G_best."""
    bounds = [(-5.0, 5.0), (-5.0, 5.0)]
    swarm = Swarm(num_particles=15, bounds=bounds, cost_func=sphere)
    assert len(swarm.particles) == 15
    assert swarm.global_best_score < float("inf")
    assert len(swarm.global_best_position) == 2


def test_swarm_monotonic_global_best():
    """Тест 4: Глобальный оптимум G_best не должен ухудшаться со временем."""
    bounds = [(-5.12, 5.12), (-5.12, 5.12)]
    swarm = Swarm(num_particles=25, bounds=bounds, cost_func=rastrigin)
    prev_best = swarm.global_best_score
    for _ in range(10):
        swarm.step()
        assert swarm.global_best_score <= prev_best
        prev_best = swarm.global_best_score


def test_bounds_clamping():
    """Тест 5: Проверка удержания частиц внутри границ пространства поиска."""
    bounds = [(-1.0, 1.0), (-1.0, 1.0)]
    swarm = Swarm(num_particles=10, bounds=bounds, cost_func=sphere, w=2.0)
    for _ in range(20):
        swarm.step()
        for p in swarm.particles:
            assert -1.0 <= p.position[0] <= 1.0
            assert -1.0 <= p.position[1] <= 1.0


def test_convergence_on_rosenbrock():
    """Тест 6: Проверка сходимости алгоритма на функции Розенброка."""
    bounds = [(-2.0, 2.0), (-1.0, 3.0)]
    swarm = Swarm(num_particles=40, bounds=bounds, cost_func=rosenbrock, w=0.6, c1=1.5, c2=1.5)
    for _ in range(80):
        swarm.step()
    assert swarm.global_best_score < 0.5