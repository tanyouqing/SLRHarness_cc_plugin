// Intent is interpreted by the main session, not by keyword matching here.
export const RESEARCH_TARGETS = Object.freeze({low:30,medium:60,high:90});
const sources = new Set(['default','explicit','inferred','conflict']);
const shortText = value => typeof value==='string' && value.trim().length>0 && value.length<=1000;

export function normalizeResearchProfile(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('invalid researchProfile');
  const tier=input.tier??'medium';
  const profile={tier,targetPapers:input.targetPapers??RESEARCH_TARGETS[tier],
    source:input.source??'default',targetSource:input.targetSource??'tier',
    rationale:input.rationale??((input.source??'default')==='default' && tier==='medium' && (input.targetSource??'tier')==='tier'
      ? 'No research-depth setting supplied; use medium.' : undefined)};
  const errors=validateResearchProfile(profile);
  if(errors.length) throw new Error(errors.join('; '));
  return profile;
}

export function validateResearchProfile(p) {
  if(!p || typeof p!=='object' || Array.isArray(p)) return ['invalid researchProfile'];
  const errors=[];
  if(!Object.hasOwn(RESEARCH_TARGETS,p.tier)) errors.push('invalid research tier');
  if(!Number.isSafeInteger(p.targetPapers) || p.targetPapers<1) errors.push('invalid targetPapers');
  if(!sources.has(p.source) || !['tier','explicit'].includes(p.targetSource)) errors.push('invalid profile source');
  if(['default','conflict'].includes(p.source) && p.tier!=='medium') errors.push('default/conflict tier must be medium');
  if(p.targetSource==='tier' && p.targetPapers!==RESEARCH_TARGETS[p.tier]) errors.push('tier target mismatch; custom count requires explicit targetSource');
  if(!shortText(p.rationale)) errors.push('profile rationale must contain 1–1000 characters');
  return errors;
}

export function researchScale(s) {
  const papers=Object.values(s.papers??{}),accepted=papers.filter(p=>p.status==='final').length;
  const target=s.researchProfile?.targetPapers??null;
  return {profile:s.researchProfile??null,registered:papers.length,accepted,
    pending:papers.length-accepted,shared:papers.filter(p=>(p.topicIds?.length??0)>1).length,
    remaining:target===null?null:Math.max(0,target-accepted),
    remainingAfterPending:target===null?null:Math.max(0,target-papers.length),
    targetReached:target===null?null:accepted>=target};
}

export function scaleCompletion(s,reason) {
  const scale=researchScale(s),target=s.researchProfile?.targetPapers;
  if(!target) return null;
  if(scale.accepted!==target && !shortText(reason)) throw new Error('provide scaleReason (1–1000 characters) explaining actual paper count versus soft target');
  if(reason!==undefined && !shortText(reason)) throw new Error('invalid scaleReason');
  return {...scale,difference:scale.accepted-target,reason:reason??'Soft target reached; chapter coverage checked separately.'};
}
