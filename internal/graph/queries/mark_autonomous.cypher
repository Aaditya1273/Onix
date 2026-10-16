// Mark a call the hook would have let through without a prompt (earned autonomy at the time it was made).
// params: {"id": "s1-1"}
MATCH (k:Call {id:$id}) SET k.autonomous = true
