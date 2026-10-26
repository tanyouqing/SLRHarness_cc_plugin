// Synthetic control-flow data. Never use these reference/score assertions as research evidence.
import fs from 'node:fs';
import path from 'node:path';
import {ITEM_IDS, RUBRIC_VERSION, finalReviewControl} from '../scripts/final-review.mjs';
import {buildPaper} from '../scripts/paper-build.mjs';
export function mockCompile(root) {
  return buildPaper(path.join(root,'paper'),{run:(_command,args)=>{
    const out=args.find(x=>x.startsWith('-outdir=')).slice(8);
    fs.writeFileSync(path.join(out,'main.pdf'),'%PDF-1.4 synthetic deterministic fixture');
    fs.writeFileSync(path.join(out,'main.log'),''); return {status:0};
  }});
}
export function assessment(total=70,{match='same',available=true,priorIssues=[]}={}) {
  let remaining=total;
  return {rubricVersion:RUBRIC_VERSION,items:ITEM_IDS.map(id=>{const score=Math.min(5,remaining);remaining-=score;return {id,score,location:'Synthetic section 1',evidence:'Fixture control-flow observation only',reason:'Programmatic test, not a scientific judgment'};}),total,passed:total>=70,
    comparison:{status:available?'complete':'unavailable',searchLog:'Synthetic search fixture; no actual retrieval',alignment:'Synthetic same-scope test',unavailableReason:available?undefined:'Synthetic access failure',
      references:available?[{id:'ref-1',title:'Synthetic test reference',authors:['Fixture Author'],year:2025,url:'https://example.invalid/survey',version:'test',fulltext:'fulltext_read',match,reason:'Control-flow test',verification:'Synthetic assertion only'}]:[],
      differences:available?[{id:'diff-1',referenceId:'ref-1',kind:'gap',dimension:'synthesis',manuscriptLocation:'Fixture section 1',referenceLocation:'Fixture section 2',observation:'Synthetic comparison gap',conditions:'Only a deterministic fixture'}]:[]},
    suggestions:{scoper:[],manager:available?[{role:'manager',differenceId:'diff-1',attribution:'hypothesis',attributionEvidence:'Synthetic plan',action:'Clarify comparison',conditions:'Fixture only',expectedImprovement:'Explicit conditions',acceptance:'Conditions are stated'}]:[],worker:[],paper:[]},
    issues:total<70?[{id:'issue-1',kind:'topic',severity:'critical',topicIds:['retrieval'],location:'Fixture section',evidence:'Synthetic unsupported claim',action:'Repair fixture statement',acceptance:'Remove unsupported comparison'}]:[],
    priorIssueChecks:priorIssues.map(i=>({issueId:i.id,status:'resolved',evidence:'Synthetic repaired section'}))};
}
export function submitAndRecord(root,report) {
  const c=finalReviewControl(root,'submit'),sub=c.submissions.at(-1),reviewerId=`final-${sub.id}`;
  finalReviewControl(root,'bind',{agentId:reviewerId});
  return finalReviewControl(root,'record',{submissionId:sub.id,fingerprint:sub.fingerprint,reviewerId,report});
}
