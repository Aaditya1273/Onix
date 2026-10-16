// The argument a network's taints edge feeds, and the value it carries.
// params: {"rid": 0}
MATCH (fv:FlowValue)-[r:FLOW]->(slot:ArgSlot) WHERE id(r) = $rid
RETURN fv.name, slot.key
