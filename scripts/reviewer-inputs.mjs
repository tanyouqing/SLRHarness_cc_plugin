import {rubricFor} from './review-rubrics.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const plugin=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const normalize=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const within=(base,p)=>p===base||p.startsWith(`${base}${path.sep}`);
// Main's full research snapshot is for recovery/invalidation, never Reviewer input.
export function reviewerReadAllowed(root,submissionId,tool,args,rubricVersion) {
  const rubric=rubricFor(rubricVersion);
  const base=path.join(root,'paper/reviews',submissionId);
  const files=[...['main.tex','references.bib','main.pdf'].map(f=>path.join(base,'snapshot/paper',f)),
    path.join(base,'prior-issues.json'),path.join(plugin,rubric.path),path.join(base,'snapshot/SCOPE.md'),
    path.join(plugin,'skills/paper/references/reviewer-input.md'),path.join(plugin,'agents/slr-reviewer.md')].map(normalize);
  const trees=['drafts','references','manuscript-pages'].map(d=>normalize(path.join(base,d)));
  const glob=tool==='Glob'?args.pattern:tool==='Grep'?args.glob:null;
  if(glob && (path.isAbsolute(glob) || glob.split(/[\\/]/).includes('..')))return false;
  const requested=tool==='Read'?args.file_path:args.path;
  if(typeof requested!=='string'||!path.isAbsolute(requested))return false;
  const target=normalize(requested);
  if(files.includes(target))return true;
  if(trees.some(base=>within(base,target)))return true;
  return tool==='Glob'&&target===normalize(path.join(base,'snapshot/paper'))&&['main.tex','main.pdf','references.bib'].includes(args.pattern);
}
