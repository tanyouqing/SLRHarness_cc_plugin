# SLR Harness

SLR Harness is a native Claude Code plugin for human-gated literature reviews. A
single public skill turns a vague topic into an auditable scope, waits for explicit
approval, and then runs a manager → parallel workers → manager review loop. Each
review lives in its own Git repository.

This is a semi-automated rapid/scoping-review workflow, not a substitute for a
dual-reviewer, preregistered systematic review.

## Requirements

- Claude Code 2.1.274 or newer
- Node.js 18 or newer
- Git

Python, uv, tmux, Kiro, and recursive `claude -p` sessions are not used.

## Install

From the private `rail-research` marketplace:

```text
/plugin marketplace add <rail-research-repository>
/plugin install slr-harness@rail-research
```

For local development:

```bash
claude --plugin-dir ./slrharness
```

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

The first response creates `workspaces/<slug>/SCOPE_DRAFT.md`, commits it as
`scope-draft-1`, summarizes the scope in chat, and stops. Ask for revisions as many
times as needed. Research begins only after an unambiguous approval such as
“我明确批准这个 scope，开始正式调研”. Phrases such as “看起来不错” do not approve it.

Resume or inspect a review with:

```text
/slr-harness:review resume <slug>
/slr-harness:review status <slug>
```

When a new session has exactly one unfinished workspace, the skill resumes it
automatically. If several are unfinished it lists them and asks which one to use.

## Outputs

Each `workspaces/<slug>/` directory is an independent Git repository containing:

```text
.slr/state.json       persisted workflow state
SCOPE_ORIGINAL.md     immutable approved scope
SCOPE.md              append-only living scope
TASKS.md              manager-owned task registry
REPORT.md             incremental and final synthesis
topics/               independent worker notes
assets/               note-specific supporting artifacts
```

The accepted scope is tagged `round-0`. Every research round creates
`round-N-plan` and `round-N-review` commits and a `round-N` tag. Finalization adds
the `slr-complete` tag. Worker notes are the process record; `REPORT.md` is the
primary deliverable.

## Defaults and stopping

- Five rounds maximum
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
claude plugin eval . --scaffold --allow-tools Write Edit Bash WebSearch WebFetch
```

See [docs/design.md](docs/design.md) for the architecture, state machine, ownership
rules, and safety model.

## License

MIT. Copyright and original authorship are preserved in [LICENCE](LICENCE).
