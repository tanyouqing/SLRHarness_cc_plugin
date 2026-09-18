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
  --permission-mode dontAsk \
  --allowedTools "Read,Glob,Grep,Write,Edit,Bash,Agent,WebSearch,WebFetch,mcp__arxiv__*,mcp__tavily__*,mcp__scholar__*"
```

### Unattended runs

For a long-running review, keep permissions local to the directory from which the
review will run. Create `.claude/settings.local.json` in that directory (not in
the plugin checkout):

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "defaultMode": "dontAsk",
    "allow": [
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

`dontAsk` approves matching rules and rejects unmatched tool calls instead of
waiting for a permission prompt. Remove MCP entries that are not installed and
add equivalent `mcp__<server>__*` entries for other search servers. Keeping this
file project-local avoids granting broad `Bash`, write, and agent permissions to
unrelated Claude Code projects.

The broad `Bash` rule above already covers `paper-search` on Linux. If your own
policy narrows shell access, add `Bash(paper-search *)`; native Windows sessions
can use the shown `PowerShell(paper-search *)` rule. The plugin guard still limits
SLR scopers and workers to the read-only `sources` and `search` subcommands.

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

Run `/slr-harness:review <topic>`, review the generated scope, and explicitly
approve it before detaching with `Ctrl-b d`. Detaching before approval leaves the
workflow correctly waiting at the scope gate. Reconnect later with:

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

Workers normally record two to five evidence-driven open questions per note, or
explain why none remain. During review the manager deduplicates and classifies each
question. Actionable in-scope evidence gaps become pending tasks; resolved,
out-of-scope, and blocked questions remain traceable in `REPORT.md`.

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
