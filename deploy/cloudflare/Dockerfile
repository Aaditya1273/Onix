# The public playground as one Cloudflare Container: vigil-server in hosted mode
# and a private FalkorDB 6.0.2 bound to loopback in the same instance.
# Built by wrangler with the repository root as the context.
FROM golang:1.25-alpine AS builder
WORKDIR /app
ENV GOTOOLCHAIN=auto CGO_ENABLED=0 GOOS=linux
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -ldflags="-w -s" -o vigil-server ./cmd/vigil-server

FROM falkordb/falkordb:6.0.2
COPY --from=builder /app/vigil-server /app/vigil-server
ENV VIGIL_PLAYGROUND=1 \
    VIGIL_ORG_ID=playground \
    VIGIL_TRUST_PROXY=1 \
    VIGIL_PLAYGROUND_RATE=20 \
    VIGIL_FALKORDB_URL=redis://127.0.0.1:6379
EXPOSE 8080
ENTRYPOINT []
CMD ["sh", "-c", "redis-server --bind 127.0.0.1 --protected-mode no --daemonize yes --loadmodule /var/lib/falkordb/bin/falkordb.so $FALKORDB_ARGS && until redis-cli ping >/dev/null 2>&1; do sleep 0.2; done && exec /app/vigil-server"]
