import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {connectClient,call,waitJob} from './client.js';
const [mode,id,desired]=process.argv.slice(2),client=await connectClient();
try {
  if(mode==='submit-paper') {
    const fixture=JSON.parse(await readFile('examples/paper.json','utf8'));
    fixture.metadata.title+=` fault-check ${Date.now()}`;fixture.note+=`\n\nUnique fault-case ${Date.now()}.`;
    console.log(JSON.stringify(await call(client,'submit_paper',fixture)));
  } else if(mode==='submit-trajectory') {
    const content=(await readFile('examples/trajectory.jsonl','utf8')).trimEnd()+`\n${JSON.stringify({type:'fault_fixture',at:Date.now()})}`;
    console.log(JSON.stringify(await call(client,'submit_trajectory',{content})));
  } else if(mode==='await-state') {
    if(desired==='succeeded')console.log(JSON.stringify(await waitJob(client,id)));
    else {
      const deadline=Date.now()+180_000;
      let done=false;
      while(Date.now()<deadline) {
        const job=await call(client,'get_job',{job_id:id});
        if(job.status==='failed'){console.log(JSON.stringify(job));done=true;break;}
        if(job.status==='succeeded')throw new Error('fault injection unexpectedly succeeded');
        await new Promise(r=>setTimeout(r,1000));
      }
      assert.ok(done,'job did not reach failed within timeout');
    }
  } else if(mode==='persistence') {
    const report=JSON.parse(await readFile('reports/smoke.json','utf8')),p=report.persistence;
    assert.ok(p,'run successful smoke first');
    for(const [type,key] of [['paper','paper_id'],['experience','experience_id'],['trajectory','trajectory_id']]) {
      const result=await call(client,'read',{type,id:p[key]});assert.equal(result.id,p[key]);
    }
    console.log(JSON.stringify({persistence:'passed'}));
  } else throw new Error('unknown cloud-case mode');
} finally {await client.close();}
