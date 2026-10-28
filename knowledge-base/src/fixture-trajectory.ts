import {sha256} from './trajectory.js';
// Explicit synthetic identity for cloud acceptance only; never inferred from text.
export function fixtureTrajectory(raw:string,runId:string) {
  return {content:raw.trimEnd().split('\n').map((line,i)=>JSON.stringify({originalLine:i+1,event:JSON.parse(line)})).join('\n'),
    metadata:{runId,agentId:'fixture-worker',sessionId:runId,agentRole:'worker',originalHash:sha256(raw),projectionVersion:'fixture-1',lineMapping:'embedded-originalLine'}};
}
