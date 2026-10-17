# Deploying the public playground

The playground is `vigil-server` in hosted mode (`VIGIL_PLAYGROUND=1`) next to a private FalkorDB 6.0.2.

**Local:** `docker compose --profile playground up -d`, then http://localhost:8090.

**Fly.io:** see the commands at the top of [`fly.toml`](fly.toml). FalkorDB runs as a second app,
[`falkordb.fly.toml`](falkordb.fly.toml), reachable only on Fly's private network.

**Railway:** two services in one project.
1. FalkorDB: "Deploy a Docker image", `falkordb/falkordb:6.0.2`, with a volume mounted at `/var/lib/falkordb/data`
   and no public domain.
2. The playground: from this repo, config file path `deploy/playground/railway.json`, variables
   `VIGIL_PLAYGROUND=1`, `VIGIL_ORG_ID=playground`, `VIGIL_TRUST_PROXY=1`,
   `VIGIL_FALKORDB_URL=redis://${{FalkorDB.RAILWAY_PRIVATE_DOMAIN}}:6379`, and a public domain.

**Cloudflare:** [`deploy/cloudflare/`](../cloudflare/) runs both in one Container (FalkorDB bound to loopback,
outbound internet disabled) behind a Worker that sets `X-Forwarded-For` from `CF-Connecting-IP`:
`cd deploy/cloudflare && npm install && npx wrangler deploy`. The image was built and all six scenarios checked
locally; the deploy itself needs the Workers Paid plan (Containers are not available on the free plan). The graph
lives in the instance, so the counter and feed start empty after 30 idle minutes.

These configs have not been deployed from this repository; they follow each platform's documented format.

## What hosted mode exposes, and what it does not

| Exposed | Not exposed |
|---|---|
| `GET /api/v1/playground/scenarios`, `GET /api/v1/playground/stats`, `POST /api/v1/playground/attempt`, `GET /api/v1/health`, `/web/*` | the control API, the Claude Code hook, the MCP server, OAuth, tool registration, ledger export, everything else `vigil-server` serves |

- **Nothing executes.** Every call the firewall allows runs in `internal/playground/sim`, an in-memory world. That
  package imports no `os`, `net`, `exec`, `syscall` or `io` (`TestSimPerformsNoIO`), and destructive commands leave
  the host untouched (`TestDestructiveCommandsAreOnlySimulated`).
- **No model, no outbound calls.** The playground firewall has no LLM router and no reputation sources.
- **Secrets are stripped before storage.** Inputs, labels, reasons and outputs pass through `playground.Sanitize`:
  the visitor's fake key and anything the secret detectors recognize become `[secret]`, bounded to 300 characters.
- **No visitor identity is stored.** The rate limit (`VIGIL_PLAYGROUND_RATE` attempts per minute, default 20) keeps
  client addresses in memory for one minute. Behind Fly or Railway set `VIGIL_TRUST_PROXY=1` so the forwarded
  address is used; without it, forwarded headers are ignored because a client can set them.
- **Bounded requests:** 4 KB bodies, 500-character inputs, 15 s per attempt.
- **Its own graph.** Attempts are written to the `playground` tenant only, each with its own agent id and sessions.
