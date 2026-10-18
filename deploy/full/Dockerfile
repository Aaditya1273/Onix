# The full VIGIL backend as one container for a free host (Render): FalkorDB
# 6.0.2 on loopback, the demo graph, vigil-server, and one run of the demo
# sessions through the real hook so the dashboard opens on real decisions.
# Build context: the repository root.
FROM golang:1.25-alpine AS builder
WORKDIR /app
ENV GOTOOLCHAIN=auto CGO_ENABLED=0 GOOS=linux
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -ldflags="-w -s" -o vigil-server ./cmd/vigil-server && go build -ldflags="-w -s" -o vigil-cli ./cmd/vigil-cli

FROM falkordb/falkordb:6.0.2
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/vigil-server /app/vigil-cli /app/
COPY scripts/measure.py /app/scripts/measure.py
COPY internal/graph/queries /app/internal/graph/queries
COPY deploy/full/start.sh /app/start.sh
ENV VIGIL_FALKORDB_URL=redis://127.0.0.1:6379 \
    VIGIL_ORG_ID=default \
    VIGIL_AUDIT_PATH=/tmp/vigil-audit.jsonl \
    VIGIL_ALLOW_EXEC=false \
    VIGIL_ALLOWED_ORIGINS=https://vigil-graph.vercel.app \
    VIGIL_DASHBOARD_BASE=https://vigil-graph.vercel.app
EXPOSE 8080
ENTRYPOINT []
CMD ["sh", "/app/start.sh"]
