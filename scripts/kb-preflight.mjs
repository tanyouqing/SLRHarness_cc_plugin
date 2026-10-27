import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {connect} from './kb-sync.mjs';
import {json} from './kb-core.mjs';
export function checkSetup(project) {
  const checks=[];
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22 or newer required');checks.push('Node.js >=22');
  const c=json(path.join(project,'.mcp.json')).mcpServers?.['survey-kb'];
  if(c?.type!=='http'||c.timeout!==20000||c.url!==(process.env.SURVEY_KB_URL??'http://127.0.0.1:3000/mcp'))throw new Error('survey-kb must use the expected HTTP URL and timeout:20000');
  if(c.headers?.Authorization!=='Bearer ${SURVEY_KB_TOKEN}')throw new Error('MCP config must reference SURVEY_KB_TOKEN, not a literal credential');checks.push('HTTP config and per-server timeout');
  if(!process.env.SURVEY_KB_TOKEN)throw new Error('export SURVEY_KB_TOKEN for Claude Code and the sync service');checks.push('token present (not displayed)');
  const plugin=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),hooks=json(path.join(plugin,'hooks/hooks.json')).hooks;
  for(const event of ['PreToolUse','PostToolUse','SubagentStop','Stop'])if(!hooks[event]?.some(x=>x.hooks.some(h=>h.command?.includes('kb-hook.mjs'))))throw new Error('missing KB hook '+event);
  checks.push('plugin hook configuration');
  const receipt=path.join(project,'.slr-kb-capabilities.json');
  if(!fs.existsSync(receipt))throw new Error('run kb-native-probe.mjs <project> on the server before enabling KB');
  const verified=json(receipt),version=spawnSync('claude',['--version'],{encoding:'utf8',timeout:15000});
  if(verified.status!=='passed'||!verified.outputReplacement||version.status!==0||version.stdout.trim()!==verified.claudeVersion)throw new Error('Claude runtime not verified; update Claude Code and rerun kb-native-probe.mjs');
  checks.push('native output replacement and per-server timeout verified for this Claude version');return checks;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let client;
  try {
    const project=process.argv[2];if(!path.isAbsolute(project??''))throw new Error('absolute project directory required');
    const checks=checkSetup(project);
    if(process.argv.includes('--connect')) {
      client=await connect();await client.call('search_papers',{query:'deployment connectivity check',limit:1});checks.push('authenticated read-only MCP query');
    }
    console.log(JSON.stringify({status:'passed',checks,nativeRuntime:'verified by isolated MCP probe; actual role and trajectory handoff still require a small end-to-end run'},null,2));
  }catch(e){console.error('Preflight failed: '+(e.code===401?'authentication rejected':e.message));process.exitCode=1;}finally{await client?.close();}
}
