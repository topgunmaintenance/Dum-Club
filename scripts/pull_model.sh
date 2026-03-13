#!/bin/bash
# Pull the default Ollama model after the container starts
# Run: ./scripts/pull_model.sh llama3

MODEL=${1:-llama3}
echo "Pulling Ollama model: $MODEL"
docker compose exec ollama ollama pull "$MODEL"
echo "✅ Model $MODEL ready"
