# Survey writing contract

Use template/neurips_2026.tex, preprint mode, single main.tex plus references.bib and original neurips_2026.sty. Keep author empty absent supplied identity. Do not include checklist. Default English, author–year citations, 6,000–9,000 words, no imposed conference page limit. For Chinese enable surveychinesetrue; compile with XeLaTeX.

Required ordered sections and labels:
- Abstract: question, organization, central findings and scope boundaries.
- Introduction (sec:introduction): significance, relationship to existing surveys, scope, contributions, documented search/screening method and reading route. Use scope reconnaissance plus topic syntheses.
- Background OR Preliminaries (sec:background): select one suitable title. Explain only necessary tasks, terms, notation and concepts; resolve definitions against primary notes.
- Taxonomy OR Unified Framework (sec:taxonomy): select one title. Explain dimensions and category boundaries matching subsequent topics.
- Each approved major topic is a directly named top-level section (sec:topic-<slug>). Use all 3–5 v2 topics, ordered by the taxonomy. Managers' reviewed chapter.md supplies the technical synthesis; worker task boundaries need not equal subsections. No generic Survey of Existing Approaches heading or Topic Name placeholder.
- Comparative Analysis and Evaluation (sec:comparison): compare only with explicit tasks, datasets, metrics and budgets. Explain coverage and comparability limitations. Do not imply unperformed experiments or unify incomparable results into an ordering.
- Challenges and Future Directions (sec:challenges): connect proposals to evidenced gaps, conflicts and limitations; distinguish literature findings from author inference.
- Conclusion (sec:conclusion): consolidate main findings and boundaries without new evidence.
- References via \bibliographystyle{plainnat} and \bibliography{references}.

Topic prose synthesizes research questions, evolution, representative methods, applicability and limitations across papers. Avoid a sequence of disconnected paper summaries. In v2 translate [@p-...] citations into \citet / \citep using the same stable IDs as BibTeX keys. Source metadata comes from canonical cards, actual claims from notes and exact locations. Targeted rereading is mandatory for pivotal definitions, quantitative claims and contradictions. Preserve all accepted chapters' technical meaning. Resolve minor issues directly through supported wording and qualification. Disclose remaining concerns for the final Reviewer; the writer does not stop assembly or reopen Manager research itself. Main may later authorize a scoped repair from the final assessment.

Legacy completed workspaces may derive topics from recorded scope and final notes if no outline exists; disclose this reconstruction. Use only verifiable source-backed facts, never historical evaluative annotations to order literature. Existing Markdown is preserved as a draft reference. Do not create new research or alter historical workspaces.

Before handoff verify citations, version consistency, actual topic titles, all section bodies, complete argument and evidence boundaries. This stage uses lightweight proofreading; main runs the separate final Reviewer after successful compilation for schema 2.

Global-section authorship belongs to Paper Agent, including Introduction, Background
OR Preliminaries and Taxonomy OR Unified Framework. Paper Agent is both author and
assembler. The 3–5 Manager chapters are additional substantive research topics.
Use synthesis.md for global-section evidence; its background/taxonomy fields are
not separately commissioned global chapter drafts. Main must resolve any scope
ownership mismatch before dispatch, rather than commissioning duplicate chapters.
