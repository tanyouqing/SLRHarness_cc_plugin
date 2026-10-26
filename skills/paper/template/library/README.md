# Conference LaTeX source library

Verified and downloaded on **2026-10-26** from official conference sites or the
official ACL organization repository. Six venue entries use five distinct upstream
packages. New workspaces select the registered survey skeleton and compact guide
from this catalog; the parent NeurIPS files serve only workspaces without a selection.

| Venue | Verified version | Local entrypoint |
|---|---|---|
| NeurIPS / NIPS | 2026 | `neurips/2026/upstream/neurips_2026.tex` |
| ICLR | 2027 | `iclr/2027/upstream/iclr2027_conference.tex` |
| ICML | 2026 | `icml/2026/upstream/example_paper.tex` |
| AAAI | 2027, October 2026 author kit | `aaai/2027/upstream/AnonymousSubmission2027.tex` |
| ACL | Shared commit `d5adc823ff0f` | `acl/shared-d5adc823ff0f/upstream/acl_latex.tex` |
| EMNLP | Same pinned ACL style | `acl/shared-d5adc823ff0f/upstream/acl_latex.tex` |

## Sources and requirements

- [Official websites and submission/formatting pages](SOURCES.md) records homepages,
  edition websites, author instructions and template sources. ACL/EMNLP include ARR
  and ACLPUB requirements as well as the respective conference call for papers.
- [catalog.json](catalog.json) records download URLs, resolved AAAI URL, archive
  SHA-256/size, date, Git commit, entrypoints and file manifests.
- Each venue has a README. Each source package has a `files.json` with SHA-256 and
  size for every file. Catalog paths are relative to this library; file-manifest
  paths are relative to the package's upstream directory.

ACL and EMNLP share an unyear-numbered official style. Their 2026 requirement pages
are recorded separately. ICML 2026 is the latest official template located during
this check; no 2027 author template was located. Recheck the edition/track before use.

## Preservation and use

Upstream bytes, copyrights and supplied notices are preserved. `.gitattributes`
disables upstream line-ending conversion so hashes survive a clone. Archive wrapper
directories were removed. The AAAI Word subtree and ACL repository CI/tests were
excluded; LaTeX sources, local dependencies, supplied figures, reference examples and
instructions remain. Archive hashes are recorded; redundant ZIPs are not committed.

These are official instructional examples, including sample authors, prose,
citations and conference declarations. Do not treat them as survey evidence or copy
their authors/claims into a manuscript. Adapt a separate working copy; preserve
upstream. Venue instructions do not silently override the harness writing contract.

The existing adapted parent NeurIPS files remain the legacy fallback. New workspaces
use the catalog's separate survey/main.tex and compact guide.md for the selected
conference. All selectable profiles are preprints, not submission certification.
The initial prompt selects the venue; otherwise NeurIPS is persisted. Original
style files are copied with hash checks; the selected dependencies and configuration
enter build and final-review fingerprints. ICLR requires a neutral header adapter;
ICML requires an empty-identity notice wrapper. Both live in protected skeleton
blocks and leave upstream styles unchanged. AAAI Chinese/XeLaTeX is unsupported.

See [format control](../../references/conference-format.md) for the official
post-writing audit and [current validation](../../../../docs/conference-format-validation.md).

## Original upstream acquisition checks

- All **38 vendored files** in five packages matched their recorded hashes/sizes;
  all six catalog entries resolve to existing sources.
- Real `latexmk -norc -pdf -bibtex -interaction=nonstopmode -halt-on-error
  -no-shell-escape <entrypoint>` builds succeeded for all five primary examples in
  separate copies with TeX Live 2026. ACL also covers the identical EMNLP source.
  These builds use pdfLaTeX, not the harness's existing XeLaTeX adapter.
- Final logs had no unresolved references/citations or missing-glyph messages.
  Upstream warnings remain: ICLR reports an end-inside-group warning; ICML and AAAI
  each report an overfull horizontal box. Upstream was not edited to remove them.
- Generated PDFs/logs are outside the repo at the local development workspace's
  `output/template-compile-20261026/`. Supplied upstream PDFs remain in the library
  and were not used as proof of compilation success.
- Visual PDF inspection, alternate AAAI/ACL entrypoints, Chinese output, survey
  adaptation and real Paper Agent runs were not tested.
- Existing prompt-contract and paper-build regression checks: 16 passed, 0 failed.
  These are separate from the five real upstream sample compilations above.

Current adapter validation: all six English and five supported Chinese minimal
surveys compile. The source acquisition checks above describe the earlier original
examples; adapted survey checks and remaining real-Agent limits are recorded in
docs/conference-format-validation.md at the repository root.
