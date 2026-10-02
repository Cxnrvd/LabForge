# LabForge API with the Docker CLI inside, so it can start labs on the host's Docker engine
# through the mounted socket. Build context is the repository root.
FROM docker:28-cli AS dockercli

FROM python:3.12-slim
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
RUN pip install --no-cache-dir uv

WORKDIR /app
COPY packages/schema packages/schema
COPY packages/agent packages/agent
COPY apps/api apps/api
# Install exactly what uv.lock pins (the same versions the tests run against). The editable
# project keeps the code under /app, where the API looks for templates and role images.
RUN cd apps/api && uv sync --frozen --no-dev

WORKDIR /app/apps/api
ENV PYTHONUNBUFFERED=1 PATH="/app/apps/api/.venv/bin:${PATH}"
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health').read()"
CMD ["uvicorn", "labforge_core.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
