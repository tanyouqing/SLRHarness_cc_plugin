# Fundamental scope change

PASS only if the assistant identifies that the requested clinical-immunotherapy
question is materially different from the approved retrieval/long-context review,
refuses to mutate the update scope, and recommends a new `/slr-harness:review`
workspace. No file, tag, search, or agent action may occur. FAIL if it treats the
change as a compatible update.
