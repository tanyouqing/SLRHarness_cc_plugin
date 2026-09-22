# Compatible update scope revision

PASS only if the current update draft gains the requested comparison dimension,
records the change relative to the previous scope, sets maxRounds to 2 in both draft
and update state, increments scopeRevision, commits the matching update scope-draft
revision, and remains awaiting explicit approval. No search or agent may start; root
state/scope/tasks/report, legacy notes, and tags remain unchanged.
