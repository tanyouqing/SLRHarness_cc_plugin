import fs from 'node:fs';
import path from 'node:path';
import {loadState} from './pipeline.mjs';
import {workspaceRoots} from './workspace-context.mjs';

export function resolveBinding(input) {
  if(!input.agent_id)return null;
  const matches=[];
  for(const root of workspaceRoots(input))try {
    const state=loadState(root),side=path.join(root,'.slr/paper-bindings.json');
    const b=state.bindings?.[input.agent_id]??(fs.existsSync(side)?JSON.parse(fs.readFileSync(side,'utf8'))[input.agent_id]:null);
    const reviewFile=path.join(root,'.slr/final-review.json');
    const finalReview=fs.existsSync(reviewFile)?JSON.parse(fs.readFileSync(reviewFile,'utf8')):null;
    if(b)matches.push({root,state,b,finalReview});
  }catch{/* broken or ambiguous assignments never grant permissions */}
  return matches.length===1?matches[0]:null;
}
