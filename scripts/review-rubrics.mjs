// The single supported rubric. The identifier protects fingerprints from stale scores.
export const RUBRIC_VERSION='survey-2';
export const RUBRIC={coverage:15,taxonomy:15,evidence:25,synthesis:20,critique:15,presentation:10};
export const ITEM_IDS=Object.keys(RUBRIC);
const definition={maxima:RUBRIC,path:'skills/paper/references/rubric.md',inputPolicy:'scope-manuscript-v2'};
export function rubricFor(version) {
  if(version!==RUBRIC_VERSION)throw new Error('unsupported rubric version; only the current six-dimension rubric is supported');
  return definition;
}
