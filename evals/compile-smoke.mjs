import fs from 'node:fs';
import path from 'node:path';
import {complete,manuscript} from './fixture-lib.mjs';
import {buildPaper,paperStatus} from '../scripts/paper-build.mjs';
const output=process.argv[2];
if(!output || !path.isAbsolute(output) || fs.existsSync(output)) throw new Error('provide a new absolute output directory');
fs.mkdirSync(output,{recursive:true});
for(const language of ['english','chinese']) {
  const root=path.join(output,language);
  complete(root);
  const paper=manuscript(root,{chinese:language==='chinese'});
  const result=buildPaper(paper);
  console.log(JSON.stringify({language,paper,...result,current:paperStatus(paper).current}));
  if(result.status!=='success') process.exitCode=1;
}
