# Formal review-paper contract

The manuscript is a scholarly review draft synthesized only from the completed SLR
Harness workspace. It is not a reformatted run report and must not add evidence from
search, general model knowledge, or uncited background assumptions.

## Evidence hierarchy

Read all of the following before writing:

1. `SCOPE_ORIGINAL.md` for the approved research question and original boundaries.
2. `SCOPE.md` for recorded scope evolution.
3. Every `topics/**/*.md` file. Only notes whose frontmatter has `status: final`
   may support factual claims. Draft or invalid notes may identify missing coverage
   but may not support conclusions.
4. `REPORT.md` for navigation, synthesized themes, conflicts, and dispositions.
5. `TASKS.md` and `.slr/state.json` for coverage and unresolved limitations.

Use original sources recorded in eligible notes. Never cite the workspace files as
scholarly evidence. Deduplicate references by DOI when present, otherwise by a
case-folded title with punctuation and whitespace normalized. Preserve only known
metadata; do not infer missing authors, dates, venues, DOI values, URLs, study
counts, or experimental results.

## Required logical structure

The manuscript must contain all of these logical sections, though field-specific
subsections and more descriptive headings are encouraged:

```markdown
# <Evidence-grounded title>

## Abstract
## Keywords
## 1. Introduction
## 2. Scope, Terminology and Conceptual Foundations
## 3. Review Methodology
## 4. Taxonomy / Research Landscape
## 5. Thematic Evidence Synthesis
## 6. Comparative Analysis
## 7. Cross-Cutting Discussion
## 8. Challenges, Open Questions and Future Directions
## 9. Limitations
## 10. Conclusion
## References
```

The abstract must state the context, objective, evidence base, principal synthesis,
and limitations without unsupported numbers. Keywords should contain four to eight
terms grounded in the scope.

The methodology must accurately reconstruct the documented question, databases or
search channels, search strategy, eligibility rules, extraction dimensions, and
synthesis approach. Do not claim PRISMA compliance, exhaustive coverage, dual-human
screening, independent coding, meta-analysis, causal inference, or any procedure not
recorded in the workspace. Do not mention AI assistance or automated generation.

## Writing and citation quality

- Write connected academic prose with clear argumentative transitions. Synthesize
  across sources; do not concatenate note summaries or mirror REPORT headings.
- Use tables only for evidence-supported taxonomies and comparisons. Explain each
  table's analytical significance in prose.
- Distinguish reported findings, cross-source synthesis, and cautious interpretation.
  Phrase conflicts and missing values explicitly.
- Cite every substantive literature-derived claim. In author–year mode, use
  `(Author, Year)` or `(Author et al., Year)` consistently and sort References
  alphabetically. In numeric mode, number references by first appearance and keep
  numbering stable.
- Every in-text citation must resolve to exactly one reference entry, and every
  reference entry must be cited. Prefer canonical DOI or publisher links, followed
  by stable repository URLs already present in the notes.
- If source metadata is too incomplete to cite safely, omit or weaken the claim and
  explain the evidence gap in Limitations.
- A `completed_with_limitations` review must surface blocked work and unresolved
  in-scope questions in the discussion, future directions, and limitations.
- Meet the requested length when evidence supports it. If not, produce a shorter,
  honest manuscript rather than padding, repeating material, or adding knowledge.

Do not include an author or affiliation block, YAML metadata, a generation notice,
or claims that the draft is submission-ready.
