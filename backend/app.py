from flask import Flask, request, jsonify
from flask_cors import CORS
from pso import Swarm
from functions import FUNCTIONS

app = Flask(__name__)
CORS(app)

state = {
    "swarm": None,
    "func_key": "rastrigin",
    "iteration": 0,
    "history": [],
    "trajectories": {},
}


@app.route("/api/init", methods=["POST"])
def init_swarm():
    data = request.json or {}
    func_key = data.get("function", "rastrigin")
    num_particles = int(data.get("num_particles", 30))
    w = float(data.get("w", 0.7))
    c1 = float(data.get("c1", 1.5))
    c2 = float(data.get("c2", 1.5))

    meta = FUNCTIONS.get(func_key, FUNCTIONS["rastrigin"])
    swarm = Swarm(
        num_particles=num_particles,
        bounds=meta["bounds"],
        cost_func=meta["func"],
        w=w,
        c1=c1,
        c2=c2,
    )

    state["swarm"] = swarm
    state["func_key"] = func_key
    state["iteration"] = 0
    state["history"] = [{"iteration": 0, "best_score": swarm.global_best_score}]
    state["trajectories"] = {i: [list(p.position)] for i, p in enumerate(swarm.particles)}

    return jsonify(_serialize_state())


@app.route("/api/step", methods=["POST"])
def step_swarm():
    swarm: Swarm = state["swarm"]
    if not swarm:
        return jsonify({"error": "Рой не инициализирован"}), 400

    data = request.json or {}
    steps = int(data.get("steps", 1))

    # Позволяем менять гиперпараметры на лету
    if "w" in data:
        swarm.w = float(data["w"])
    if "c1" in data:
        swarm.c1 = float(data["c1"])
    if "c2" in data:
        swarm.c2 = float(data["c2"])

    for _ in range(steps):
        swarm.step()
        state["iteration"] += 1
        state["history"].append({
            "iteration": state["iteration"],
            "best_score": swarm.global_best_score,
        })
        for i, p in enumerate(swarm.particles):
            trail = state["trajectories"][i]
            trail.append(list(p.position))
            if len(trail) > 18:
                trail.pop(0)

    return jsonify(_serialize_state())


def _serialize_state():
    swarm: Swarm = state["swarm"]
    meta = FUNCTIONS[state["func_key"]]
    particles_data = [
        {
            "id": i,
            "position": p.position,
            "velocity": p.velocity,
            "best_position": p.best_position,
            "score": p.best_score,
            "trajectory": state["trajectories"][i],
        }
        for i, p in enumerate(swarm.particles)
    ]
    return {
        "function": state["func_key"],
        "iteration": state["iteration"],
        "global_best_position": swarm.global_best_position,
        "global_best_score": swarm.global_best_score,
        "optimum": meta["optimum"],
        "bounds": swarm.bounds,
        "particles": particles_data,
        "history": state["history"][-100:],
    }


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)