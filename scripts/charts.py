#!/usr/bin/env python3
"""Draws the README charts as SVG from the measured files, so every bar traces to a
source: docs/measurements.md (scripts/measure.py) and docs/ablation.json
(scripts/ablation.py). No dependencies.

    python3 scripts/charts.py            # writes docs/img/chart-*.svg
"""
import json, os, re
from xml.sax.saxutils import escape

ROOT = os.path.join(os.path.dirname(__file__), "..")
IMG = os.path.join(ROOT, "docs", "img")
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif"
INK, INK2, MUTED, LINE, CARD = "#14100d", "#5e544b", "#6b6158", "#e6ded2", "#ffffff"
# The dashboard's verdict map (frontend/src/lib/verdict.ts): fill, text on it, label.
VERDICT = {
    "deny": ("#ff6b00", INK, "Blocked"),
    "ask": ("#8a5a12", "#ffffff", "Paused"),
    "rewrite": ("#2c76b0", "#ffffff", "Rewritten"),
    "allow": ("#15803d", "#ffffff", "Allowed (earned)"),
    "prompt": ("#f1ede7", INK2, "No opinion"),
}


def t(x, y, s, size=13, weight=400, fill=INK, anchor="start", family=FONT):
    return f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}">{escape(str(s))}</text>'


def card(w, h, body, title, sub, source):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{escape(title)}">'
            f'<rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="14" fill="{CARD}" stroke="{LINE}"/>'
            + t(28, 42, title, 19, 700) + t(28, 66, sub, 13, 400, INK2) + body
            + t(28, h - 20, source, 11.5, 400, MUTED) + "</svg>")


def pill(x, y, verdict, w=150):
    fill, ink, label = VERDICT[verdict]
    stroke = f' stroke="{LINE}"' if verdict == "prompt" else ""
    return (f'<rect x="{x}" y="{y}" width="{w}" height="28" rx="7" fill="{fill}"{stroke}/>'
            + t(x + w / 2, y + 19, label, 13, 600, ink, "middle"))


def ablation():
    d = json.load(open(os.path.join(ROOT, "docs", "ablation.json")))
    rows = d["rows"]
    ok = lambda r, k: (r[k] == "rewrite") if r["expected"] == "rewrite" else r[k] in ("deny", "ask", "rewrite")
    g = sum(ok(r, "with_graph") for r in rows)
    n = sum(ok(r, "without_graph") for r in rows)
    W, top, rh = 900, 170, 46
    H = top + rh * len(rows) + 64
    cx1, cx2 = 545, 712
    b = [t(28, 112, f"{g} of {len(rows)}", 34, 800, "#c2410c"), t(28, 136, "handled as expected with the graph", 13, 500, INK2),
         t(300, 112, f"{n} of {len(rows)}", 34, 800, MUTED), t(300, 136, "with the graph unplugged", 13, 500, INK2),
         t(cx1 + 75, top - 12, "With the graph", 13, 700, INK, "middle"), t(cx2 + 75, top - 12, "Without the graph", 13, 700, INK, "middle")]
    for i, r in enumerate(rows):
        y = top + i * rh
        b.append(f'<line x1="28" x2="{W-28}" y1="{y}" y2="{y}" stroke="{LINE}"/>')
        b.append(t(28, y + 28, r["attack"], 13.5, 500))
        b.append(pill(cx1, y + 9, r["with_graph"]))
        b.append(pill(cx2, y + 9, r["without_graph"]))
    svg = card(W, H, "".join(b), "Remove the graph and these attacks get through",
               "The same attacks through the real Claude Code hook, against VIGIL with FalkorDB and with the database unreachable.",
               f"Source: docs/ablation.json, scripts/ablation.py, run {d['run']} on {d['date']}, FalkorDB {d.get('falkordb', '?')}. \"No opinion\": the harness asks as usual.")
    open(os.path.join(IMG, "chart-ablation.svg"), "w").write(svg)


