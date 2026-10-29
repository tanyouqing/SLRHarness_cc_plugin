import {hash} from './domain.js';
import type {Draft,ConsolidationDecision} from './agents.js';

export const consolidationAlgorithm='retrieval-v1';
export function versionDraft(draft:Omit<Draft,'version'>|Draft):Draft {
  return {...draft,version:hash({experience:draft.experience,sources:draft.sources})};
}
export function migrateConsolidation(progress:any) {
  if(progress.consolidation?.algorithm===consolidationAlgorithm)return false;
  const old=progress.consolidation??{};
  progress.consolidation={algorithm:consolidationAlgorithm,next:old.next??0,
    current:old.current?versionDraft(old.current):null,items:(old.items??[]).map(versionDraft),
    decisions:old.decisions??[],legacyCursor:{compare:old.compare??0,assessed:old.assessed??false},
    currentProtected:Boolean(old.current&&(old.decisions??[]).some((d:any)=>d.action==='merge'&&d.candidateId===old.current.candidateId)),
    retrievalCount:0,agentDecisionCount:0,snapshot:null,indexPending:true};
  return true;
}
export function advanceCandidate(progress:any) {
  const c=progress.consolidation;
  if(!c.current && c.next<progress.candidates.length) {
    c.current=versionDraft({...progress.candidates[c.next],candidateId:`candidate-${c.next}`});c.next++;
    c.currentProtected=false;c.snapshot=null;
  }
  if(!c.current && c.next===progress.candidates.length) {
    progress.finalCandidates=c.items.map(({candidateId,version,...rest}:Draft)=>rest);
    progress.phase='submitting';progress.children=[];progress.submitted=0;
  }
}
export function snapshotTargets(c:any):Draft[] {
  if(!c.snapshot || c.snapshot.currentId!==c.current?.candidateId || c.snapshot.version!==c.current?.version)
    throw new Error('stale consolidation retrieval snapshot');
  return c.snapshot.targets.map((ref:any)=>{
    const item=c.items.find((d:Draft)=>d.candidateId===ref.candidateId&&d.version===ref.version);
    if(!item)throw new Error('retrieved target version changed');return item;
  });
}
export function applyConsolidation(c:any,decision:ConsolidationDecision) {
  c.decisions.push({...decision,algorithm:consolidationAlgorithm});c.agentDecisionCount++;
  if(decision.action==='keep') {c.items.push(c.current);c.current=null;}
  else if(decision.action==='drop')c.current=null;
  else {
    const ids=new Set(decision.targets!.map(t=>t.candidateId));
    const sources=[...new Map([c.current,...c.items.filter((d:Draft)=>ids.has(d.candidateId))]
      .flatMap((d:Draft)=>d.sources).map((s:any)=>[hash(s),s])).values()];
    c.current=versionDraft({candidateId:c.current.candidateId,experience:decision.experience!,sources});
    c.items=c.items.filter((d:Draft)=>!ids.has(d.candidateId));c.currentProtected=true;
  }
  c.snapshot=null;c.indexPending=true;
}
export function distillationProgress(row:any) {
  const p=row.checkpoint,c=p?.consolidation;
  const phase=p?.phase??(Array.isArray(p?.children)?'waiting':'segments');
  return {phase,completed_segments:p?.next??0,total_segments:p?.total??null,waiting_for_children:phase==='waiting',
    candidate_count:p?.candidates?.length??0,consolidated_count:p?.finalCandidates?.length??null,strategy_count:row.result?.ids?.length??null,
    consolidation_algorithm:c?.algorithm??(c?'legacy-pairwise':null),
    processed_candidates:c?Math.max(0,c.next-(c.current?1:0)):0,retained_count:c?.items?.length??0,
    retrieval_count:c?.retrievalCount??0,agent_decision_count:c?.agentDecisionCount??0,
    wait_reason:row.status==='failed'?'failed':row.status==='succeeded'?null:
      phase==='waiting'?'child_ingestion':c?.indexPending?'index_pending':row.status==='queued'?'scheduler':null};
}
