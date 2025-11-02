from flask import Flask, jsonify
import random

app = Flask(__name__)

@app.route("/health", methods=["GET"])
def health_check():
    """Simple health endpoint to verify service is alive."""
    return jsonify(status="UP"), 200

@app.route("/recommendations/<user_id>", methods=["GET"])
def get_recommendations(user_id):
    """Mock endpoint that returns random recommendations for a user."""
    sample_items = [
        "Learn Spring Boot in 10 Days",
        "AWS Cost Optimization Guide",
        "Building Scalable Microservices",
        "Advanced SQL for Backend Devs",
        "System Design Crash Course"
    ]
    recommendations = random.sample(sample_items, 3)
    return jsonify(userId=user_id, recommendations=recommendations)

if __name__ == "__main__":
    # Bind to all interfaces so it's reachable in Docker/ECS
    app.run(host="0.0.0.0", port=8081)
