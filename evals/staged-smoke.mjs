// Real LaTeX compiler over synthetic control-flow fixtures; no model/research claims.
import fs from 'node:fs';
import path from 'node:path';
import {complete,manuscript,write} from './fixture-lib.mjs';
import {contextControl} from '../scripts/context-control.mjs';
import {paperControl} from '../scripts/pipeline.mjs';
import {stageControl,writerReady} from '../scripts/work-stages.mjs';
import {buildPaper,paperStatus} from '../scripts/paper-build.mjs';
const root=process.argv[2];
if(!path.isAbsolute(root??'')||fs.existsSync(root))throw new Error('new absolute workspace required');
complete(root);manuscript(root);contextControl(root,'enable');
for(let i=0;!writerReady(root);i++) {
  const agentId=`synthetic-writer-${i}`;paperControl(root,'bind-paper',{agentId,role:'paper'});
  const phase=stageControl(root,'writer-start',{agentId});
  write(root,'paper/writing-handoff.md',`Synthetic smoke fixture; phase ${phase.phase}. No real Agent invoked.`);
  stageControl(root,'writer-finish',{agentId,phase:phase.phase,inputHash:phase.inputHash,stopped:true,runtimeEvidence:'Synthetic compiler test, no runtime agent'});
}
const result=buildPaper(path.join(root,'paper'));console.log(JSON.stringify({root,status:result.status,...paperStatus(path.join(root,'paper'))}));
if(result.status!=='success')process.exitCode=1;
