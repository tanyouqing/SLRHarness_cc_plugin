# Reviewer input and output contract

Inputs are the approved frozen SCOPE.md, completed manuscript
(PDF/main.tex/references.bib), independently retrieved human-authored surveys and
rubric.md. Main supplies its path and identifier.
Your own current findings and prior-issues.json support continuation/reassessment.
No other scope files, chapters, notes, source cards, evidence chain, internal state
or other agent prompts. Main supplies assignment IDs and fingerprint.
Read scope before reference selection and cite its clauses in coverage judgments.

## Exact returned envelope

Return one JSON object with `submissionId`, `fingerprint`, `reviewerId` (main supplies
the actual runtime ID), and `report` with these fields:

```json
{
  "rubricVersion": "survey-2",
  "items": [{"id":"coverage","score":10,"location":"Introduction, paragraph 2","evidence":"Specific observed content or source contradiction","reason":"Explain points gained and lost"}],
  "total": 0,
  "passed": false,
  "comparison": {
    "status":"complete",
    "searchLog":"Queries, candidates, exclusions and access outcomes",
    "alignment":"Both scopes, dates, audiences and lengths; justified comparison boundaries",
    "references":[{"id":"ref-1","title":"Real survey title","authors":["Verified author"],"year":2025,"url":"https://example.org/replace-with-verified-source","version":"Recorded version","fulltext":"fulltext_read","match":"same","reason":"Why selected","verification":"Identity/full-text checks and source locations"}],
    "differences":[{"id":"diff-1","referenceId":"ref-1","kind":"gap","dimension":"synthesis","manuscriptLocation":"Section and example","referenceLocation":"Section/page and example","observation":"Concrete difference, not causal speculation","conditions":"Why comparable and when relevant"}]
  },
  "experiences": [
    {"sourceType":"review","role":"paper","executionSummary":"Manuscript Section 4 compares results without conditions; reference Section 3 separates settings (diff-1).","strategy":"Group results by compatible evaluation settings and verify that every comparison states its conditions.","applicability":"When studies use differing evaluation settings."}
  ],
  "issues": [{"id":"issue-1","kind":"topic","severity":"major","topicIds":[],"location":"Exact location","evidence":"Reason and supporting source","action":"Repair instruction","acceptance":"Checkable completion criterion"}],
  "priorIssueChecks": []
}
```

This is a shape illustration, not a valid scored example: return the six exact survey-2
dimension IDs (coverage, taxonomy, evidence, synthesis, critique, presentation),
correct total, real sources/locations; topicIds is empty for new Reviewer issues. Never reuse
example authors/links. comparison.status is complete or unavailable; unavailable
requires unavailableReason and may have empty references/differences and empty
experiences; return experiences: [] when reference comparison is unavailable.
Reference match is same, overlapping or adjacent; fulltext is fulltext_read or
unavailable. Difference kind is gap, reasonable_difference, manuscript_strength or
insufficient_evidence; dimension is coverage, organization, synthesis, evidence or
critique. Adjacent references cannot support coverage-gap findings. Do not claim unseen internal causes as facts; state uncertainty in executionSummary. Issue kind is topic, global, evidence or
scope; severity is minor, major or critical. Use topic/global issues for restoring approved coverage; scope issues propose changing
the approved boundary. Main routes topic/evidence issues from manuscript locations;
global issues may have none. Failed assessments require actionable issues.
For reassessment, priorIssueChecks must cover every previous issue exactly once:
`{issueId,status:"resolved|partial|unresolved",evidence}`. Check current content;
record actual applied strategies and task-specific outcomes in this evidence.


## Shared experience JSON contract

The final experiences.json contains exactly {"experiences":[...]}. Within the review
envelope, provide the same array as report.experiences, not a nested second envelope.

| Field | Required | Type and meaning |
|---|---|---|
| sourceType | yes | "review" or "trajectory" in the shared format; Reviewer must use "review" |
| role | yes | Exactly "paper", "manager", "scoper" or "worker" |
| executionSummary | yes | Nonempty string briefly identifying the manuscript/human-survey comparison evidence behind the strategy (1–3 short sentences) |
| strategy | yes | Nonempty string describing a reasonably general, reusable execution strategy |
| stage | no | String or null identifying the applicable phase; may be omitted/empty |
| task | no | String or null describing the concrete task; may be omitted/empty |
| applicability | no | String or null stating conditions/restrictions; may be omitted/empty |

No other experience fields are allowed. Do not retain the retired suggestions object,
per-role arrays, or action/conditions/acceptance/attribution fields. Fill optional fields only when clear. Otherwise omit them or leave null/empty strings;
these are valid. Never guess values to complete the record. Four fields alone
are valid; role coverage is not a quota and an empty array is valid. A review requires
an actual completed reference comparison to produce nonempty experiences.

executionSummary is the short source evidence for the strategy: in 1–3 short
sentences contrast this manuscript with the human survey and identify the relevant
difference. Compact locations/difference IDs may be included; detailed evidence
remains in comparison. Do not paste a long report or invent execution history. Mark inferred causes as
uncertain. strategy abstracts the observation into an actionable procedure that works
when domain materials are replaced. Include a meaningful output/check and prerequisites
where needed; applicability can hold restrictions. Current topic/paper fixes stay in
issues. All experiences remain candidates, not universally validated rules.

Reviewer writes only its assigned draft. Main validates and persists the exact array
in experiences.json. No experience Markdown is emitted. Both source types share this
shape; implementing trajectory extraction or a memory store is outside this change.
