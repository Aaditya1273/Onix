// Remove one call's influence network (used by dry-run "will this be allowed?" checks, which must leave no trace).
// params: {"call": "s1-2"}
MATCH (n) WHERE (n:FlowSource OR n:FlowSink OR n:Effect OR n:ArgSlot OR n:FlowValue OR n:FlowRead) AND n.call = $call
DETACH DELETE n
