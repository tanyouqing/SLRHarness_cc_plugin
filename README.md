# SLR Harness

SLR Harness is a native Claude Code plugin for human-gated literature reviews. Its
primary review skill turns a vague topic into an auditable scope, waits for explicit
approval, and then runs a manager → parallel workers → manager review loop. A
separate update skill incrementally refreshes completed evidence without deleting
prior work, and an optional paper skill turns the corpus into a formal manuscript.
Each review lives in its own Git repository.

This is a semi-automated rapid/scoping-review workflow, not a substitute for a
dual-reviewer, preregistered systematic review.

## Requirements

- Claude Code 2.1.274 or newer
- Node.js 18 or newer
- Git
- Optional: `uv` and the `paper-search-mcp` CLI for structured academic search

Node and Git are the only core runtime dependencies. Python, Kiro, and recursive
`claude -p` sessions are not used. `uv` is needed only to install the optional
paper-search CLI, and `tmux` is only an optional remote-session wrapper.

## Install

From the private `rail-research` marketplace:

```text
/plugin marketplace add <rail-research-repository>
/plugin install slr-harness@rail-research
```

Optional structured paper search can be installed before starting Claude Code:

```bash
uv tool install paper-search-mcp
paper-search sources
```

The plugin never installs this dependency during a review. When the command is
available, scopers and workers prefer its structured metadata search; otherwise
they fall back to connected academic MCP tools and WebSearch/WebFetch. Only
`paper-search sources` and `paper-search search` are permitted. PDF download and
full-text extraction remain outside this integration. The optional CLI and its
upstream Claude Code skill are provided by the MIT-licensed
[openags/paper-search-mcp](https://github.com/openags/paper-search-mcp) project;
SLR Harness adapts the retrieval policy rather than bundling that skill.

For local development:

```bash
claude --plugin-dir ./slrharness

claude \
  --plugin-dir ./example/SLRHarness \
  --permission-mode acceptEdits \
  --allowedTools "AskUserQuestion,Read,Glob,Grep,Write,Edit,Bash,Agent,WebSearch,WebFetch,mcp__arxiv__*,mcp__tavily__*,mcp__scholar__*"
```

`acceptEdits` is the recommended mode for the interactive intake and scope gate.
It automatically accepts workspace file edits, while the explicit allowlist
pre-approves the remaining tools used by the normal review pipeline. An unexpected
tool can still request permission instead of being rejected immediately.

### Unattended runs

For a long-running review, keep permissions local to the directory from which the
review will run. Create `.claude/settings.local.json` in that directory (not in
the plugin checkout):

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": [
      "AskUserQuestion",
      "Read",
      "Glob",
      "Grep",
      "Write",
      "Edit",
      "Bash",
      "PowerShell(paper-search *)",
      "Agent",
      "WebSearch",
      "WebFetch",
      "mcp__arxiv__*",
      "mcp__tavily__*",
      "mcp__scholar__*"
    ]
  }
}
```

With this allowlist, the review can normally run unattended after the user has
explicitly approved the scope. `acceptEdits` alone is not an unattended mode: it
does not automatically approve arbitrary shell, Agent, Web, or MCP calls. The
allow rules above pre-approve those expected calls; an unexpected call waits for
permission, so detach from `tmux` only after the scope is approved and formal
research has begun. Remove MCP entries that are not installed and add equivalent
`mcp__<server>__*` entries for other search servers. Keeping this file project-local
avoids granting broad `Bash`, write, and agent permissions to unrelated Claude Code
projects.

For a deliberately locked-down headless environment, `dontAsk` remains available:
change only `defaultMode` after confirming that the allowlist covers every required
tool. In that mode an unmatched call is rejected rather than prompting, which can
block the review but will not leave it waiting for a human permission response.

The optional Paper Search integration is a CLI invocation, not an automatically
approved consequence of `acceptEdits`. The broad `Bash` rule above covers
`paper-search` on Linux. If your own policy narrows shell access, add
`Bash(paper-search *)`; native Windows sessions can use the shown
`PowerShell(paper-search *)` rule. The plugin guard still limits SLR scopers and
workers to the read-only `sources` and `search` subcommands.

After marketplace installation, start Claude Code from the intended review root
without permission flags:

```bash
cd /path/to/review-root
claude
```

For local plugin development, only the plugin path remains necessary:

```bash
cd /path/to/review-root
claude --plugin-dir /absolute/path/to/SLRHarness_cc_plugin
```

On a remote server, an optional `tmux` session keeps the Claude Code process alive
after SSH disconnects. `tmux` is an operational wrapper, not a plugin dependency:

```bash
tmux new -s slr-review
cd /path/to/review-root
claude
```

Run `/slr-harness:review <topic>`, answer any missing review-configuration questions,
review the generated scope, and explicitly approve it before detaching with
`Ctrl-b d`. For a fully unattended launch, include the four configuration choices
in the initial request and wait through scope approval before detaching. Detaching
earlier leaves the workflow correctly waiting for configuration or approval.
Reconnect later with:

```bash
tmux attach -t slr-review
```

Outputs are written under the launch directory at `workspaces/<slug>/`. Confirm
the settings source with `/status` before leaving an unattended run.

Validate the plugin before distribution:

```bash
claude plugin validate --strict ./slrharness
```

## Use

Start with the slash command:

```text
/slr-harness:review retrieval-augmented generation for long-document QA
```

Natural language works too:

```text
帮我调研长文档问答中的 RAG 方法、评测和局限
```

New reviews default to English output even when the topic is written in Chinese.
Ask explicitly for Chinese output when desired, for example `请使用中文撰写 scope、
研究笔记和最终报告`. The language may be revised before scope approval and is
then frozen for that workspace.

Before creating a workspace, the skill resolves four review settings: primary
objective, maximum rounds, source coverage, and time coverage. It asks once for only
the settings missing from the initial request. A fully specified request proceeds
directly; “use defaults” selects landscape mapping, 5 rounds, academic plus
authoritative grey literature, and a scoper-recommended time range. If the
interactive question tool is unavailable, those same defaults apply.

After configuration, the skill creates `workspaces/<slug>/SCOPE_DRAFT.md`, commits
it as `scope-draft-1`, summarizes the scope in chat, and stops. Ask for revisions
as many times as needed. A configuration answer is not approval. Research begins
only after an unambiguous approval such as
“我明确批准这个 scope，开始正式调研”. Phrases such as “看起来不错” do not approve it.

Every new review includes mandatory evidence scoring by default. Each eligible
paper or grey-literature item receives an Evidence Strength Score (ESS), Review
Utility Score (RUS), Overall Recommendation Score (ORS), recommendation tier, and
confidence label. Workers record a reason and evidence location for every component;
missing or inaccessible evidence receives the neutral score 2/4 with an explicit
imputation reason rather than causing the item to remain unscored. The manager
mechanically validates formulas, summarizes recommendation reasons in `REPORT.md`,
and orders items within each approved group by ORS, ESS, year, verified citations,
then title. Year, citations, venue, and evidence tier are not score inputs.
The complete machine-readable rubric is frozen in the approved scope; its dimensions
or weights may be revised before approval, but scoring itself cannot be disabled.

Resume or inspect a review with:

```text
/slr-harness:review resume <slug>
/slr-harness:review status <slug>
```

When a new session has exactly one unfinished workspace, the skill resumes it
automatically. If several are unfinished it lists them and asks which one to use.

### Incrementally update a completed review

Months later, refresh a completed workspace without reopening its original state:

```text
/slr-harness:update <slug>
/slr-harness:update resume <slug> [update-id]
/slr-harness:update status <slug> [update-id]
```

The first call is read-only: it presents the current effective scope, prior
coverage, unresolved questions, proposed date window, and the default three update
rounds. It does not search or launch an agent. Keep the scope or request compatible
changes, then explicitly approve the displayed update scope. A materially different
core research question must use a new review workspace.

Each update has its own scope, state, tasks, notes, rounds, and Git tags. Existing
topic notes, root state/scope/tasks, report text, references, and `slr-complete` are
never removed or overwritten. Freshness searches cover newly published work;
scope-delta searches cover newly approved concepts; backfill extracts only newly
approved dimensions from known sources. DOI, arXiv ID, normalized title, and
canonical URL are checked against a generated evidence baseline.

If an older review predates mandatory scoring, its next approved update adds the
default rubric and backfills only works already compared in the report or treated as
principal Findings-by-Group subjects. Reference-only works are not backfilled, and
legacy notes remain byte-for-byte unchanged.

The manager appends an `Evidence Updates` suffix to `REPORT.md`. Older findings that
fall outside the latest scope remain in the main report and are explicitly marked
as historical evidence outside the current update scope. Update checkpoints use
`update-NNN-start`, `update-NNN-round-N`, and `update-NNN-complete`; the original
`slr-complete` tag never moves.

### Optional formal review paper

After a workspace reaches `completed` or `completed_with_limitations`, explicitly
request a formal review-paper draft with the independent paper skill:

```text
/slr-harness:paper <slug>
/slr-harness:paper revise <slug> <feedback>
```

Natural-language requests such as “turn this completed review into a formal review
paper” also work. The paper workflow never runs automatically and never resumes or
changes the research workflow. For first generation it asks once for any missing
audience, target length, and citation-style settings. Defaults are domain researchers,
6,000–9,000 words excluding references, and author–year citations; language inherits
the completed workspace unless explicitly overridden.

The writer performs no new search and has no Web, MCP, Paper Search, shell, or agent
tools. It reads the approved/living scope, report, tasks, state, and every topic note,
while using only `status: final` notes as factual evidence. The output is
`paper/REVIEW_PAPER.md`. Generation and revision create separate `paper:` commits
after the existing `slr-complete` checkpoint, without moving that tag or changing
review state. The manuscript does not claim undocumented systematic-review methods
and does not fabricate missing citation metadata.

## Outputs

Each `workspaces/<slug>/` directory is an independent Git repository containing:

```text
.slr/state.json       persisted workflow state
.slr/updates/         independent incremental-update states
SCOPE_ORIGINAL.md     immutable approved scope
SCOPE.md              append-only living scope
TASKS.md              manager-owned task registry
REPORT.md             incremental and final synthesis
topics/               independent worker notes
updates/              approved update scopes, baselines, and task registries
assets/               note-specific supporting artifacts
paper/REVIEW_PAPER.md optional formal review-paper manuscript
```

The accepted scope is tagged `round-0`. Every research round creates
`round-N-plan` and `round-N-review` commits and a `round-N` tag. Finalization adds
the `slr-complete` tag. Worker notes are the process record; `REPORT.md` is the
primary deliverable.

Incremental update notes live under `topics/updates/update-NNN/`. Each update uses
an independent default of three rounds while retaining the normal three-worker,
two-retry, and two-low-yield-round limits.

The optional manuscript is a prose-first scholarly synthesis derived from the
completed evidence base. It is separate from `REPORT.md`, which remains the
incremental operational synthesis and primary review-pipeline deliverable.
Scores may guide manuscript emphasis but are reviewer-derived appraisal metadata,
not claims made by the cited literature.

Workers normally record two to five evidence-driven open questions per note, or
explain why none remain. During review the manager deduplicates and classifies each
question. Actionable in-scope evidence gaps become pending tasks; resolved,
out-of-scope, and blocked questions remain traceable in `REPORT.md`.

## Defaults and stopping

- Landscape mapping as the primary objective
- Five rounds maximum (3 quick and 8 deep are offered, or use a custom positive integer)
- Academic sources plus authoritative grey literature; academic-only and broad-web modes are available
- A concrete time range recommended by the scopers
- Three workers per round
- Two attempts per task
- Early completion when no pending task remains
- Early saturation after two consecutive rounds with neither a new eligible source
  nor a valid new task

External-service, permission, authentication, or all-worker failures preserve the
workspace as `blocked` with a resume path. The plugin never fabricates a complete
report when evidence is unavailable.

## Development

```bash
node --test tests/*.test.mjs
claude plugin validate --strict .
claude plugin eval . --scaffold --allow-tools AskUserQuestion Write Edit Bash Agent WebSearch WebFetch
```

See [docs/design.md](docs/design.md) for the architecture, state machine, ownership
rules, and safety model.

## License

MIT. Copyright and original authorship are preserved in [LICENCE](LICENCE).
