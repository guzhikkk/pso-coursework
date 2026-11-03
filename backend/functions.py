import math


def sphere(x: list[float]) -> float:
    """Функция Сферы: глобальный минимум f(0, ..., 0) = 0."""
    return sum(xi ** 2 for xi in x)


def rastrigin(x: list[float]) -> float:
    """Функция Растригина: множество локальных минимумов, глобальный минимум f(0, ..., 0) = 0."""
    a = 10.0
    n = len(x)
    return a * n + sum((xi ** 2 - a * math.cos(2 * math.pi * xi)) for xi in x)


def rosenbrock(x: list[float]) -> float:
    """Функция Розенброка: узкий параболический овраг, глобальный минимум f(1, ..., 1) = 0."""
    return sum(
        100.0 * (x[i + 1] - x[i] ** 2) ** 2 + (1.0 - x[i]) ** 2
        for i in range(len(x) - 1)
    )


FUNCTIONS = {
    "rastrigin": {
        "name": "Функция Растригина",
        "func": rastrigin,
        "bounds": [(-5.12, 5.12), (-5.12, 5.12)],
        "optimum": [0.0, 0.0],
    },
    "rosenbrock": {
        "name": "Функция Розенброка",
        "func": rosenbrock,
        "bounds": [(-2.0, 2.0), (-1.0, 3.0)],
        "optimum": [1.0, 1.0],
    },
    "sphere": {
        "name": "Функция Сферы",
        "func": sphere,
        "bounds": [(-5.0, 5.0), (-5.0, 5.0)],
        "optimum": [0.0, 0.0],
    },
}