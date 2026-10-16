// Blast radius of each package: how many packages and services depend on it, up to 4 hops.
// params: {"pkgs": ["express", "left-pad"]}
UNWIND $pkgs AS pkg
OPTIONAL MATCH (:Package {name:pkg})<-[:DEPENDS_ON*1..4]-(d)
RETURN pkg, count(DISTINCT d)
