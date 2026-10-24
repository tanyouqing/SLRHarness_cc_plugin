# Subagent delivery repair (0.7.1)

## Evidence and assessment — 2026-10-24

The supplied server report describes missing SubagentHandback results and reports
one successful minimal test after adding final-text instructions. No raw transcript,
server CLI version, permission-mode trace or hook stderr accompanied that report.
Its single test is useful evidence, but does not prove that natural-language endings
always trigger native handback, or exclude permission/API/turn-limit failures.

Inspection found a concrete compatibility defect: hooks/hooks.json matches every
PreToolUse call, while guard-agent-actions.mjs rejected SubagentHandback as an unknown
tool. Reviewer initialization additionally required a pending binding before normal
tool use. Thus a native READY handback could be rejected before binding was possible.
Without the server's trace, this is a demonstrated code defect and plausible cause,
not proof of the sole cause of every reported interruption.

Official references checked on 2026-10-24:
- https://code.claude.com/docs/en/tools-reference: SubagentHandback is a native result
  tool provided to qualifying local subagents in auto mode (v2.1.271+); availability
  depends on runtime conditions. It can be injected despite custom tool lists.
- https://code.claude.com/docs/en/sub-agents: continuation APIs depend on the runtime;
  current documentation describes SendMessage to the actual returned agent ID.
  A maxTurns stop may yield partial output, so a stopped invocation is not acceptance.

## Changes adopted

- Guard permits only the exact SubagentHandback tool with a nonempty message, before
  binding/stage checks. This enables READY and explicit blocked reports without
  opening filesystem, shell, retrieval, delegation or arbitrary SendMessage access.
- Six role prompts explicitly deliver through the native tool when exposed, with
  final text as the fallback when absent. READY remains initialization only.
- Manager/Worker/Scoper/writer use DONE/PARTIAL/BLOCKED reports. Checker and Reviewer
  preserve their existing JSON-only success contracts, with explicit blocked reports
  for incomplete examinations. No DONE prefix corrupts assessment JSON.
- Main validates exact assigned artifacts and existing schemas before advancing.
  It requests one focused delivery recovery per invocation/batch and records it.
  Failed recovery uses existing task retries or operational pause; independent
  checking/scoring cannot be replaced by self-review or hand-edited completion state.
- Prefer 2–3 papers in initial task decomposition. For larger reading assignments,
  request explicit batches of at most three owned papers per invocation, retaining
  one owner/lease and cumulative result.json until the whole phase finishes.

## Limits and validation

The batch size and recovery orchestration are prompt contracts executed by main;
the plugin has no autonomous process scheduler. Existing state validators still
check phase transitions, evidence structure and final-review assessment arithmetic.
No new state schema or research/quality budget is introduced. Manager continues
per-paper acceptance; Checker continues chapter checking with targeted note reads.

Deterministic tests exercise native READY for six roles, JSON reports, failed/paused
reports, invalid report arguments and unchanged tool restrictions. Prompt tests cover
all role/entry integrations and bounded continuation. See pipeline-validation.md for
the final test count. No real server rerun or live auto-mode Agent test was performed
locally; the server's minimal-test result remains a supplied observation.

## Server reproduction checklist

Use a fresh isolated workspace with the patched plugin loaded. Record CLI version,
permission mode, runtime Agent IDs, tools, hook failures and complete transcripts.
Test native handback where actually exposed and text fallback where absent; do not
switch modes merely to bypass a failure. Verify READY → binding → work → handback
for a Worker, a read-only Checker and a Reviewer with a frozen submission. Force one
missing report/partial batch and check bounded recovery, no duplicate writer and no
phase completion until all owned records exist. Validate independent review events
and final assessment files. Never reuse the incomplete historical run as a passing
baseline or auto-migrate its evidence into verified status.
