#!/usr/bin/env python3
# /// script
# dependencies = ["falkordb"]
# ///
"""Loads real npm package data into FalkorDB as the package graph the
firewall's supply-chain checks traverse.

Data sources, both real and unauthenticated:
  - registry.npmjs.org/-/v1/search  — popularity-ranked package discovery
  - registry.npmjs.org/{name}       — maintainers and the latest version's
    direct dependencies, one call per package
  - api.npmjs.org/downloads         — weekly downloads, to tell a typosquat
    (near-name, nobody uses it) from a legitimate near-name (preact/react)

Writes, into tenant_<VIGIL_ORG_ID>:
  (:Package)-[:DEPENDS_ON]->(:Package)
  (:Maintainer)-[:MAINTAINS]->(:Package)
  (:Service)-[:DEPENDS_ON]->(:Package)        synthetic demo consumers
  (:Package)-[:TYPOSQUAT_OF {distance}]->(:Package)

Every write is a MERGE, so re-running is safe.

Usage:
    VIGIL_FALKORDB_URL=redis://localhost:6379 uv run scripts/ingest_npm.py --count 2000
    uv run scripts/ingest_npm.py --count 200 --dry-run
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from difflib import SequenceMatcher

NPM_REGISTRY = "https://registry.npmjs.org"
DOWNLOADS_API = "https://api.npmjs.org/downloads/point/last-week"

# A handful of internal-service names to weave into the ingested text, so
# the blast-radius demo has something concrete to point at. Clearly
# synthetic — these are not real companies or services, just plausible
# consumers so "which services are exposed" has an answer during a demo.
# The package dependency data itself is 100% real; only this consumer
# layer is invented, and this comment says so rather than hiding it.
DEMO_SERVICES = [
    ("billing-api", ["express", "stripe", "lodash"]),
    ("auth-service", ["jsonwebtoken", "bcrypt", "express"]),
    ("checkout-api", ["express", "body-parser", "lodash"]),
    ("notification-worker", ["axios", "node-cron", "lodash"]),
]

# Popular packages a typosquat campaign would actually target. Checking new
# candidate names against this shortlist (rather than all-pairs across the
# full ingested set) is both realistic — typosquats target popular
# packages, not obscure ones — and far cheaper: O(n * len(shortlist))
# instead of O(n^2).
TYPOSQUAT_TARGETS = [
    "react", "react-dom", "express", "lodash", "axios", "chalk", "commander",
    "request", "cross-env", "webpack", "babel-core", "eslint", "jest",
    "typescript", "vue", "next", "tanstack-react-router", "prettier",
]


def http_json(url, method="GET", data=None, headers=None, timeout=20):
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def discover_packages(count):
    """Pages through npm's own popularity-ranked search. Real ranking, not
    a hardcoded list — npm's search API scores on downloads/dependents/
    maintenance and is paginated up to size=250 per call."""
    names, seen = [], set()
    frm = 0
    while len(names) < count:
        size = min(250, count - len(names))
        url = f"{NPM_REGISTRY}/-/v1/search?text=keywords:javascript&popularity=1.0&size={size}&from={frm}"
        try:
            body = http_json(url)
        except urllib.error.URLError as e:
            print(f"  search page at from={frm} failed: {e}", file=sys.stderr)
            break
        objs = body.get("objects", [])
        if not objs:
            break
        for o in objs:
            n = o["package"]["name"]
            if n not in seen:
                seen.add(n)
                names.append(n)
        frm += size
        if frm > body.get("total", 0):
            break
    return names[:count]


def fetch_package_doc(name):
    """One call per package: maintainers, every version's direct deps, and
    publish times, straight from the registry's own package document."""
    url = f"{NPM_REGISTRY}/{urllib.parse.quote(name, safe='')}"
    return http_json(url, timeout=15)


def levenshtein_le(a, b, limit):
    """True if edit distance(a, b) <= limit, short-circuiting past it —
    exact distance value is never needed, only the threshold check, and
    typosquat names differ by 1-2 characters almost by definition."""
    if abs(len(a) - len(b)) > limit:
        return False
    # difflib's ratio is a fast pre-filter; only names close enough to
    # plausibly be within `limit` edits get the exact DP computation.
    if SequenceMatcher(None, a, b).ratio() < 0.75:
        return False
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        prev = cur
        if min(prev) > limit:
            return False
    return prev[-1] <= limit


def package_facts(doc):
    latest = (doc.get("dist-tags") or {}).get("latest") or ""
    lv = (doc.get("versions") or {}).get(latest, {})
    deps = list((lv.get("dependencies") or {}).keys())[:50]
    maintainers = [m.get("name", "?") for m in doc.get("maintainers", []) or []][:10]
    return latest, (doc.get("time") or {}).get(latest, ""), deps, maintainers


