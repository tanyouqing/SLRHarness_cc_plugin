import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withLock} from './pipeline.mjs';
import {enabled,saveRecovery,recoverySummary} from './context-control.mjs';

export function contextHook(input) {
  if(input.agent_id)return {}; // Main-session context only.
  const cwd=path.resolve(input.cwd??'.');
  const base=path.join(cwd,'workspaces');
  const roots=fs.existsSync(path.join(cwd,'.slr/state.json'))?[cwd]:fs.existsSync(base)?fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()).map(e=>path.join(base,e.name)):[];
  const active=roots.filter(r=>enabled(r));
  const index=[];
  for(const root of active) {
    if(fs.lstatSync(root).isSymbolicLink())continue;
    try {
      if(input.hook_event_name==='PreCompact')withLock(root,()=>saveRecovery(root));
      index.push({workspace:root,summary:'.slr/recovery.json',stage:recoverySummary(root).stage});
    } catch {index.push({workspace:root,warning:'State busy or unavailable; re-query before dispatch. Do not release leases.'});}
    if(JSON.stringify(index).length>5000){index.pop();index.push({more:'Additional workspaces omitted; select explicit slug.'});break;}
  }
  if(input.hook_event_name!=='SessionStart'||!index.length)return {};
  return {hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:JSON.stringify({slrRecovery:index,instruction:'Use bounded context-control summary/query. Verify runtime task status; never reset leases or infer approval from a compacted summary. No automatic /compact is implemented.'})}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {let raw='';for await(const chunk of process.stdin)raw+=chunk;console.log(JSON.stringify(contextHook(JSON.parse(raw))));}
  catch {console.log('{}');} // Never block runtime compaction on a recovery-hook error.
}
