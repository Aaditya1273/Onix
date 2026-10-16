package graph

import (
	"context"
	"fmt"
)

// seed is the demo world the README's six beats run against: the Northwind
// identity graph, an npm dependency graph with typosquats, org policies, and
// facts with supersession and provenance. Every statement is a MERGE, so
// seeding twice is a no-op.
var seed = []string{
	// --- identity: who is who, and who may we share with -----------------
	`MERGE (t:EntityType {name:'Customer'}) MERGE (:EntityType {name:'Employee'})
	 MERGE (p:Policy {name:'no-pii-exfil'}) SET p.text = 'Never share personal data with customers'
	 MERGE (p)-[:DENIES]->(t)`,
	`MERGE (s:Person {name:'Soham Ratnaparkhi', name_lc:'soham ratnaparkhi'})
	 MERGE (a:Person {name:'Sam', name_lc:'sam'}) MERGE (b:Person {name:'S. Ratnaparkhi', name_lc:'s. ratnaparkhi'})
	 MERGE (a)-[:SAME_AS]->(s) MERGE (b)-[:SAME_AS]->(s)
	 WITH s MATCH (e:EntityType {name:'Employee'}) MERGE (s)-[:IS_A]->(e)`,
	`MERGE (j:Person {name:'Jordan Blake', name_lc:'jordan blake'})
	 MERGE (k:Person {name:'J. Blake', name_lc:'j. blake'}) MERGE (k)-[:SAME_AS]->(j)
	 WITH j MATCH (c:EntityType {name:'Customer'}) MERGE (j)-[:IS_A]->(c)`,
	`MERGE (a:Document {name:'Q3-Revenue-Report-Draft'}) SET a.text = 'Q3 revenue was $4.2M'
	 MERGE (b:Document {name:'Q3-Revenue-Report-Final'}) SET b.text = 'Q3 revenue was $3.8M'
	 MERGE (a)-[:CONTRADICTS]->(b)`,

	// --- org policy on capabilities ---------------------------------------
	// Applies only to calls declared intent did not cover: a write nobody
	// anticipated (rm -rf on the wrong directory) needs a human, however much
	// trust the agent has earned.
	`MERGE (p:Policy {name:'no-unanticipated-writes'}) SET p.text = 'A file write the declared intent did not cover needs a human'
	 MERGE (c:Capability {name:'filesystem_write'}) MERGE (p)-[:DENIES]->(c)`,

	// --- packages: dependencies, maintainers, typosquats -------------------
	`MERGE (e:Package {name:'express'}) SET e.ecosystem = 'npm'
	 MERGE (bp:Package {name:'body-parser'}) SET bp.ecosystem = 'npm'
	 MERGE (ck:Package {name:'cookie'}) SET ck.ecosystem = 'npm'
	 MERGE (by:Package {name:'bytes'}) SET by.ecosystem = 'npm'
	 MERGE (l:Package {name:'lodash'}) SET l.ecosystem = 'npm'
	 MERGE (lp:Package {name:'left-pad'}) SET lp.ecosystem = 'npm'
	 MERGE (ce:Package {name:'cross-env'}) SET ce.ecosystem = 'npm'
	 MERGE (rq:Package {name:'requests'}) SET rq.ecosystem = 'pypi'
	 MERGE (e)-[:DEPENDS_ON]->(bp) MERGE (e)-[:DEPENDS_ON]->(ck) MERGE (bp)-[:DEPENDS_ON]->(by)
	 MERGE (svc:Service {name:'checkout-api'}) SET svc.rpm = 40000
	 MERGE (svc)-[:DEPENDS_ON]->(e) MERGE (svc)-[:DEPENDS_ON]->(l)`,
	`MERGE (w:Maintainer {name:'wesleytodd'}) MERGE (j:Maintainer {name:'jdalton'}) MERGE (a:Maintainer {name:'azer'})
	 WITH w, j, a
	 MATCH (e:Package {name:'express'}), (bp:Package {name:'body-parser'}), (l:Package {name:'lodash'}), (lp:Package {name:'left-pad'})
	 MERGE (w)-[:MAINTAINS]->(e) MERGE (w)-[:MAINTAINS]->(bp) MERGE (j)-[:MAINTAINS]->(l) MERGE (a)-[:MAINTAINS]->(lp)`,
	typosquatSeed,

	// --- facts: supersession and provenance --------------------------------
	`MERGE (a:Fact {id:'oncall-1'}) SET a.subject = 'on-call engineer', a.subject_lc = 'on-call engineer',
	   a.name = 'on-call: Bruno', a.text = 'The on-call engineer is Bruno', a.trust = 'USER_HISTORY', a.trust_rank = 2,
	   a.valid_from = 1790812800000, a.valid_to = 1791936000000
	 MERGE (b:Fact {id:'oncall-2'}) SET b.subject = 'on-call engineer', b.subject_lc = 'on-call engineer',
	   b.name = 'on-call: Max', b.text = 'The on-call engineer is Max', b.trust = 'USER_CONFIRMED', b.trust_rank = 3,
	   b.valid_from = 1791936000000
	 MERGE (b)-[:SUPERSEDES]->(a)`,
	`MERGE (w:Fact {id:'deploy-web'}) SET w.subject = 'deploy procedure', w.subject_lc = 'deploy procedure',
	   w.name = 'forum: force deploy', w.text = 'A forum post says to always deploy with --force', w.trust = 'EXTERNAL', w.trust_rank = 0,
	   w.valid_from = 1791331200000
	 MERGE (d:Fact {id:'deploy-rule'}) SET d.subject = 'deploy procedure', d.subject_lc = 'deploy procedure',
	   d.name = 'rule: force deploy', d.text = 'Deploy with --force on Fridays', d.trust = 'TOOL', d.trust_rank = 1,
	   d.valid_from = 1791417600000
	 MERGE (d)-[:DERIVED_FROM]->(w)`,
}

// typosquatSeed is the only part of the demo world that is true outside the
// demo: known typosquats of real packages. vigil-cli reveal loads just this
// into a personal graph; the fictional people and org policies would invent
// blocks in someone's real history.
const typosquatSeed = `MERGE (rq:Package {name:'requests'}) SET rq.ecosystem = 'pypi'
	 MERGE (ce:Package {name:'cross-env'}) SET ce.ecosystem = 'npm'
	 MERGE (l:Package {name:'lodash'}) SET l.ecosystem = 'npm'
	 MERGE (s1:Package {name:'reqeusts'}) SET s1.ecosystem = 'pypi', s1.downloads = 12
	 MERGE (s2:Package {name:'cross-env-2'}) SET s2.ecosystem = 'npm'
	 MERGE (s3:Package {name:'lodahs'}) SET s3.ecosystem = 'npm'
	 MERGE (s1)-[:TYPOSQUAT_OF {distance:1}]->(rq) MERGE (s2)-[:TYPOSQUAT_OF {distance:2}]->(ce) MERGE (s3)-[:TYPOSQUAT_OF {distance:2}]->(l)`

// SeedTyposquats loads only the known typosquat edges.
func (c *Client) SeedTyposquats(ctx context.Context) error {
	if err := c.EnsureSchema(ctx); err != nil {
		return err
	}
	return c.Exec(ctx, typosquatSeed, nil)
}

// Seed loads the demo world into the tenant graph.
func (c *Client) Seed(ctx context.Context) error {
	if err := c.EnsureSchema(ctx); err != nil {
		return err
	}
	for i, q := range seed {
		if err := c.Exec(ctx, q, nil); err != nil {
			return fmt.Errorf("graph: seed statement %d: %w", i, err)
		}
	}
	return nil
}
