#!/usr/bin/env python3
"""VIGIL Demo Seed — seeds the VIGIL environment with initial data.

Creates:
- Default cost policies
- Agent DNA baselines
- Sample governance rules
- Demo dashboards
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
import urllib.request
import urllib.parse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("vigil-seed")

API_URL = os.environ.get("VIGIL_API_URL", "http://localhost:8080")


def _api_post(path: str, data: dict, retries: int = 5) -> dict:
    """POST to the VIGIL API with retry logic."""
    url = f"{API_URL}{path}"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(data).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if attempt < retries - 1:
                wait = (attempt + 1) * 2
                logger.info(f"  Retry {attempt+1}/{retries} in {wait}s: {e.code}")
                time.sleep(wait)
            else:
                logger.warning(f"  API error: {e.code} {e.reason} on POST {path}")
                return {"error": str(e)}
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
            else:
                logger.warning(f"  Request failed: {e}")
                return {"error": str(e)}
    return {"error": "Max retries exceeded"}


def wait_for_api():
    """Wait until the VIGIL API is available."""
    logger.info("Waiting for VIGIL API...")
    for i in range(30):
        try:
            req = urllib.request.Request(f"{API_URL}/api/v1/health")
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    logger.info("VIGIL API is ready!")
                    return True
        except Exception:
            pass
        time.sleep(2)
    logger.error("VIGIL API did not become available in time")
    return False


def seed_cost_policies():
    """Create default cost policies."""
    logger.info("Seeding cost policies...")

    policies = [
        {
            "name": "Run Cost Limit",
            "condition": {"dimension": "run_cost", "operator": ">", "threshold": 5.0},
            "action": "KILL_RUN",
            "enabled": True,
        },
        {
            "name": "Daily Budget Enforcer",
            "condition": {"dimension": "daily_budget", "operator": ">", "threshold": 50.0},
            "action": "BLOCK_EXECUTION",
            "enabled": True,
        },
        {
            "name": "GPT-4 Cost Fallback",
            "condition": {"dimension": "model_gpt-4", "operator": ">", "threshold": 100.0},
            "action": "FALLBACK_MODEL",
            "enabled": True,
        },
        {
            "name": "Latency SLA",
            "condition": {"dimension": "latency_ms", "operator": ">", "threshold": 5000.0},
            "action": "ALERT",
            "enabled": True,
        },
        {
            "name": "Tool Call Limit",
            "condition": {"dimension": "tool_calls", "operator": ">", "threshold": 50.0},
            "action": "REDUCE_CONTEXT",
            "enabled": True,
        },
    ]

    for policy in policies:
        result = _api_post("/api/v1/vigil/cost/policies", policy)
        if "error" in result:
            logger.warning(f"  Failed to create policy '{policy['name']}': {result['error']}")
        else:
            logger.info(f"  Created policy: {policy['name']}")


def seed_governance_rules():
    """Create governance rules."""
    logger.info("Seeding governance rules...")

    rules = [
        {
            "name": "Infinite Tool Loop Detection",
            "plugin": "infinite_loop",
            "config": {"max_consecutive_tools": 5},
            "severity": "CRITICAL",
            "action": "KILL_RUN",
            "enabled": True,
        },
        {
            "name": "Token Explosion Prevention",
            "plugin": "token_explosion",
            "config": {"max_total_tokens": 50000},
            "severity": "CRITICAL",
            "action": "KILL_RUN",
            "enabled": True,
        },
        {
            "name": "Budget Exceeded",
            "plugin": "budget_exceeded",
            "config": {"budget_limit": 5.0},
            "severity": "CRITICAL",
            "action": "KILL_RUN",
            "enabled": True,
        },
        {
            "name": "Latency Spike Detection",
            "plugin": "latency_spike",
            "config": {"max_duration_seconds": 5},
            "severity": "HIGH",
            "action": "TRIGGER_FALLBACK",
            "enabled": True,
        },
        {
            "name": "Tool Timeout",
            "plugin": "tool_timeout",
            "config": {"max_timeout_seconds": 10},
            "severity": "HIGH",
            "action": "ALERT",
            "enabled": True,
        },
    ]

    for rule in rules:
        result = _api_post("/api/v1/vigil/governance/rules", rule)
        if "error" in result:
            logger.warning(f"  Failed to create rule '{rule['name']}': {result['error']}")
        else:
            logger.info(f"  Created rule: {rule['name']}")


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def main():
    logger.info("=" * 60)
    logger.info("VIGIL Demo Seed")
    logger.info(f"API URL: {API_URL}")
    logger.info("=" * 60)

    if not wait_for_api():
        sys.exit(1)

    logger.info("")
    seed_cost_policies()
    logger.info("")
    seed_governance_rules()
    logger.info("")
    logger.info("Seeding complete!")


if __name__ == "__main__":
    main()
