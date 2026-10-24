# Research tier semantic evaluation

These are expected behaviors, not model results. cases.json contains Chinese/English,
negation, quoted wording, modifier scope, explicit-tier precedence, explicit-count
and unresolved-conflict cases. The script deliberately has no keyword classifier.

Run each case in a fresh Claude Code session with this plugin loaded. For a low-cost
inference-only check, give the case prompt plus: "Do not perform research or call
agents. Read the research-scale contract and return the researchProfile you would
pass to init, including a truthful rationale." Save actual outputs and model/runtime
metadata; compare the four expected fields and manually judge rationale/context.
Do not describe schema tests using these expected values as semantic model validation.

For live orchestration use a fresh workspace for one case: confirm startup has no
configuration questionnaire, the scope draft shows tier/target/reason, and execution
stops for human scope approval. After real approval, inspect three Managers' plans,
aggregate accepted/pending counts and shared paper reuse; each Manager must receive
only its contribution to the shared target. Record expansions, unfinished work and
actual counts honestly. Do not force a fixed number of papers or a passing score.

Separately test resume with an already saved low profile and the prompt "Continue";
it must remain low. A historical workspace without a profile must remain untargeted.
A full 30/60/90-paper real review is optional; label it unexecuted when not run.
