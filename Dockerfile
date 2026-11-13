# Pipeline image: dependencies only. The repository is mounted at /app (see docker-compose.yml),
# so caches and outputs land in your checkout exactly like a native run.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PYTHONIOENCODING=utf-8
WORKDIR /app
COPY requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt
ENTRYPOINT ["python", "-m", "pipeline"]
CMD ["doctor"]