def weekly_downloads(name):
    try:
        return http_json(f"{DOWNLOADS_API}/{urllib.parse.quote(name, safe='')}", timeout=10).get("downloads", 0)
    except Exception:
        return None


def write_package(g, name, doc):
    latest, published, deps, maintainers = package_facts(doc)
    g.query("MERGE (p:Package {name:$name}) SET p.ecosystem = 'npm', p.version = $v, p.published = $t",
            {"name": name, "v": latest, "t": published})
    if deps:
        g.query("""MATCH (p:Package {name:$name}) UNWIND $deps AS d
                   MERGE (q:Package {name:d}) MERGE (p)-[:DEPENDS_ON]->(q)""", {"name": name, "deps": deps})
    if maintainers:
        g.query("""MATCH (p:Package {name:$name}) UNWIND $ms AS m
                   MERGE (mm:Maintainer {name:m}) MERGE (mm)-[:MAINTAINS]->(p)""", {"name": name, "ms": maintainers})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=2000, help="number of packages to discover and ingest")
    ap.add_argument("--rps", type=float, default=10, help="npm registry requests/sec")
    ap.add_argument("--squat-max-downloads", type=int, default=1000,
                    help="a near-name with more weekly downloads than this is a real package, not a typosquat")
    ap.add_argument("--dry-run", action="store_true", help="fetch and print, don't write")
    ap.add_argument("--check", nargs="*", help="extra package names to test for typosquatting (e.g. from a new-package feed)")
    args = ap.parse_args()

    ap_url = os.environ.get("VIGIL_FALKORDB_URL")
    g = None
    if not args.dry_run:
        if not ap_url:
            print("VIGIL_FALKORDB_URL not set (e.g. redis://localhost:6379)", file=sys.stderr)
            sys.exit(1)
        from falkordb import FalkorDB
        g = FalkorDB.from_url(ap_url).select_graph("tenant_" + os.environ.get("VIGIL_ORG_ID", "default"))

    print(f"discovering top {args.count} npm packages by popularity...")
    names = discover_packages(args.count)
    print(f"discovered {len(names)} package names")

    if not args.dry_run:
        print("ingesting synthetic demo-service consumers (clearly marked as such)...")
        for svc, deps in DEMO_SERVICES:
            g.query("""MERGE (s:Service {name:$svc}) WITH s UNWIND $deps AS d
                       MERGE (p:Package {name:d}) MERGE (s)-[:DEPENDS_ON]->(p)""", {"svc": svc, "deps": deps})

    ingested, failed, docs = 0, 0, {}
    interval = 1.0 / args.rps
    for i, name in enumerate(names):
        try:
            doc = fetch_package_doc(name)
        except Exception as e:
            print(f"  [{i+1}/{len(names)}] fetch {name} failed: {e}", file=sys.stderr)
            failed += 1
            continue
        docs[name] = doc

        if args.dry_run:
            latest, _, deps, maintainers = package_facts(doc)
            print(f"  [{i+1}/{len(names)}] {name}@{latest}: {len(deps)} deps, maintainers {maintainers[:3]}")
            continue

        try:
            write_package(g, name, doc)
            ingested += 1
        except Exception as e:
            print(f"  [{i+1}/{len(names)}] ingest {name} failed: {e}", file=sys.stderr)
            failed += 1

        if (i + 1) % 50 == 0:
            print(f"  progress: {i+1}/{len(names)} fetched, {ingested} ingested, {failed} failed")
        time.sleep(interval)

    # --- typosquat detection: near-name of a popular target, and unused ---
    # The firewall BLOCKS installs along TYPOSQUAT_OF, so a near-name alone is
    # not enough: preact is one edit from react and has 39M weekly downloads.
    # Only a near-name nobody downloads is recorded as a squat.
    print("checking names against popular-package typosquat targets...")
    typosquats = []
    for name in set(names) | set(args.check or []):
        for target in TYPOSQUAT_TARGETS:
            if name == target or not levenshtein_le(name, target, 2):
                continue
            dl = weekly_downloads(name)
            if dl is None or dl > args.squat_max_downloads:
                print(f"  {name} ~ {target}: {dl} weekly downloads, a real package, skipped")
                continue
            typosquats.append((name, target))
    print(f"found {len(typosquats)} typosquats")
    if not args.dry_run:
        for name, target in typosquats:
            g.query("""MERGE (a:Package {name:$a}) MERGE (b:Package {name:$b})
                       MERGE (a)-[:TYPOSQUAT_OF]->(b)""", {"a": name, "b": target})

    print(f"\ndone. packages fetched={len(docs)} ingested={ingested} failed={failed} typosquats={len(typosquats)}")
    if typosquats:
        print("typosquats found:", ", ".join(f"{a}~{b}" for a, b in typosquats[:20]))


if __name__ == "__main__":
    main()
