---
max_turns: 25
allowed_tools: [Skill, Agent, Read, Glob, Grep, Write, Edit, Bash, PowerShell, WebSearch, WebFetch]
---

/slr-harness:review inference-time self-improvement loops for language-model agents

Use landscape mapping, at most 5 rounds, academic plus authoritative grey
literature, and a time range recommended by the scopers.

Use the plugin's normal search capability policy. If the optional paper-search CLI
is available, prefer it for structured paper discovery; if unavailable, use the
normal fallback. Do not install any dependency. Generate the scope draft and stop
at the approval gate.
