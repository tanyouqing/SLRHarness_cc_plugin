# Context control implementation (0.8.0)

This release keeps the schema 2 research lifecycle and adds bounded transport,
topic-local Manager control and staged writing/review. It does not implement the
previously reverted unified-Checker redesign, nor automatic /compact execution.

## Interfaces and trust boundaries

- pipeline/final-review default CLI output is bounded. --full is diagnostic only;
  query pages retain access to complete data. In-process functions remain compatible.
- manager-control accepts a runtime-bound Manager and a topic-local request file.
  The guard compares that ID to the host input. State and idempotency receipt commit
  together under the workspace lock. Shared next-task order determines each grant.
  A busy slot/lock returns waiting, with no attempt consumed. Main completes the
  planning pass across topics before dispatch to avoid first-planner bias.
- Main still owns scope, rounds, cross-topic conflicts, independent Checker,
  compilation, final review and Git. Workers remain single-owner file writers.
- Context-enabled writers have one active phase and fresh runtime identity per phase.
  The handoff is bounded and evidence/output hashes gate compilation and submission.
- Context-enabled Reviewers have one writable draft artifact per active unit.
  Completed unit hashes and complete source coverage gate record-file. The final
  twenty-item rubric and repair sequence are unchanged.

The guard is a cooperative host-tool boundary, not an OS security sandbox. Runtime
stopped evidence and semantic review remain agent judgments; file validation cannot
establish process liveness, full-text reading or truth of a source claim.

## Runtime recovery and limits

New init enables the policy. Existing schema 2 needs explicit resume/enable and no
unresolved active leases. Read-only status never migrates; legacy research is unchanged.
Checkpoints preserve approved scope, accepted topic fingerprints, and inspected PDF
versions. The paper checkpoint requires the current source/PDF hashes and an explicit
inspection observation. PreCompact/SessionStart hooks save or load only an index;
they neither trigger /compact nor release leases. Active sibling tasks continue.

Defaults: control/handback/recovery/findings 8000 characters, text read 24000 characters,
PDF read at most five pages. Native delegated reads and handbacks are guarded; main
uses bounded helpers and prompt contracts. Search/MCP responses and host conversation
history are not fully controlled by this plugin. These are not provider token limits.
Single long JSON fields can be read through character slices; no invalid JSON truncation.

## Reproducible validation

Run `node --test tests/*.test.mjs` and `claude plugin validate .`.
Context tests exercise competing child processes, canonical sharing, partial delivery,
request idempotency, role boundaries, stage freshness and a synthetic 69→70 repair.
Synthetic evidence and scores are control-flow fixtures, not research validation.
`evals/context-probe.mjs <new-project-dir>` prepares a separate no-search runtime
probe and its prompt. Run Claude in that directory with this plugin explicitly loaded.
The probe asks for actual Manager→Worker execution; it does not fabricate runtime IDs.
A complete human-survey comparison, manual compact while siblings run and real
end-to-end literature review must be reported separately from deterministic tests.

## Validation observations — 2026-10-24

The real host probe used Claude Code 2.1.274 with a configured custom model alias.
It initialized/bound one Manager but spawned no Worker before the 1 USD requested
budget stopped the run (host-reported estimated cost 1.031233 USD; custom-model
cost basis was unknown). Several PowerShell/non-allowlisted shell attempts were
denied. This establishes neither working nesting nor unsupported nesting; no
permission bypass was added. Raw results remain in the local output probe directory.

A separate staged synthetic fixture completed every writer phase and compiled using
real latexmk/XeLaTeX/BibTeX. Both PDF pages were rendered and inspected: no obvious
clipping or missing glyphs; build layoutWarnings was empty. This verifies the staged
compile path, not model writing quality. The fixture uses synthetic role identities.

Manual /compact with live siblings, real nested Worker delivery, and a complete
real-literature writing/review/repair run remain unverified. Unit tests use mocked
Agent observations and controlled scores; they are reported separately.
