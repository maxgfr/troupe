# syntax=docker/dockerfile:1
# Ollama for the script chat, on the CPU: the official image without its GPU
# libraries (CUDA and Jetson, about 3.5 GB), run as a user rather than root.
# docker-compose.yml runs it as the `ollama` service. The `gpu` target is the
# official image itself, for docker-compose.gpu.yml. The Ollama version is
# pinned here, once: change the tag and its digest together.

# ollama/ollama:0.35.1
FROM ollama/ollama:0.35.1@sha256:292ee7945dfc3d5840a181f3ab86fedb1e66703e02c8af98b50f4da56b7e278c AS official

# The official image, with CUDA, for an NVIDIA GPU, as the same user as the
# CPU image below so the two share the models volume.
FROM official AS gpu
COPY LICENSE.ollama /usr/share/doc/ollama/LICENSE
COPY NOTICE /usr/share/doc/ollama/NOTICE
RUN useradd --system --uid 10001 --create-home --home-dir /home/ollama ollama \
 && mkdir -p /ollama/models \
 && chown ollama:ollama /ollama/models
ENV OLLAMA_MODELS=/ollama/models
VOLUME /ollama/models
USER ollama

FROM official AS cpu-libraries
RUN rm -rf /usr/lib/ollama/cuda_* /usr/lib/ollama/rocm* /usr/lib/ollama/vulkan*

# ubuntu:24.04, the official image's own base.
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --create-home --home-dir /home/ollama ollama \
 && mkdir -p /ollama/models \
 && chown ollama:ollama /ollama/models
COPY --from=cpu-libraries /usr/bin/ollama /usr/bin/ollama
# The CPU backends, with the license files of what Ollama bundles.
COPY --from=cpu-libraries /usr/lib/ollama /usr/lib/ollama
COPY LICENSE.ollama /usr/share/doc/ollama/LICENSE
COPY NOTICE /usr/share/doc/ollama/NOTICE
# Every license NOTICE names must be in the image.
RUN for f in /usr/share/doc/ollama/LICENSE /usr/lib/ollama/LLAMA_CPP_LICENSE /usr/lib/ollama/LLAMA_CPP_VENDORS_LICENSE \
      /usr/lib/ollama/CPP_HTTPLIB_LICENSE /usr/lib/ollama/GO_LICENSE /usr/share/doc/gcc-14-base/copyright; do \
      test -s "$f" || { echo "missing license file: $f" >&2; exit 1; }; \
    done
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
