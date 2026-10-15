# Graph Hacks Submission: The Idea

Oct 15, 2026 · @Arpit

## Thesis

**An agent firewall whose memory is a graph.** It intercepts every tool call an AI agent makes, remembers every decision, every tool's history and every provenance chain across sessions and across agents, and grants autonomy only to the extent the graph can prove it is safe.

**The 60-second pitch.** AI agents now delete drives, burn $6,000 overnight, and install malware from poisoned skills. The only controls people have are "approve every call" (unusable) or "skip all permissions" (how the drive gets wiped). Every firewall shipped so far decides one call at a time and forgets it. Ours stores the agent's entire history as a graph in FalkorDB. Trust is computed from that graph, not configured: an agent earns autonomy by accumulating clean, provable history, and loses it the moment a tool changes, a credential flows toward the network, or a new package appears. Because the graph persists across sessions and is shared across tenants, it catches attacks that span days and agents, and one tenant's block protects every other tenant within seconds.

**One-line gap statement.** The best runtime defenses in the literature (PACE, AGATE, PPMF) build a provenance graph and then throw it away at the end of the episode. The best commercial products (Zenity, AIR, Kontext) sit at the enterprise perimeter and never see the developer's terminal. Nobody has made the graph the persistent, shared, queryable brain of the firewall. That is the whole idea.

**Working name.** The current name, VIGIL, is already used by two 2026 arXiv papers in this exact space. Pick a new one before submitting (candidates: Keel, Tether, Ledger); search arXiv and GitHub for ten minutes before committing.

## The problem, with evidence

The pain is public, repeated, and expensive. Four failure modes dominate, and one behavioral root cause connects them.

