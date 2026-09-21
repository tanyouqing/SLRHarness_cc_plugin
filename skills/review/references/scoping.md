# Literature review scoping rules

Use these rules to turn a vague topic into an agent-actionable protocol. A scope is
a search and extraction contract, not a draft conclusion.

## Review configuration

Record the resolved intake choices exactly once and turn them into operational
scope rules:

- **Primary objective**: landscape mapping, method comparison, practical decision
  support, or research gaps/novelty. Shape the research question, comparison
  dimensions, and ordering around this objective.
- **Maximum research rounds**: a positive integer that must equal state
  `maxRounds`. It controls orchestration, not review depth.
- **Source coverage**:
  - **Academic only** admits peer-reviewed papers and preprints as evidence.
    Non-academic pages may aid discovery or metadata verification but are not
    eligible evidence.
  - **Academic + authoritative grey literature** also admits technical reports,
    standards, official documentation, white papers, and official research or
    engineering blogs. State how these types are distinguished from scholarly
    evidence.
  - **Broad web evidence** additionally admits expert blogs, project posts, and
    social or community discussions. Require source-type and provenance labels,
    evidence-tier labeling, and cross-verification for substantive claims. Do not
    present informal evidence as equivalent to peer-reviewed evidence.
- **Time coverage**: turn recent-five-years or a custom range into exact dates. If
  scopers recommend the range, record their concrete recommendation and rationale;
  do not leave the final criterion as merely "scoper-recommended".

## Research question

Choose one framework:

- **PICO** for intervention/comparison questions: Population, Intervention,
  Comparison, Outcome.
- **PICo** for exploratory or mapping questions: Population, Interest, Context.

Write one answerable sentence. Reject formulations that are purely descriptive,
contain several independent questions, or depend on undefined adjectives such as
"best", "important", or "high quality". The expected final answer should be
sketchable as evidence categories, comparisons, and limitations.

## Search vocabulary

For every key concept provide at least three variants when the domain permits:

- canonical term and quoted phrases;
- synonyms and adjacent-field terminology;
- acronyms plus expansions;
- controlled vocabulary such as MeSH where applicable;
- spelling variants and cautious truncation/wildcards.

Combine synonyms with OR and independent concepts with AND. Parenthesize every OR
group. Use NOT sparingly; exclusions belong primarily in screening criteria. Record
database-specific variants when syntax differs.

## Inclusion and exclusion criteria

Every criterion must be decidable from a source without guessing. Cover, when
relevant: dates, language, publication type, peer-review status, population/domain,
study design, accessible evidence, required outcomes, duplicates, retractions, and
superseded versions.

Avoid subjective criteria such as "relevant", "novel", or "high quality" unless an
operational rubric makes the decision reproducible. Start moderately strict. A
likely result set above roughly 200 needs narrowing; fewer than three plausible
sources per task suggests broadening.

## Comparison dimensions

Dimensions become columns in the final synthesis. Every dimension must be:

1. extractable from typical sources;
2. orthogonal to the other dimensions;
3. assigned a value type;
4. explicit about units or categories;
5. balanced across quantitative and qualitative evidence.

Consider method family, population/architecture, intervention, comparator, dataset,
outcome metric and value, scale/resources, setting/hardware, year/venue,
reproducibility, limitations, and failure modes. Do not require facts that the
target literature is unlikely to report.

## Ranking and grouping

Pick one primary grouping: method family, application, evidence type, relation to a
reference, or a flat list. Specify an ordering and tiebreaker.

Numeric orderings must name the dimension, direction, and missing-value handling.
A subjective composite must define factors, weights, and a deterministic 0–1 rubric.
Weights should sum to 1.0. Never rank by undefined quality, impact, novelty, or taste.

## Database selection

Use at least one broad source plus one domain-specific source, and normally 2–3
databases total:

| Domain | Useful sources |
| --- | --- |
| Computer science / AI | Semantic Scholar, DBLP, arXiv, OpenReview, proceedings |
| Biomedical | PubMed/MEDLINE, Embase, Cochrane Library, bioRxiv |
| Engineering | IEEE Xplore, Scopus, Web of Science |
| Social science | Scopus, Web of Science, JSTOR |
| Mathematics | MathSciNet, zbMATH, arXiv |

Google Scholar is useful for discovery but difficult to enumerate reproducibly.
Prefer canonical database/API results for counts and stable identifiers.

Choose one depth:

- **Exhaustive** only when criteria plausibly yield fewer than about 200 records.
- **Targeted** otherwise; default to the top 20–50 results per query/concept and
  state how relevance/citation/date affects selection.

## Required `SCOPE_DRAFT.md` shape

```markdown
# Scope: <theme>

## Output Language
## Review Configuration
- Primary objective: <landscape mapping | method comparison | practical decision support | research gaps/novelty>
- Maximum research rounds: <positive integer>
- Source coverage: <Academic only | Academic + authoritative grey literature | Broad web evidence>
- Time coverage: <concrete range or no date limit>
## Research Question
## Framework Decomposition
## Key Concepts & Search Terms
## Candidate Search Strings
## Inclusion Criteria
## Exclusion Criteria
## Comparison Dimensions
## Ranking & Grouping Criteria
### Grouping
### Primary ordering
### Secondary ordering
### Scoring rubric
## Target Databases
## Review Depth
## Assumptions Requiring Human Review
## Notes
```

The assumptions section must make automatic choices visible: inferred population,
date/language defaults, publication types, evidence threshold, target depth, and
anything intentionally excluded.

The inclusion and exclusion criteria must operationalize the selected source and
time coverage. `Review Depth` remains an evidence-volume choice: use Targeted or
Exhaustive according to the expected result set, independently of maximum rounds.

`## Output Language` must be exactly `English` or `Chinese`. Default to English even
when the topic is written in Chinese. Use Chinese only when the user explicitly asks
for Chinese output. This choice governs the scope, task descriptions, topic notes,
and report; source titles and technical terms remain in their original language.

## Approval checklist

- Research question is one sentence and answerable.
- Output language is explicit and matches the user's stated preference, if any.
- All four review configuration values are explicit; maximum rounds is a positive
  integer matching state.
- Source and time coverage are converted into decidable inclusion/exclusion rules;
  broad web sources have provenance, evidence-tier, and cross-verification rules.
- Framework elements are explicit.
- Each core concept has sufficient term variants.
- Criteria are objectively decidable and non-contradictory.
- Every dimension has description and type; dimensions are not redundant.
- At least two target databases are selected.
- Review depth, grouping, ordering, tiebreaker, and any scoring rubric are complete.
- A human could execute the protocol without inventing missing policy.

Do not place findings, conclusions, implementation details, or a predetermined list
of papers to include in the scope.
