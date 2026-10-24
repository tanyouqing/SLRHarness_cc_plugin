// Synthetic host-capability probe, never research evidence or a real survey.
import fs from 'node:fs';
import path from 'node:path';
import {seed,topics,write} from './fixture-lib.mjs';
import {mutate} from '../scripts/pipeline.mjs';
import {contextControl} from '../scripts/context-control.mjs';
const project=path.resolve(process.argv[2]??'');
if(!process.argv[2]||fs.existsSync(project))throw new Error('provide a new absolute probe project directory');
fs.mkdirSync(project,{recursive:true});
const root=path.join(project,'workspaces','fixture-review');seed(root);contextControl(root,'enable');mutate(root,'begin-round');
for(const id of topics) {
  const tasks=[{id:'first',question:'Synthetic delivery probe',boundary:'Write a no-evidence discovery fixture; do not search'}];
  write(root,`topics/${id}/plan.json`,JSON.stringify({topicId:id,tasks}));mutate(root,'plan',{topicId:id,tasks});
}
write(project,'probe-prompt.txt',`This is a bounded synthetic runtime probe, not a literature review. Do not search or write scientific claims. Plugin root is ${path.resolve('.')}. Workspace is ${root}.
Initialize one slr-harness:slr-manager with INITIALIZE, capture its actual ID, and bind it using pipeline.mjs bind with role manager and topicId retrieval. Do not invent IDs. All three topic plans have already been imported and the planning barrier is open.
Delegate only this work: through manager-control request reserve for task first; launch one slr-harness:slr-worker with INITIALIZE SLR_LEASE=<reserved ID>; capture and bind its real ID; resume it to write topics/retrieval/tasks/first/search.md stating synthetic no-search probe and candidates.json containing {"candidates":[],"noEvidenceReason":"Synthetic no-evidence delivery probe; no research performed"}. After confirmed stopped status, Manager must submit finish-discovery using the assigned task files. If a role/control tool is unavailable, report that actual limitation and stop; do not take over Worker work or bypass permissions. Manager stays alive until the child finishes. Main returns a concise account of actual nesting and runtime IDs. Stop after this one delivery. Do not finalize research or run writing/review.
`);
console.log(JSON.stringify({project,workspace:root,prompt:path.join(project,'probe-prompt.txt')}));
