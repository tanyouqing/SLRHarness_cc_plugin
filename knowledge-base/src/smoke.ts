import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {connectClient,call,waitJob} from './client.js';
const client=await connectClient(),report:any={started_at:new Date().toISOString(),checks:[],decisions:[]};
const run=Date.now().toString();
async function settled(receipt:any) {return receipt.status==='duplicate' && receipt.id ? {ids:[receipt.id]} : await waitJob(client,receipt.job_id);}
try {
  assert.equal((await client.listTools()).tools.length,7);report.checks.push('seven tools');
  const paper=JSON.parse(await readFile('examples/paper.json','utf8'));
  paper.metadata.title+=` ${run}`;paper.note+=`\n\nRun marker: ${run}.`;
  const first=await settled(await call(client,'submit_paper',paper));
  const paperId=first.ids[0], before=await call(client,'read',{type:'paper',id:paperId});
  const duplicate=await call(client,'submit_paper',paper);
  assert.equal(duplicate.status,'duplicate');assert.equal(duplicate.id,paperId);report.checks.push('paper idempotency');
  const supplement=await settled(await call(client,'submit_paper',{...paper,note:paper.note+'\n\n## Additional limitation\nEvaluation uses synthetic data only; conclusions do not establish real survey quality.'}));
  report.decisions.push({scenario:'paper supplement',result:supplement});
  const historical=await call(client,'read',{type:'paper',id:paperId,revision:before.revision});
  assert.deepEqual(historical.content,before.content);report.checks.push('historical revision immutable');
  const review=JSON.parse(await readFile('examples/review.json','utf8'));
  review.experience.task+=` (${run})`;
  const experience=await settled(await call(client,'submit_experience',review));
  const e=await call(client,'read',{type:'experience',id:experience.ids[0]});
  assert.equal(e.content.sourceType,'review');report.checks.push('review without source materials');
  const dupReview=await call(client,'submit_experience',review);assert.equal(dupReview.id,e.id);report.checks.push('experience idempotency');
  const minimal=JSON.parse(await readFile('examples/review-minimal.json','utf8'));
  minimal.experience.strategy+=` (${run})`;
  const minimalResult=await settled(await call(client,'submit_experience',minimal));
  const minimalRecord=await call(client,'read',{type:'experience',id:minimalResult.ids[0]});
  for(const key of ['stage','task','applicability'])assert.equal(minimalRecord.content[key],undefined);
  const minimalSearch=await call(client,'search_strategies',{query:minimal.experience.strategy,filters:{role:'worker',stage:'optional_context_probe',sourceType:'review'}});
  assert.ok(minimalSearch.results.some((r:any)=>r.id===minimalRecord.id));
  report.checks.push('optional experience fields omitted; indexed and recalled with stage filter');
  const trajectory=(await readFile('examples/trajectory.jsonl','utf8')).trimEnd()+`\n${JSON.stringify({type:'fixture_run',run})}\n`;
  const t=await call(client,'submit_trajectory',{content:trajectory});
  assert.equal(t.status,'stored');assert.ok(t.id && t.job_id);
  const td=await call(client,'submit_trajectory',{content:trajectory});assert.equal(td.id,t.id);assert.equal(td.job_id,t.job_id);
  report.checks.push('trajectory stored before automatic distillation; duplicate reuses job');
  const distillation=await waitJob(client,t.job_id);
  for(const id of distillation.ids) {
    const record=await call(client,'read',{type:'experience',id});
    assert.ok(record.sources.some((s:any)=>s.id===t.id));
  }
  report.distillation=distillation;
  if(!distillation.ids.length)report.checks.push('distillation completed with no candidates; inspect semantic quality manually');
  else report.checks.push('distilled strategy sources verified');
  for(const query of ['retrieval evaluation','检索与实验条件']) {
    const papers=await call(client,'search_papers',{query,filters:{year_from:2025,year_to:2025}});
    assert.ok(papers.results.length);assert.ok(papers.results.every((r:any)=>r.metadata.year===2025));
  }
  const strategies=await call(client,'search_strategies',{query:review.experience.strategy,filters:{role:'worker',stage:'paper_reading',sourceType:'review'}});
  assert.ok(strategies.results.length);assert.ok(strategies.results.every((r:any)=>r.role==='worker' && (r.stage===undefined || r.stage==='paper_reading')));
  report.checks.push('Chinese/English hybrid searches and type-specific filters');
  const conflict=structuredClone(paper);
  conflict.note+='\n\n## Contradictory statement\nThis incoming fixture claims all evaluation used real production data, contradicting the synthetic-data limitation. Preserve the disagreement.';
  report.decisions.push({scenario:'paper conflict',result:await settled(await call(client,'submit_paper',conflict))});
  report.persistence={paper_id:paperId,revision:before.revision,trajectory_id:t.id,experience_id:e.id};
  report.status='passed_structural_checks';
} catch(error) {report.status='failed';report.error=error instanceof Error?error.message:String(error);process.exitCode=1;}
finally {
  report.finished_at=new Date().toISOString();await mkdir('reports',{recursive:true});
  await writeFile('reports/smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await client.close();
}
