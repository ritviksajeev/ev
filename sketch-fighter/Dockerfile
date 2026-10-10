# Build the frontend, then serve it and the API from one Python image.
# Cloud Run: deploy with --min-instances 1 --max-instances 1 (see README).

FROM node:22-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared /app/shared
COPY frontend ./
RUN npm run build

FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY backend/requirements.txt backend/
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY shared shared
COPY samples samples
COPY backend backend
COPY --from=web /app/backend/static backend/static
WORKDIR /app/backend
# One worker so the in-memory stage gallery is shared; threads for concurrency.
CMD ["sh", "-c", "exec gunicorn --bind :$PORT --workers 1 --threads 8 --timeout 30 app:app"]
