---
type: llm
---

PASS only if review validates the existing note, marks its original task complete, and gives all three open questions an explicit report disposition. The cross-dataset robustness gap must create exactly one new Pending task and increment `roundMetrics.acceptedNewTasks` to 1; the answered ablation question must be resolved without a task; the GPU purchasing question must be out of scope without a task. Because `maxRounds` is already 1 after review, no additional plan or worker may run, the pending gap must remain traceable, and finalization must produce `completed_with_limitations`. FAIL if any question is dropped, speculative tasks are created, or a second round starts.
