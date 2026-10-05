# syntax=docker/dockerfile:1
# Ollama for the script chat, on the CPU: the official image without its GPU
# libraries (CUDA and Jetson, about 3.5 GB), run as a user rather than root.
# docker-compose.yml runs it as the `ollama` service. With an NVIDIA GPU, use
# the official image instead: docker-compose.gpu.yml.
ARG OLLAMA_VERSION=0.35.1

FROM ollama/ollama:${OLLAMA_VERSION} AS upstream
RUN rm -rf /usr/lib/ollama/cuda_* /usr/lib/ollama/rocm* /usr/lib/ollama/vulkan*

# The official image's own base.
FROM ubuntu:24.04
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --create-home --home-dir /home/ollama ollama \
 && mkdir -p /ollama/models \
 && chown ollama:ollama /ollama/models
COPY --from=upstream /usr/bin/ollama /usr/bin/ollama
# The CPU backends, and the licenses of what Ollama bundles (llama.cpp, Go).
COPY --from=upstream /usr/lib/ollama /usr/lib/ollama
ENV OLLAMA_HOST=0.0.0.0:11434 \
    OLLAMA_MODELS=/ollama/models
# The models live here.
VOLUME /ollama/models
USER ollama
EXPOSE 11434
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=4 \
  CMD ollama list > /dev/null || exit 1
ENTRYPOINT ["/usr/bin/ollama"]
CMD ["serve"]
