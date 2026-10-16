// FalkorDB computes the maximum flow from the call's source to its sink; by max-flow/min-cut its value is the cut cost.
// Returns the flow value and every edge carrying flow, so the cut can be read off (see README "The database computes the cut").
// params: {"call": "s1-2"}
MATCH (src:FlowSource {call:$call}), (sink:FlowSink {call:$call})
CALL algo.maxFlow({sourceNodes:[src], targetNodes:[sink], capacityProperty:'cap', relationshipTypes:['FLOW']})
YIELD edges, edgeFlows, maxFlow
RETURN maxFlow, [i IN range(0, size(edges) - 1) | [edges[i].kind, coalesce(edges[i].key, ''), edgeFlows[i], edges[i].call]]
