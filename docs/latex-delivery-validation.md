# LaTeX delivery implementation and validation

Date: 2026-10-22

Historical validation of the prior LaTeX delivery change. Current hierarchical implementation and validation are recorded in pipeline-validation.md; prior test totals below do not describe the current suite.

## Implemented behavior

The paper skill now produces main.tex and references.bib from a bundled AI-survey
skeleton using the unchanged NeurIPS 2026 preprint style. Topic names are dynamic
top-level chapters. The main session validates, compiles and delivers main.pdf.
Every research finalization hands off to this workflow. Status stays read-only;
terminal research can resume paper delivery, and update never auto-rewrites papers.

The writer can edit only the two fixed source paths. paper-build.mjs prepares only
missing files, checks structure and citation keys, builds in a fresh ignored directory
and tracks source/PDF hashes. Failed builds preserve old files but invalidate current
delivery status. Compilation has no shell escape or latexmk rc loading. Research
state and slr-complete are preserved; legacy Markdown is retained during migration.

## Validation performed

- Node unit/fixture suite: 78 passed, 0 failed.
- claude plugin validate --strict .: passed.
- English and Chinese minimal samples: real latexmk/XeLaTeX/BibTeX builds succeeded,
  citations resolved, no missing glyphs or overfull boxes. Both PDFs have two pages;
  all four pages were rendered and visually inspected for clipping and table layout.
- Source NeurIPS style and checklist SHA-256 remain unchanged.
- git diff --check: passed.

The first full test attempt encountered an existing test's `spawnSync node EPERM`
under Windows PATH resolution. Re-running with the bundled Node bin directory first
on PATH passed the complete suite without modifying that test.

Unit tests include fixed output permissions, legacy preservation, real topic structure,
citation keys, idempotent preparation, fresh build directories, source/PDF staleness,
missing compiler and unresolved-reference/missing-glyph publication failures.
Model eval specifications now cover automatic handoff, legacy migration and existing
LaTeX revision. They have not been run with a live model in this change.

## Remaining validation boundary

Compilation and contract tests do not establish scientific correctness or long-paper
layout quality. Actual review runs still need source-grounded content review and
visual inspection of their own PDFs. This change retains topic-based evidence notes;
per-paper note migration and the new research review loop belong to later Sprint 1 work.