def measurements():
    m = open(os.path.join(ROOT, "docs", "measurements.md")).read()
    run = re.search(r"run id\s+(\S+)", m).group(1)
    date = re.search(r"date\s+(\d{4}-\d{2}-\d{2})", m).group(1)
    hook = re.search(r"PreToolUse hook round trip[^|]*\|\s*(\d+)\s*\|\s*([\d.]+) ms\s*\|\s*([\d.]+) ms", m)
    graph = re.search(r"Graph time per decision[^|]*\|\s*(\d+)\s*\|\s*([\d.]+) ms\s*\|\s*([\d.]+) ms", m)
    src = f"Source: docs/measurements.md, scripts/measure.py run {run} on {date}, FalkorDB 6.0.2 (docker compose, one laptop, localhost)."

    # Latency: two measures, p50 and p99, on one linear axis.
    W, x0, x1 = 900, 300, 770
    vmax = 14.0
    sx = lambda v: x0 + (x1 - x0) * v / vmax
    b = []
    for v in range(0, 15, 2):
        b.append(f'<line x1="{sx(v)}" x2="{sx(v)}" y1="98" y2="290" stroke="{LINE}"/>' + t(sx(v), 312, f"{v} ms", 11.5, 400, MUTED, "middle"))
    bars = [("Graph time per decision", graph, "#ff6b00", f"{graph.group(1)} decisions"),
            ("Full hook round trip", hook, "#8f8478", f"{hook.group(1)} calls, client side")]
    y = 112
    for label, mm, color, note in bars:
        b.append(t(28, y + 24, label, 14, 600) + t(28, y + 44, note, 12, 400, MUTED))
        for j, (q, v) in enumerate((("p50", float(mm.group(2))), ("p99", float(mm.group(3))))):
            yy = y + j * 30
            op = "1" if q == "p50" else "0.45"
            b.append(f'<rect x="{x0}" y="{yy+4}" width="{max(2, sx(v)-x0)}" height="20" rx="4" fill="{color}" fill-opacity="{op}"/>')
            b.append(t(sx(v) + 8, yy + 19, f"{q} {v:g} ms", 12.5, 600, INK))
        y += 90
    open(os.path.join(IMG, "chart-latency.svg"), "w").write(
        card(W, 368, "".join(b), f"{float(graph.group(2)):g} ms of graph time per decision, at the median",
             "Every decision walks the agent's history in FalkorDB. Median and 99th percentile.", src))

    # Benign day: one stacked bar of 390 calls.
    counts = dict(re.findall(r"^\|\s*(deny|ask|rewrite|allow|prompt)\s*\|\s*(\d+)\s*\|", m, re.M))
    counts = {k: int(v) for k, v in counts.items()}
    total = sum(counts.values())
    W, x0, x1 = 900, 28, 872
    b, x = [], x0
    order = ["allow", "prompt", "ask", "rewrite", "deny"]
    for k in order:
        c = counts.get(k, 0)
        if not c:
            continue
        w = (x1 - x0) * c / total
        fill = VERDICT[k][0]
        b.append(f'<rect x="{x}" y="96" width="{w-2}" height="40" rx="6" fill="{fill}"{" stroke=%s" % repr(LINE) if k == "prompt" else ""}/>')
        b.append(t(x + 12, 121, f"{c}  {VERDICT[k][2] if k != 'prompt' else 'Normal prompt'}", 14, 700, VERDICT[k][1]))
        x += w
    stops = counts.get("deny", 0) + counts.get("ask", 0)
    b.append(t(28, 172, f"{stops} of {total}", 30, 800, "#15803d") + t(28, 196, "benign calls wrongly blocked or paused", 13, 500, INK2))
    b.append(t(360, 172, f"{counts.get('allow', 0)} of {total}", 30, 800, INK) + t(360, 196, "ran without a prompt: autonomy earned from clean history", 13, 500, INK2))
    open(os.path.join(IMG, "chart-benign.svg"), "w").write(
        card(W, 240, "".join(b), "A normal developer day gets through untouched",
             f"30 sessions of ls, git, reads, edits, go test, a docs fetch and two installs: {total} calls through the hook.", src))


if __name__ == "__main__":
    ablation()
    measurements()
    print("wrote", ", ".join(f for f in sorted(os.listdir(IMG)) if f.startswith("chart-")))
