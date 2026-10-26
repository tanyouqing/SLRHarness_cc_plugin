# Conference templates and official format audit — 2026-10-26

New workspaces persist conference selection (default NeurIPS, NIPS alias) and use
registered preprint survey adapters plus compact writing guides. Writing is followed
by a fresh Paper Agent official-source audit, up to three format repairs, compilation
and final Reviewer. Website-incomplete verification is disclosed and may proceed;
known major format defects pause. Existing workspaces without configuration retain
their original NeurIPS build and writing fingerprint semantics.

## Static and deterministic verification

- Pre-simplification deterministic baseline: **100 passed, 0 failed**. Command:
  `node --test tests/*.test.mjs`. Transcript: production artifact directory tests.txt.
- Plugin manifest validation, JavaScript syntax checks and git diff whitespace checks.
- All original upstream file hashes preserved. Guide hashes and protected neutral
  adapters validated; LF checkout policy keeps guide hashes portable.
- Deterministic tests cover CLI default/explicit/unresolved selection, language
  normalization, status read-only behavior, preserved legacy hashes, six dependency
  manifests and unsupported AAAI Chinese. The former report protocol is superseded
  by inline completion; current tests cover source/PDF invalidation, unavailable
  URLs, refresh history and actual-PDF completion requirements,
  repair-to-pass and three-repair pause, snapshot inclusion, writer/format/reviewer
  exclusion, scoped web/source permissions and rejected format-report writes.
- Existing research, shared-paper ownership, context, nine-Worker budget, final
  69/70 threshold and bounded final-review repair tests remain in the suite.
- These use explicitly synthetic completion attestations/PDF bytes where indicated. They establish
  control behavior, not website interpretation or genuine Agent judgment.

## Actual TeX and PDF checks

Command: `node evals/template-library-smoke.mjs <new-absolute-output-directory>`.
Verified profiles run production configure/prepare/build with isolated .build
directories, no shell escape, no latexmk rc, and real BibTeX. Candidate profiles
can be compiled without changing verification flags. TeX Live 2026 on Windows.

| Conference | Edition / style | English pdfLaTeX | Chinese XeLaTeX |
|---|---|---|---|
| NeurIPS | 2026 | Passed | Passed |
| ICLR | 2027 | Passed | Passed |
| ICML | 2026 | Passed | Passed |
| AAAI | 2027, October kit | Passed | Unsupported by official engine guard |
| ACL | 2026, shared pinned style | Passed | Passed |
| EMNLP | 2026, shared pinned style | Passed | Passed |

All eleven supported production builds returned success and current=true, no
unresolved references/citations, missing glyphs or overfull layout warnings.
Minimal fixture PDFs have one page each. Poppler rendered all pages; visual
inspection found no clipping or missing content. Production renders matched the
inspected adapter renders pixel-for-pixel. Chinese sample text is extractable.
No sample author, AUTHORERR placeholder, submission or acceptance statement remains.

Adapter fixes discovered during actual verification:

- AAAI requires an explicit empty affiliations declaration with empty authors.
- ACL/EMNLP and AAAI own their bibliography styles; a second bibliographystyle fails.
- ICLR has no official preprint switch. Its protected local adapter suppresses the
  review ruler, exposes supplied author information and replaces the publication
  header with a neutral preprint notice; the official style file is untouched.
- ICML's original notice emits AUTHORERR for absent correspondence. The protected
  local wrapper leaves missing identities empty and retains the preprint notice.

Local development artifacts (outside the plugin Git repository):
`../output/multi-template-production-20261026/results.json` and `visual-checks.json`;
candidate investigation under `../output/multi-template-smoke-20261026*`.
These are compiler fixtures, not scientific surveys or ready-to-submit manuscripts.

## Official source review and remaining validation

During implementation, the registered NeurIPS, ICLR, ICML, AAAI, ACL, EMNLP,
ACLPUB and ARR official pages were read to prepare the short guides. Exact links
and editions are in the library catalog and SOURCES.md. A run's Paper Agent must
fetch them again; implementation-time browsing does not satisfy a runtime audit.

Not executed: real Claude Paper Agent conference-intent interpretation, independent
website audit, semantic formatting decisions, live repair loop, or a complete
research-to-Reviewer run with this feature. Also not tested: real 6,000–9,000-word
manuscripts, dense figures/tables, arbitrary user author blocks and cloud TeX versions.
The eleven minimal compilations do not imply those scenarios have passed. No
unverified engine combination is marked available and no single-paper ranking
mechanism was introduced.

## Current format and Reviewer contract

Format checking uses one fresh Paper Agent to inspect selected official requirements
and directly repair sources, without a format report. Main retains only completion,
repair count and fingerprints, compiles changes and rechecks the new PDF. The shared
writer output fingerprint is used by both writing and format controllers.

Reviewer reads approved SCOPE.md, the manuscript, human reference surveys and its own
bounded review findings. It scores six dimensions and emits experiences.json using
the shared experience schema. Current deterministic results and real-Agent limits
are recorded in pipeline-validation.md; earlier compiler evidence above remains
separate from model-level verification.
