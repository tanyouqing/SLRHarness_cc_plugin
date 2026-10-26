import {rubricFor} from '../scripts/review-rubrics.mjs';
// Synthetic control-flow data. Never use these reference/score assertions as research evidence.
import fs from 'node:fs';
import path from 'node:path';
import {RUBRIC_VERSION, finalReviewControl} from '../scripts/final-review.mjs';
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
  return {rubricVersion:RUBRIC_VERSION,items:Object.entries(rubricFor(RUBRIC_VERSION).maxima).map(([id,max])=>{const score=Math.min(max,remaining);remaining-=score;return {id,score,location:'Synthetic section 1',evidence:'Fixture control-flow observation only',reason:'Programmatic test, not a scientific judgment'};}),total,passed:total>=70,
    comparison:{status:available?'complete':'unavailable',searchLog:'Synthetic search fixture; no actual retrieval',alignment:'Synthetic same-scope test',unavailableReason:available?undefined:'Synthetic access failure',
      references:available?[{id:'ref-1',title:'Synthetic test reference',authors:['Fixture Author'],year:2025,url:'https://example.invalid/survey',version:'test',fulltext:'fulltext_read',match,reason:'Control-flow test',verification:'Synthetic assertion only'}]:[],
      differences:available?[{id:'diff-1',referenceId:'ref-1',kind:'gap',dimension:'synthesis',manuscriptLocation:'Fixture section 1',referenceLocation:'Fixture section 2',observation:'Synthetic comparison gap',conditions:'Only a deterministic fixture'}]:[]},
    experiences:available?[{sourceType:'review',role:'manager',executionSummary:'Synthetic manuscript section 1 omits conditions distinguished in reference section 2 (diff-1); internal cause unknown.',strategy:'Group results by matching study conditions before comparing methods; verify that each comparison states those conditions.',applicability:'Only when the source material records relevant study conditions.'}]:[],
    issues:total<70?[{id:'issue-1',kind:'topic',severity:'critical',topicIds:['retrieval'],location:'Fixture section',evidence:'Synthetic unsupported claim',action:'Repair fixture statement',acceptance:'Remove unsupported comparison'}]:[],
    priorIssueChecks:priorIssues.map(i=>({issueId:i.id,status:'resolved',evidence:'Synthetic repaired section'}))};
}
export function submitAndRecord(root,report) {
  const c=finalReviewControl(root,'submit'),sub=c.submissions.at(-1),reviewerId=`final-${sub.id}`;
  finalReviewControl(root,'bind',{agentId:reviewerId});
  return finalReviewControl(root,'record',{submissionId:sub.id,fingerprint:sub.fingerprint,reviewerId,report});
}
