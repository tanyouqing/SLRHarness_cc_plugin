# Initial scoping contract

Use explicit user settings and the review skill defaults without initial configuration questions.
The Scoper determines any unspecified date range during reconnaissance, recording
its rationale and the search cutoff. Do not invent a fixed paper-count target or cap.
Default research evidence is academic papers and verifiable preprints; authoritative
technical documentation serves background and supplementary explanation.
The default objective is a professional synthesis for domain researchers: taxonomy,
method relationships, conditional comparisons and limitations.
Use PICO/PICo or an explicit question decomposition as appropriate. Define terms,
synonyms, source channels, reproducible queries, inclusion/exclusion criteria,
comparison dimensions with units/conditions and expected evidence depth.

Read relevant human surveys and compare their scope, dates, taxonomy and coverage;
do not copy one survey's categories without examining their fit. Record title,
canonical URL, scope match, useful concepts and unverified points in scoping.md.
Scoper material is discovery evidence; substantive claims used in the final paper
must be checked and incorporated into accepted paper records during research.

SCOPE_DRAFT.md must contain Output Language, Review Configuration, Research Question,
Search Strategy, Eligibility, Comparison Dimensions, Survey Outline and Limitations.
Survey Outline must separate two explicit groups:
1. Global sections (owner: Paper Agent): Abstract, Introduction, Background OR
   Preliminaries, Taxonomy OR Unified Framework, Comparative Analysis and Evaluation,
   Challenges and Future Directions, Conclusion. Choose one heading in each OR pair.
   Scoper proposes their placement and intended content, not dedicated Managers.
2. Research topic chapters (owner: one Manager per topic): 3–5 substantive topics,
   each with stable slug ID, actual title, research question/boundary, classification
   relationship, initial sources/rationale and optional subtopic suggestions.
Only group 2 enters draft.topics and the state topic registry. Global sections are
excluded from the 3–5 count even if renamed. Managers determine actual subtopics.
Topic ordering follows conceptual relationships or chronology. If evidence cannot
support 3–5 coherent research topics, resolve scope before approval; never fill the
quota using background, taxonomy or other global sections.
For example, a RAG scope may have three research topics: dense/hybrid retrieval,
GraphRAG and Agentic RAG, with three Managers. Preliminaries and Unified Framework
remain additional Paper Agent sections; this is an ownership example, not a required
RAG taxonomy. Managers contribute their supporting evidence through synthesis.md.

State the sources and uncertainty behind classification. Scope is a protocol, not
review findings or a predetermined included-paper list. Scope approval freezes the
core question, criteria, output language, budgets and topic boundaries. Managers
may refine subtopics inside their boundaries. Cross-topic refinements go to the
main session and are recorded in the Scope Evolution Log; a changed core question
requires a new approved review. Preserve SCOPE_ORIGINAL.md byte-for-byte.
