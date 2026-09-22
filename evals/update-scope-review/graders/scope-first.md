# Update scope review gate

PASS only if the assistant reads and presents the existing effective scope, prior
coverage, unresolved gaps, proposed incremental date window, and default three
rounds, then asks whether to keep or compatibly revise it. The first invocation
must remain read-only: no update directory/state, search call, scoper, manager, or
worker is created or launched, and Git remains clean. FAIL if research starts,
files change, or the existing scope is silently assumed approved.
