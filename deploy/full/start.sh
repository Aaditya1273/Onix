#!/bin/sh
# FalkorDB on loopback, the demo graph, the server, then the demo sessions
# (scripts/measure.py: benign sessions and the attack beats, through the hook).
# Set VIGIL_CONTROL_TOKEN: the hook and every mutating route then need it.
set -e
# Never serve the control routes open: with no token configured, make one
# nobody knows. Writes then need the Render-set token, or nothing writes.
if [ -z "$VIGIL_CONTROL_TOKEN" ]; then
  VIGIL_CONTROL_TOKEN=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  echo "VIGIL_CONTROL_TOKEN was not set: generated one for this run; set it in the host to call the hook"
fi
export VIGIL_CONTROL_TOKEN
redis-server --bind 127.0.0.1 --protected-mode no --daemonize yes --loadmodule /var/lib/falkordb/bin/falkordb.so $FALKORDB_ARGS
until redis-cli ping >/dev/null 2>&1; do sleep 0.2; done
/app/vigil-cli graph-seed
/app/vigil-server &
SERVER=$!
python3 - <<'PY'
import time, urllib.request
for _ in range(120):
    try:
        urllib.request.urlopen("http://127.0.0.1:8080/api/v1/health", timeout=2); break
    except Exception:
        time.sleep(0.5)
PY
python3 /app/scripts/measure.py --vigil http://127.0.0.1:8080 --falkordb 127.0.0.1:6379 --sessions 5 --out /tmp/measure.md > /tmp/measure.log 2>&1 \
  && echo "demo sessions loaded" || echo "demo sessions failed, see /tmp/measure.log"
wait $SERVER