| Failure mode | What happened | Source |
| --- | --- | --- |
| Destructive actions | Claude Code deleted 48,218 files from a live project tree in 103 seconds | [TechRadar](https://www.techradar.com/ai-platforms-assistants/do-not-let-programs-run-commands-on-your-machine-claude-code-allegedly-deleted-48-000-files-in-103-seconds-and-its-a-terrifying-warning-about-ai-agents) |
| Destructive actions | Claude Opus 5 wrote a backup to the wrong directory, then ran rm -rf on the real drive; 2,300+ upvotes on r/ClaudeCode | [explainx](https://explainx.ai/blog/claude-code-rm-rf-reddit-incident-sandbox-guide-august-2026) |
| Runaway cost | One developer burned \~$6,000 of Claude usage overnight with one command; everyone in the thread had a similar story | [devtoolpicks](https://devtoolpicks.com/blog/ai-agents-runaway-claude-code-bills-overnight-2026) |
| Runaway cost | A LangChain 4-agent loop cost $47K over 11 days with nobody noticing; a Claude sub-agent loop burned 4M tokens in 5 minutes | [loopguard](https://pkg.go.dev/github.com/loop-eng/loopguard), [techtrenches](https://techtrenches.dev/p/the-slot-machine-that-codes) |
| Supply chain | ClawHavoc put 1,184 malicious skills on OpenClaw's registry, about 20% of the marketplace, delivering Atomic macOS Stealer; 1,400+ by April | [Hive Security](https://hivesecurity.gitlab.io/blog/openclaw-ai-agent-security-crisis-2026/), [betterclaw](https://www.betterclaw.io/blog/openclaw-security-2026) |
| Supply chain | MCP tool poisoning succeeds on over 60% of attempts across major agents, 72% on some models; OWASP codified it as MCP03:2025 | [itecs](https://itecsonline.com/post/mcp-tool-poisoning-enterprise-ai-agent-security-2026), [CSA](https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-ai-agent-exfiltration-2/) |
| Rug pulls | MCP has no content-addressing or version pinning for tool descriptions; a server audited at t0 can behave differently at t1 | [TrueFoundry](https://www.truefoundry.com/blog/blog-mcp-tool-poisoning-gateway-defense) |
| Memory poisoning | LLM memory consolidation rewrites an untrusted web instruction into something that reads like a user workflow rule, upgrading its authority | [PPMF, arXiv 2607.29167](https://arxiv.org/abs/2607.29167) |
| Enterprise blocker | 88% of enterprises with agent initiatives never ship to production; Gartner expects 40%+ of agentic projects canceled by 2027 | [Yahoo Finance](https://finance.yahoo.com/technology/ai/articles/enterprise-ai-agent-funding-surges-093104627.html) |

**The root cause is permission fatigue.** Claude Code asks before every impactful action, so people run `claude --dangerously-skip-permissions`, and the standard advice becomes "only use it on a machine you don't care about" ([Substack](https://dominiksnotebook.substack.com/p/if-youre-a-beginner-with-claude-code)). The two options on the market are *approve everything by hand* or *approve nothing*. Nobody sells the middle: autonomy that is earned by evidence and revoked by evidence.

**The interception point already exists.** Claude Code's PreToolUse hook receives every tool call before execution and can block it with an exit code ([dev.to](https://dev.to/krishna_newark/ai-coding-agents-can-run-rm-rf-on-your-machine-heres-how-to-stop-them-32m)). Cursor, OpenClaw and every MCP client offer an equivalent gateway. The hook is solved; what is missing is the brain behind it.

**What each slice of the problem costs today.** Destructive actions cost hours to days of lost work. Runaway cost is $47 to $47,000 per incident. A poisoned skill is a stolen credential or a stolen wallet. A canceled enterprise agent program is a wasted budget line. None of these are vitamins.

## Why existing solutions fail

The category is funded and crowded, yet every player keeps a gap we can occupy: commercial tools stop at the enterprise perimeter, and research systems forget everything when the episode ends.

**Commercial landscape.** Between April and September 2026 investors put $435M into 12 agent-security financings ([Yahoo Finance](https://finance.yahoo.com/technology/ai/articles/enterprise-ai-agent-funding-surges-093104627.html)).

| Player | Round | What it does | Gap we exploit |
| --- | --- | --- | --- |
| [Zenity](https://www.securityweek.com/ai-agent-firewall-startup-air-security-emerges-from-stealth-with-50-million/) | $125M Series C | Monitors agent actions, can block deviations from intent | Does not secure MCP tool execution or the runtime API calls agents make ([Akto](https://www.akto.io/alternatives/zenity-alternatives)); enterprise-only |
| [AIR Security](https://www.securityweek.com/ai-agent-firewall-startup-air-security-emerges-from-stealth-with-50-million/) | $50M seed (Sequoia) | Pre-runtime vetting of skills, plugins, MCP servers | Vetting before admission is provably insufficient (PACE, below); rug pulls happen after vetting |
| [Kontext](https://www.securityweek.com/kontext-security-emerges-with-4-million-for-ai-agent-runtime-controls/) | $4M seed | Connects identity, task context and policy before an action | Per-call decision, no persistent memory, no cross-agent state |
| MCP gateways (Lasso, Natoma, Operant) | various | Proxy between client and MCP servers | Govern tool access but do not inspect the reasoning that drives tool selection ([TrueFoundry](https://www.truefoundry.com/blog/enterprise-ai-agent-security-solutions)) |
| OSS hooks: agentguard, loopguard, agentburn | none | Pattern-block commands, circuit-break loops, audit cost | One slice each; stateless; nothing shared; prove bottom-up demand exists |

**Academic prior art.** Seventeen 2026 papers sit near this idea. The three closest:

| Paper | Core mechanism | What it does not do |
| --- | --- | --- |
| [PACE](https://arxiv.org/abs/2610.01349) (Oct 1, 2026) | Proves admission-time vetting cannot distinguish a safe from a leaking artifact; builds an episode provenance graph and min-cuts influence paths at the last tool boundary; lowest attack success in 62 of 79 benchmark columns | Graph is per-episode, in-process. Forgets when the episode ends |
| [AGATE](https://arxiv.org/abs/2609.30830) (Sep 25, 2026) | Deterministic gate with consumable grants, source registration, effect ledger; adapters for DeepSeek Harness, OpenCode, OpenClaw; projects evidence to a graph with READS/WRITES/PRECEDES edges | States outright that the graph store is not the dispatch queue. The graph is forensic, after the fact. It never decides |
| [PPMF](https://arxiv.org/abs/2607.29167) (Jul 2026) | Trust lattice EXTERNAL < TOOL < USER\_HISTORY < USER\_CONFIRMED; a memory inherits no more authority than its least-trusted source; a gate matches action risk to memory authority; 0.000 attack success with 1.000 benign success | Evaluated as in-process middleware. No persistent store, no cross-session or cross-tenant state |

Also near: AuthGraph (dual authorization and provenance graphs), IPIGuard (tool dependency graph), NOMOS (policies compiled to static gates), VEPA (Google, evolving formal policies), Agent-Warden (eBPF file provenance), and two papers named VIGIL ([Jan 2026](https://www.alphaxiv.org/abs/2601.05755), [Jun 2026](https://www.alphaxiv.org/abs/2606.26524)).

**The precise gap.** Every one of these keeps its graph inside one process and one episode. None has (a) memory across sessions, (b) shared state across agents or tenants, (c) a persisted provenance-authority lattice, or (d) a live database that can answer "has this ever happened before." That is exactly the FalkorDB brief, and the field has not built it.

## The idea: five pillars on one graph

The firewall keeps the behavior people already like in VIGIL (interception, ALLOW / PAUSE / BLOCK / FALLBACK, cost engine, dashboard, hash-chained audit) and moves every decision onto a FalkorDB graph that persists across sessions and is shared across agents. A model is consulted only when the graph has no path.

**Pillar 1: Earned autonomy.** Trust is a computed property of the graph, not a config file. Every clean completion is an edge of evidence: `(:Agent)-[:EXECUTED {ok:true}]->(:Tool)` two hundred times in this repo with zero incidents earns an auto-ALLOW for that tool in that scope. A new tool, a new repo, a new argument shape, or any incident resets trust and prompts return. This is the direct answer to permission fatigue: the reward for keeping the firewall on is fewer interruptions every week.

**Pillar 2: Persistent provenance-authority lattice.** Every `(:Fact)` and `(:Memory)` node carries `trust` in {EXTERNAL, TOOL, USER\_HISTORY, USER\_CONFIRMED} and a `DERIVED_FROM` edge to its sources. The authority of any derived node is the minimum over its ancestors, one path query. An action of risk R needs a supporting path whose minimum trust is at least R. A memory can never launder its origin because the graph remembers where every fact came from. The paper that invented the lattice ran it as middleware; we persist it.

**Pillar 3: Cross-session compositional attack detection.** A credential read in session 3 and sent out in session 7 is invisible to per-episode systems. Here it is one variable-length path: `(:Value {sensitive:true})<-[:READ]-(:Call)` ... `(:Call)-[:ARG_CONTAINS]->(:Value)-[:EGRESS]->`. The session boundary is just another edge.

**Pillar 4: Tool and package memory.** Every MCP tool description ever seen is a hashed `(:ToolVersion)` with `SUPERSEDES` edges. A description that changes between sessions is a rug pull: flagged, and the tool's earned trust from Pillar 1 is revoked automatically. The package graph (`DEPENDS_ON`, `MAINTAINS`, `TYPOSQUAT_OF`) answers blast radius and maintainer risk with FalkorDB's built-in algorithms (reverse closure, PageRank, centrality) before any install runs.

**Pillar 5: Herd immunity across tenants.** One graph per tenant via FalkorDB multigraph, plus one shared `threat_intel` graph. When tenant A blocks a poisoned tool hash or a typosquat, an anonymized signal (hash, never content) lands in the shared graph and every other tenant inherits the block within seconds. The more agents behind the firewall, the smarter it gets. This is the network effect that turns a tool into a company.

**Removal test.** Unplug FalkorDB and the firewall cannot evaluate intent, cannot compute trust, cannot detect drift, cannot check blast radius, and has no memory. The graph is the product.

&#91;embedded content: runtime architecture: hook, five graph engines, per-tenant graph, shared threat graph, model as fallback\]

Every tool call passes the hook, is judged by five Cypher-backed engines against the tenant's graph, and reaches the tool only on ALLOW; the shared threat graph syncs blocks between tenants, and the model layer is reached only when no path resolves the question.

## Painkiller, not vitamin

Each user segment has a wound they already pay for, and the graph closes it in a way the current fix cannot.

| Who hurts | Today's workaround | What it costs them | What the graph changes |
| --- | --- | --- | --- |
| Solo developer running Claude Code or Cursor | `--dangerously-skip-permissions` plus a VM they don't care about ([Substack](https://dominiksnotebook.substack.com/p/if-youre-a-beginner-with-claude-code)) | A wiped drive, 48k lost files, or a $6,000 overnight bill | Earned autonomy: prompts fade as clean history accumulates, return the instant anything new or risky appears |
| Team running agents overnight or in CI | Hard `max_budget_usd`, which overshoots by 8x, and hand-written deny lists | $1,800 to $47,000 loop incidents; retry storms nobody sees | Behavior graph flags the self-loop (`search_code x19`) by edge weight; cost engine projects breach from the same graph |
| Anyone installing skills or MCP servers | Trust the marketplace; VirusTotal scanning after upload | 20% of a registry malicious; stealers in SKILL.md; rug pulls after audit | Tool versions hashed and remembered; a changed description revokes trust; package graph blocks typosquats and shows blast radius before install |
| Platform teams with many agents | Per-agent config, no shared memory, no cross-agent view | A credential read by agent A and exfiltrated by agent B is invisible | One graph per tenant, shared state between agents, cross-session path queries |
| Enterprise security buyer | Zenity-class posture tools, MCP gateways | 88% never ship to production; auditors want a *why* for every action | Every decision carries the literal graph path that justified it; the audit is a hash-chained graph |

**The painkiller test.** A painkiller is bought on the day of the wound. The wounds above are posted on Reddit weekly with dollar amounts attached. The product installs in one line at the exact moment someone has just lost files or money, starts in observe mode so it never blocks on minute one, and shows within a day what it would have stopped.

## Uniqueness and defensibility

Five capabilities exist nowhere else in combination, and three of them compound into a moat that gets stronger with every user.

| Capability | Commercial tools | Research systems | This product |
| --- | --- | --- | --- |
| Decides every call before execution | Zenity, Kontext, gateways | PACE, AGATE, ActGov | Yes |
| Provenance graph behind each decision | No | PACE, AGATE (per episode) | Yes, persisted |
| Memory across sessions | No | No | Yes |
| Shared state across agents and tenants | No | No | Yes (multigraph) |
| Trust lattice on memory, persisted | No | PPMF (middleware only) | Yes |
| Trust earned from history, revoked by change | No | No | Yes |
| Tool-description rug-pull memory | AIR vets once | No | Yes (hashed ToolVersion) |
| Cross-tenant threat sharing | No | No | Yes |
| One-line install for an individual developer | No (enterprise contracts) | No (benchmarks) | Yes (hook + Docker) |

**Why the graph makes these possible.** Each row above is a path query. "Has this agent done this safely before" is a count of EXECUTED edges. "Did a sensitive value reach the network" is a variable-length path. "What is the minimum trust behind this fact" is a reduce over DERIVED\_FROM ancestors. "Has any tenant seen this hash" is a lookup in the shared graph. Vector stores cannot say no; a property graph returns zero rows, which is the abstention the earlier prototype measured at 56% and could never fix.

**The moat.** Three effects compound:

1. **Data moat.** Every day the firewall runs it accumulates clean-history edges that are impossible to fake and expensive to rebuild. Switching cost rises with tenure.
2. **Network moat.** The shared threat graph means the thousandth tenant is protected by the first 999. A competitor starting later has an emptier graph.
3. **Autonomy moat.** Earned trust is the feature users feel every day (fewer prompts). It is also the feature that cannot exist without the history, so it cannot be copied by a stateless competitor.

**What this is not.** It is not a prompt-injection classifier, not a sandbox, and not a model-routing layer. Those compose with it. The claim is narrower and harder to copy: the graph is the firewall's memory and its judge.

## Graph data model and core Cypher

One graph per tenant (`tenant_<id>`), one shared graph (`threat_intel`). The rules require the data model and the Cypher in the README; this is the first draft of both.

**Nodes**

| Label | Key properties | Meaning |
| --- | --- | --- |
| Agent | id, harness | A running agent identity |
| Session | id, started\_at | One run of an agent |
| Call | id, ts, args\_hash, decision | One intercepted tool call |
| Tool | name | A tool the agent can invoke |
| ToolVersion | hash, description, seen\_at | One version of a tool's description |
| Capability | name, risk | read, write, exec, network, secrets |
| Intent | text, declared\_at | Operator-declared objective |
| Value | hash, sensitive | A value that flowed through a call |
| Fact | text, trust, valid\_from, valid\_to | A remembered claim with authority |
| Decision | id, verdict, reason, hash, prev\_hash | Firewall verdict, hash-chained |
| Package | name, ecosystem | A dependency |
| Maintainer | id | A package maintainer |
| Repo | id | Scope in which trust is earned |

**Edges**: `RAN` (Agent to Session), `MADE` (Session to Call), `INVOKED` (Call to Tool), `REQUIRES` (Tool to Capability), `DECLARED` (Session to Intent), `ALLOWS` / `DENIES` (Intent to Capability), `READ` / `ARG_CONTAINS` / `EGRESS` (Call to Value), `DERIVED_FROM` (Fact to Fact or Value), `THEN {count, p}` (Tool to Tool, per Agent and Repo), `SUPERSEDES` (ToolVersion to ToolVersion), `DEPENDS_ON` (Package to Package), `MAINTAINS` (Maintainer to Package), `TYPOSQUAT_OF` (Package to Package), `DECIDED` (Call to Decision), `PREV` (Decision to Decision).

**The ten queries the product runs on**

1. Intent check: a path from the session's intent to the tool's capability.

```
MATCH (s:Session {id:$sid})-[:DECLARED]->(i:Intent)
MATCH (t:Tool {name:$tool})-[:REQUIRES]->(c:Capability)
OPTIONAL MATCH (i)-[d:DENIES]->(c)
OPTIONAL MATCH (i)-[a:ALLOWS]->(c)
RETURN c.name AS cap, d IS NOT NULL AS denied, a IS NOT NULL AS allowed
```

2. Earned autonomy: clean executions of this tool by this agent in this repo, and any incident.

```
MATCH (a:Agent {id:$aid})-[:RAN]->(:Session)-[:MADE]->(k:Call)-[:INVOKED]->(t:Tool {name:$tool})
WHERE k.repo = $repo
RETURN count(CASE WHEN k.decision='ALLOW' AND k.ok THEN 1 END) AS clean,
       count(CASE WHEN k.incident THEN 1 END) AS incidents
```

3. Provenance authority: minimum trust across every ancestor of a fact.

```
MATCH (f:Fact {id:$fid})-[:DERIVED_FROM*0..]->(src)
RETURN min(src.trust_rank) AS authority
```

4. Cross-session exfiltration: a sensitive value read earlier now bound to an egress call.

```
MATCH (v:Value {sensitive:true})<-[:READ]-(k1:Call)
MATCH (k2:Call {id:$call})-[:ARG_CONTAINS]->(v2:Value)
WHERE v2.hash = v.hash OR (v2)-[:DERIVED_FROM*1..3]->(v)
MATCH p = (k1)-[*]-(k2)
RETURN p LIMIT 1
```

5. Behavioral drift: transition weight for the proposed step.

```
MATCH (prev:Tool {name:$last})-[r:THEN {agent:$aid, repo:$repo}]->(next:Tool {name:$tool})
RETURN coalesce(r.p, 0.0) AS p, coalesce(r.count, 0) AS n
```

6. Rug pull: has this tool's description changed since it earned trust.

```
MATCH (t:Tool {name:$tool})-[:HAS_VERSION]->(v:ToolVersion)
WITH t, v ORDER BY v.seen_at DESC LIMIT 2
WITH t, collect(v.hash) AS hs
RETURN size(hs) = 2 AND hs[0] <> hs[1] AS changed
```

7. Typosquat and blast radius for an install.

```
MATCH (p:Package {name:$pkg})
OPTIONAL MATCH (p)-[:TYPOSQUAT_OF]->(real:Package)
OPTIONAL MATCH (p)<-[:DEPENDS_ON*1..4]-(dep:Package)
RETURN real.name AS squats, count(DISTINCT dep) AS blast_radius
```

8. Maintainer risk via a built-in algorithm (PageRank over MAINTAINS and DEPENDS\_ON).
9. Shared threat lookup in `threat_intel`: `MATCH (h:Hash {value:$hash}) RETURN h.kind, h.first_seen, h.tenants`.
10. Audit integrity: walk the Decision chain and compare each `prev_hash` to the predecessor's `hash`.

Every query is parameterized, tested against FalkorDB 6.0, and returns the path it used so the dashboard can render it.

## Track mapping

One system, three entries, each backed by a layer judges can inspect in the README. Track 1 and Track 2 are the strongest; Track 3 is entered only if the identity layer works in the demo.

| Track | Brief's key focus | What this project shows | Strength |
| --- | --- | --- | --- |
| 01 Agents that act on connected data (iPhone 18 Pro) | Multi-hop reasoning, graph algorithms as tools, MCP tool selection, actions from the graph, explainable results | Blast radius, typosquat and maintainer PageRank decide an install; cross-session exfil path blocks a network call; every verdict renders its path; built-in algorithms exposed as MCP tools | Strongest. The brief literally lists "triage security findings" |
| 02 Agent memory and coordination (PS5) | Episodic, semantic, procedural memory; persistent history; shared state and handoffs; high-concurrency reads and writes; separate memory per tenant | Episodic = Decision and Call history; semantic = Facts with trust and validity; procedural = policies promoted after human approval; triage, investigator and critic agents hand off through shared graph state; a firewall is high concurrency by nature; multigraph per tenant; kill and restart demo | Strong. Concurrency and tenancy are the architecture, not a checkbox |
| 03 Company brain (Mac Mini) | Knowledge from docs, tickets, chats; who owns what; decisions traced to source; current as things change; answers with sources | The Northwind identity graph (Person, SAME\_AS, IS\_A EntityType, Policy DENIES EntityType) is the company brain the firewall consults: "share with Jordan" blocks because Jordan resolves to a Customer | Defensible but narrower than a dedicated entry; include only if it costs nothing |

**Side prizes.** The blog post (AirPods 5) writes itself: "We moved from a managed auto-extraction graph to Cypher we wrote, and abstention went from 56% to 100% because a property graph can say no." The top-50 t-shirt follows from any complete, working, documented submission.

## Market, business model and the investor case

Agent governance is the most-funded slice of AI safety in 2026, and the money is going to companies that look like control planes. The open position is the bottom-up developer wedge that grows into the enterprise control plane through shared state.

**Market signal.** Agent security and governance took $435M across 12 rounds from April to September 2026; Q3 2026 saw $1.32B across 20 agent-platform rounds ([Yahoo Finance](https://finance.yahoo.com/technology/ai/articles/enterprise-ai-agent-funding-surges-093104627.html), [tracker](https://aiforbusinessautomation.com/ai-agent-platform-startup-funding/)). Investors fund companies positioned to own a control plane, an authorization layer, or an agent-governance system ([funding trends](https://newmarketpitch.com/blogs/news/ai-safety-funding-trends)). Enterprises will not deploy agents without audit logs and access controls, which is the demand behind every recent round.

**Go-to-market in three stages**

| Stage | Who | Entry | Revenue |
| --- | --- | --- | --- |
| 1. Individual developer | Claude Code, Cursor, OpenClaw users who just lost files or money | `npx <name> init`, local FalkorDB in Docker, observe mode first | Free. The graph they build is the switching cost |
| 2. Team | Platform engineers with several agents and a shared repo | Shared FalkorDB instance, one graph per repo or team, policy promotion with human approval | Per-seat. Shared history and the cross-agent view are the paid features |
| 3. Enterprise | Security buyers who need audit and tenancy | Multigraph per business unit, shared threat graph, SSO, retention | Platform contract. Herd immunity and compliance evidence are the moat |

**Why an investor says yes.** The category is validated by Sequoia, Norwest and a16z checks. The wedge is bottom-up where the incumbents are top-down. The product has a data moat (history), a network moat (shared threat graph), and a daily-felt feature (earned autonomy) that stateless competitors cannot copy. The founding story is a hackathon-born open-source tool with real adoption numbers, which is how Vercel, Supabase and Snyk started.

**Why an investor says no, and the answer.** "Anthropic or OpenAI will build this into the harness." The harnesses expose hooks precisely because they do not want to own the policy; and no single vendor can own the cross-harness, cross-tenant graph. "It is a feature of Zenity." Zenity does not touch MCP execution or the developer's terminal, and a perimeter product cannot earn per-developer trust. "Security tools get uninstalled." This one reduces prompts the longer it stays, which inverts the usual churn.

## Adoption and retention mechanics

A security tool that gamifies itself gets uninstalled. The retention loops below are real product value that happen to feel rewarding; streaks and badges are left out on purpose.

**Install path (build this first, not last)**

1. `npx <name> init` writes a Claude Code `PreToolUse` hook and an MCP gateway entry for Cursor or OpenClaw.
2. FalkorDB starts locally in Docker with a persistent volume, or the hook points at a shared instance.
3. First run is observe mode: nothing is blocked, the graph fills for a day.
4. Day two shows "here is what I would have blocked, here is the autonomy you have earned," and the user turns enforcement on.

**Retention loops**

| Loop | What the user feels | Why it is real value |
| --- | --- | --- |
| Autonomy level | Fewer permission prompts each week as clean history accumulates; a visible level that rises | It is the product's core promise and only exists because of the history |
| Weekly digest | "Blocked 3 typosquats, projected $212 of runaway cost avoided, 0 incidents, 19 days" | Makes invisible protection visible; the number people screenshot |
| Blast-radius preview | Before approving a PAUSE, see what the install or command would touch | Turns an annoying prompt into an informed decision |
| Shared threat feed | What other tenants caught this week, anonymized | Social proof that the network is working for them |
| Earned-trust revocation notices | "Tool X changed its description; trust reset" | Shows the firewall catching what no human would notice |

**What to refuse.** No streak counters, no badges, no leaderboards. A developer who sees a game in their security tool stops trusting it. The autonomy level is the only "score," and it is tied to real behavior in both directions.

## Demo, blog post and README

The demo is one story in six beats, each beat is a Cypher query the judges can read, and the README is the deliverable the rules actually grade.

**The 3-minute demo**

1. An agent starts a task. The dashboard shows earned autonomy: 40 tools auto-allowed from history, zero model calls so far.
2. The agent reads `.env` in session 3. An hour later, in session 7, it tries `dns_update` with a value derived from it. The cross-session path lights up on screen and the call is BLOCKED, with the `READ ... ARG_CONTAINS ... EGRESS` path rendered.
3. An MCP tool's description silently changes. The graph diffs the `ToolVersion`, trust is revoked, the next call is PAUSED with the diff shown.
4. `pip install reqeusts`. The typosquat edge and the reverse-dependency blast radius appear; BLOCKED before the install runs.
5. A second tenant's agent hits the same package. Already blocked via the shared threat graph, zero model calls, under a millisecond.
6. Kill every process. Restart. The graph remembers all of it; the agent's autonomy level is unchanged.

**The blog post (AirPods 5).** Title: "Our firewall could not say no." The arc: the earlier prototype measured 56% abstention because a vector ranker always returns its best guess; moving to an explicit property graph made absence a count of zero; the same move gave the firewall a memory, and the memory gave it a network. End with the Cypher.

**README must-haves (Rules 10 to 13)**

- [ ] Public repo with commit history starting Oct 15, 2026
- [ ] "Built during Graph Hacks" section listing every new module
- [ ] Graph data model diagram and the node and edge table above
- [ ] Every Cypher query the product depends on, parameterized, with the engine that calls it
- [ ] The removal-test paragraph: what stops working without FalkorDB
- [ ] Related work paragraph citing PACE, AGATE, PPMF, AuthGraph and stating the gap
- [ ] Per-step traversal latency measured on FalkorDB 6.0, and the fraction of decisions that never touched a model
- [ ] AI-assistance disclosure
- [ ] Demo video link, live deployment, local setup with `docker compose`
- [ ] Tracks entered, named explicitly

## Risks, honest limits, and what to cut

The idea is strong; the risks are in execution and in claiming more than the graph can prove.

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Name collision | Two 2026 arXiv papers are called VIGIL; judges who search will assume it was borrowed | Rename before submission |
| Graph as decoration | Rule 3 disqualifies a product that still works without FalkorDB; the current README advertises exactly that | Move intent, trust, provenance, behavior and audit into the graph; write the removal-test paragraph |
| Recycled project | Rules 8 and 9 and the FAQ require the FalkorDB implementation to be new work | Clean commit history from Oct 15; explicit "built during" section; Impact Forge and Featherless framing removed |
| Scope across three tracks | A broken third layer hurts the other two | Build Track 1 and 2 fully first; add Track 3 only if the identity graph works in the demo |
| Cypher dialect | LLM-generated Cypher often uses Neo4j procedures FalkorDB lacks | Test every query on FalkorDB 6.0; file engine bugs on GitHub and cite them |
| Free Cloud tier | No persistence; idle instances deleted; a memory demo would vanish | Docker with a persistent volume on Railway or a VPS |
| Content rewriting evades provenance | AGATE observed a parameter-rewriting bypass; PACE excludes paraphrase | State it as a known limit; hash derived values at 1 to 3 hops, not infinitely |
| Benign denials | AGATE saw denials in 6 of 11 benign file tasks | Observe mode first; earned trust reduces false blocks over time; measure and report the rate |
| Metadata forgery | PPMF shows the lattice fails if trust labels can be forged | Trust labels written only by the hook, never by the model; hash-chained |

**What the graph cannot do.** It cannot see inside a tool that makes hidden secondary calls. It cannot catch a paraphrased secret. It cannot stop a compromised host that rewrites the graph. Say all three in the README; judges from a database company respect stated limits more than claimed guarantees.

**Cut list.** The 43k-model and Featherless-centric narrative; the NVIDIA and Gemini vendor-chain findings; the Impact Forge section; `mode=thinking` latency tables (replace with per-step traversal latency); any streak or badge mechanic.

## References

**Hackathon**: [overview and FAQ](https://www.wemakedevs.org/hackathons/falkordb), [rules](https://www.wemakedevs.org/hackathons/falkordb/rules), [resources](https://www.wemakedevs.org/hackathons/falkordb/resources).

**Incidents and developer pain**: [TechRadar: 48,000 files deleted](https://www.techradar.com/ai-platforms-assistants/do-not-let-programs-run-commands-on-your-machine-claude-code-allegedly-deleted-48-000-files-in-103-seconds-and-its-a-terrifying-warning-about-ai-agents); [explainx: Opus 5 rm -rf](https://explainx.ai/blog/claude-code-rm-rf-reddit-incident-sandbox-guide-august-2026); [Substack: skip-permissions](https://dominiksnotebook.substack.com/p/if-youre-a-beginner-with-claude-code); [dev.to: agentguard hook](https://dev.to/krishna_newark/ai-coding-agents-can-run-rm-rf-on-your-machine-heres-how-to-stop-them-32m); [devtoolpicks: overnight bills](https://devtoolpicks.com/blog/ai-agents-runaway-claude-code-bills-overnight-2026); [loopguard](https://pkg.go.dev/github.com/loop-eng/loopguard); [techtrenches: sub-agent loop](https://techtrenches.dev/p/the-slot-machine-that-codes); [agentburn](https://pypi.org/project/agentburn/0.13.0/).

**Supply chain**: [Hive Security: ClawHavoc](https://hivesecurity.gitlab.io/blog/openclaw-ai-agent-security-crisis-2026/); [betterclaw: 543 CVEs](https://www.betterclaw.io/blog/openclaw-security-2026); [Trend Micro: AMOS via skills](https://www.trendmicro.com/en_us/research/26/b/openclaw-skills-used-to-distribute-atomic-macos-stealer.html); [itecs: MCP tool poisoning](https://itecsonline.com/post/mcp-tool-poisoning-enterprise-ai-agent-security-2026); [CSA research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-ai-agent-exfiltration-2/); [TrueFoundry: rug pulls](https://www.truefoundry.com/blog/blog-mcp-tool-poisoning-gateway-defense).

**Market and competitors**: [Yahoo Finance: $435M](https://finance.yahoo.com/technology/ai/articles/enterprise-ai-agent-funding-surges-093104627.html); [SecurityWeek: AIR $50M](https://www.securityweek.com/ai-agent-firewall-startup-air-security-emerges-from-stealth-with-50-million/); [SecurityWeek: Kontext $4M](https://www.securityweek.com/kontext-security-emerges-with-4-million-for-ai-agent-runtime-controls/); [AI safety funding June 2026](https://newmarketpitch.com/blogs/news/ai-safety-funding-news); [funding trends](https://newmarketpitch.com/blogs/news/ai-safety-funding-trends); [Q3 tracker](https://aiforbusinessautomation.com/ai-agent-platform-startup-funding/); [TrueFoundry buyer's guide](https://www.truefoundry.com/blog/enterprise-ai-agent-security-solutions); [Akto: Zenity limits](https://www.akto.io/alternatives/zenity-alternatives).

**Research**: [PACE, arXiv 2610.01349](https://arxiv.org/abs/2610.01349); [AGATE, arXiv 2609.30830](https://arxiv.org/abs/2609.30830); [PPMF, arXiv 2607.29167](https://arxiv.org/abs/2607.29167); [VIGIL (Jan 2026), arXiv 2601.05755](https://www.alphaxiv.org/abs/2601.05755); [VIGIL (Jun 2026), arXiv 2606.26524](https://www.alphaxiv.org/abs/2606.26524).

**FalkorDB**: [Announcing 6.0](https://www.falkordb.com/blog/announcing-falkordb-6-0/); [Graphiti MCP server](https://docs.falkordb.com/agentic-memory/graphiti-mcp-server.html); [Cloud free tier](https://docs.falkordb.com/cloud/tiers/free); [graph algorithms](https://docs.falkordb.com/algorithms/).
