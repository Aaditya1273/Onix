import { Container, getContainer } from "@cloudflare/containers";

// One instance holds the playground tenant's graph; it sleeps after 30 idle
// minutes and the graph (counter and feed) starts empty on the next request.
// ponytail: in-container FalkorDB without a volume, attach storage if the counter must survive sleep.
export class Playground extends Container {
  defaultPort = 8080;
  sleepAfter = "30m";
  enableInternet = false; // the playground makes no outbound calls; enforce it
}

export default {
  async fetch(req: Request, env: { PLAYGROUND: DurableObjectNamespace<Playground> }) {
    // The rate limit keys on X-Forwarded-For (VIGIL_TRUST_PROXY=1): set it from
    // Cloudflare's own client address so a visitor cannot choose it.
    const headers = new Headers(req.headers);
    headers.set("X-Forwarded-For", req.headers.get("CF-Connecting-IP") ?? "unknown");
    return getContainer(env.PLAYGROUND, "playground").fetch(new Request(req, { headers }));
  },
};
