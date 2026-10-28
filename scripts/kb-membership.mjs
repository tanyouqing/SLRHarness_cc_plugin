import fs from 'node:fs';
import {json,safe} from './kb-core.mjs';

// These are trajectory producers, not the four experience applicability roles.
export const researchRoles=new Set(['worker','manager','scoper','paper','checker','reviewer']);
export const nativeRoles={'slr-worker':'worker','slr-manager':'manager','slr-scoper':'scoper','slr-paper-writer':'paper','slr-checker':'checker','slr-reviewer':'reviewer'};
export function researchBindings(root) {
  const read=relative=>{const f=safe(root,relative);return fs.existsSync(f)?json(f):{};};
  return {...read('.slr/state.json').bindings,...read('.slr/paper-bindings.json')};
}
export function membership(id,agent,bindings) {
  const binding=bindings[id],role=researchRoles.has(binding?.role)?binding.role:agent.role;
  return {role:researchRoles.has(role)?role:'other',required:researchRoles.has(role),
    reason:researchRoles.has(binding?.role)?'pipeline_binding':researchRoles.has(agent.role)?'recognized_research_role':'unclassified_observation'};
}
