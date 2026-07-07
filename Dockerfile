# === Stage 1: Build frontend ===
FROM node:20-alpine AS frontend-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# === Stage 2: Build backend (use Debian to match production environment) ===
FROM node:20-bookworm-slim AS backend-build
WORKDIR /app/server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# === Stage 3: Production (Node + Debian for Python/Docling support) ===
FROM node:20-bookworm-slim AS production
WORKDIR /app

# Optional mirror override for constrained deployment regions.
ARG DEBIAN_MIRROR=deb.debian.org
RUN sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i "s|deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list 2>/dev/null; \
    true

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-pip \
    python3-venv \
    poppler-utils \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

# Set up Python virtual environment for Docling
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies; deployment may override the package index.
ARG PIP_INDEX_URL=https://pypi.org/simple
COPY server/python/requirements.txt /tmp/python-requirements.txt
RUN pip install --no-cache-dir --index-url "${PIP_INDEX_URL}" -r /tmp/python-requirements.txt \
    && rm /tmp/python-requirements.txt

# Copy backend build artifacts
COPY --from=backend-build /app/server/dist ./dist
COPY --from=backend-build /app/server/node_modules ./node_modules
COPY --from=backend-build /app/server/package.json ./

# Copy Python parser scripts
COPY server/python/ ./python/
COPY server/src/db/migrations/ ./migrations/

# Copy frontend build artifacts (for Nginx)
COPY --from=frontend-build /app/client/dist /usr/share/nginx/html

# Create data directories
RUN mkdir -p /data/db /data/papers /data/uploads

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV DB_PATH=/data/db/app.db
ENV PAPERS_DIR=/data/papers
ENV UPLOADS_DIR=/data/uploads
ENV PYTHON_EXECUTABLE=/opt/venv/bin/python3
ENV PYTHON_PARSER_PATH=/app/python/docling_parser.py
ENV MIGRATIONS_DIR=/app/migrations

# Memory-friendly: limit OpenBLAS/MKL threads
ENV OMP_NUM_THREADS=2
ENV OPENBLAS_NUM_THREADS=2
ENV MKL_NUM_THREADS=2

EXPOSE 3000

CMD ["node", "dist/index.js"]
