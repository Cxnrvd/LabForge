FROM python:3.12-slim

LABEL org.opencontainers.image.title="labforge fakenet" \
      org.opencontainers.image.description="Fake internet for malware analysis: answers every DNS query with its own address and logs HTTP requests"

ENV PYTHONUNBUFFERED=1
COPY fakenet.py /opt/fakenet.py
EXPOSE 53/udp 80/tcp
CMD ["python", "/opt/fakenet.py"]
