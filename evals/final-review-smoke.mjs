import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {scaffold,manuscript,review} from './fixture-lib.mjs';
import {assessment,submitAndRecord} from './final-review-lib.mjs';
import {loadState,mutate} from '../scripts/pipeline.mjs';
import {buildPaper} from '../scripts/paper-build.mjs';
import {finalReviewControl,finalReviewStatus} from '../scripts/final-review.mjs';

const output=process.argv[2];
if(!output || !path.isAbsolute(output) || fs.existsSync(output))throw new Error('provide a new absolute output directory');
fs.mkdirSync(output,{recursive:true});
const root=scaffold('three-topic',output);
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const originalCheckpoint=git(['rev-parse','slr-complete']);
const paper=manuscript(root);
function compile(){const result=buildPaper(paper);if(result.status!=='success')throw new Error(JSON.stringify(result));return result;}
const initialBuild=compile();
const initial=submitAndRecord(root,assessment(69));
finalReviewControl(root,'begin-revision');mutate(root,'begin-round');
const record=Object.values(loadState(root).papers)[0];
mutate(root,'supplement',{paperId:record.id,reason:'Synthetic final review requests explicit comparison conditions',taskId:'review-conditions'});
mutate(root,'reserve',{topicId:record.owner.topicId,taskId:'review-conditions',leaseId:'final-repair'});
fs.appendFileSync(path.join(root,`papers/${record.id}/note.md`),'\nFixture repair: no empirical result or scientific comparison is established.\n');
mutate(root,'finish-read',{leaseId:'final-repair'});
mutate(root,'accept-paper',{paperId:record.id,checked:true,rationale:'Deterministic fixture reacceptance only'});
for(const topicId of loadState(root).revisionContext.topicIds) {
  fs.appendFileSync(path.join(root,`topics/${topicId}/chapter.md`),'\nRepaired fixture explicitly makes no scientific comparison.\n');
  review(root,topicId);
}
mutate(root,'end-round');mutate(root,'finalize',{scaleReason:'Synthetic control-flow fixture deliberately uses one shared paper; no real coverage claimed.'});
const state=loadState(root);
git(['add','.slr/state.json',...state.topics.map(t=>`topics/${t.id}/chapter.md`),`papers/${record.id}/note.md`]);
git(['-c','user.name=SLR Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture: accepted final-review repair evidence']);
const evidenceRef=git(['rev-parse','HEAD']);
const tex=path.join(paper,'main.tex');
fs.writeFileSync(tex,fs.readFileSync(tex,'utf8').replace('No experimental comparison or substantive survey conclusion is claimed.','No empirical ranking or scientific effectiveness claim is established by this repaired fixture.'));
const finalBuild=compile();
finalReviewControl(root,'submit',{evidenceRef});
submitAndRecord(root,assessment(70,{priorIssues:initial.submissions[0].assessment.issues}));
if(git(['rev-parse','slr-complete'])!==originalCheckpoint)throw new Error('original checkpoint changed');
const status=finalReviewStatus(root);
if(!status.complete)throw new Error('synthetic final-review loop did not complete');
const result={kind:'synthetic-final-review-real-tex',root,originalCheckpoint,evidenceRef,scores:status.submissions.map(s=>s.assessment.total),revisions:status.revisions.length,sharedPaperTopics:state.papers[record.id].topicIds,initialBuild,finalBuild,complete:status.complete,liveAgent:false};
fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
