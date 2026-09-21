# Plugin evals

These cases exercise the public `review` skill rather than internal scripts:

- `scope-gate`: a natural-language topic must stop at scope approval.
- `interactive-intake`: a vague topic asks once for all missing configuration before
  any workspace or scoper exists.
- `partial-intake`: values already given in the initial request are not asked again.
- `default-intake`: “use defaults” proceeds without another question and records the
  fixed default configuration.
- `unavailable-interactive`: missing question tooling falls back to the same fixed
  defaults instead of blocking.
- `explicit-chinese`: an explicit Chinese-output request overrides the English default.
- `slash-scope-gate`: the slash entry follows the same gate.
- `ambiguous-approval`: positive but ambiguous feedback must not open the gate.
- `scope-revision`: feedback creates another draft revision without research.
- `legacy-scope-config`: an old draft gets one compatible configuration revision
  and must be approved again.
- `resume-status`: status is read-only and reports persisted state.
- `slug-collision` and `multiple-active`: recovery never overwrites or guesses.
- `one-round-review`: explicit approval runs a bounded end-to-end review.
- `max-rounds` and `external-failure`: hard limits and blockers cannot masquerade
  as complete research.
- `partial-worker-failure`, `retry-exhausted`, and `saturation`: partial success is
  preserved, retry caps are honored, and low-yield research stops early.
- `question-triage`: review classifies every evidence-grounded question, promotes
  only actionable in-scope gaps, and still respects the existing round limit.
- `paper-search-policy`: optional paper-search is preferred for discovery without
  bypassing evidence verification or the scope gate.
- `paper-search-fallback`: a missing CLI falls back to existing search tools and
  never triggers an installation attempt or blocks a review by itself.
- `paper-generate`: an explicitly requested manuscript is synthesized only from a
  terminal workspace and committed after `slr-complete` without moving the tag.
- `paper-nonterminal`: the paper workflow cannot approve, resume, or bypass an
  unfinished review.
- `paper-limitations`: draft notes and unresolved work cannot be promoted into
  confident paper findings.
- `paper-revision`: revision changes only the existing manuscript and uses its own
  commit without repeating intake or research.

Run all cases from the plugin root with Claude Code 2.1.274 or newer:

```bash
claude plugin eval . --scaffold --allow-tools AskUserQuestion Write Edit Bash WebSearch WebFetch
```

The end-to-end case uses live web search; lack of network is expected to produce
`blocked` or `completed_with_limitations`, never a fabricated complete report.

Claude Code's evaluator launches `scaffold_script` through Bash. On Windows, put
the Bash bundled with Git for Windows on `PATH` before using `--scaffold`. The
fixture implementation itself is dependency-free Node.js and is also exercised by
the unit tests.
