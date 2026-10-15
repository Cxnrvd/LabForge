FROM python:3.12-slim

LABEL org.opencontainers.image.title="labforge log-replay" \
      org.opencontainers.image.description="Generates a LabForge scenario's synthetic logs and loads them into Elasticsearch and Kibana"

ENV PYTHONUNBUFFERED=1
WORKDIR /opt/labforge
COPY scenarios /opt/labforge/scenarios
COPY entrypoint.py /opt/labforge/entrypoint.py
RUN printf '#!/bin/sh\nexec python /opt/labforge/entrypoint.py load "$@"\n' > /usr/local/bin/labforge-load \
    && chmod +x /usr/local/bin/labforge-load

ENTRYPOINT ["python", "/opt/labforge/entrypoint.py", "serve"]
