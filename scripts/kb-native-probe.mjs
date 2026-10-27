// Cloud-only functional check. Uses a temporary loopback MCP server, never Survey KB.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {atomic,json} from './kb-core.mjs';

export function validateProbe(events,answer,marker) {
  const slow=events.find(e=>e.event==='PostToolUseFailure'&&e.tool.endsWith('__slow'));
  const start=events.find(e=>e.event==='PreToolUse'&&e.id===slow?.id);
  const elapsed=slow&&start?slow.at-start.at:null;
  if(!answer.includes(marker)||!events.some(e=>e.event==='PostToolUse'&&e.tool.endsWith('__echo')))throw new Error('MCP output replacement was not demonstrated');
  if(elapsed===null||elapsed<17000||elapsed>27000||!/timed?\s*out|timeout/i.test(slow.error??''))throw new Error('20-second per-server timeout was not demonstrated');
  return {outputReplacement:true,timeoutMs:elapsed};
}
export async function runProbe(project) {
  if(!path.isAbsolute(project)||!fs.statSync(project).isDirectory())throw new Error('absolute existing project required');
  const receipt=path.join(project,'.slr-kb-capabilities.json');
  const version=spawnSync('claude',['--version'],{encoding:'utf8',timeout:15000});
  if(version.status!==0)throw new Error('claude --version failed; install/update Claude Code first');
  atomic(receipt,{status:'pending',claudeVersion:version.stdout.trim()});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'survey-kb-probe-'));
  const marker='KB_REPLACED_'+randomUUID(),eventsFile=path.join(dir,'events.jsonl');
  const hookFile=path.join(dir,'hook.cjs');
  fs.writeFileSync(hookFile,`const fs=require('node:fs');let raw='';process.stdin.on('data',b=>raw+=b);process.stdin.on('end',()=>{const i=JSON.parse(raw);fs.appendFileSync(${JSON.stringify(eventsFile)},JSON.stringify({event:i.hook_event_name,tool:i.tool_name,id:i.tool_use_id,at:Date.now(),error:i.error})+'\\n');if(i.hook_event_name==='PostToolUse'&&i.tool_name.endsWith('__echo'))console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PostToolUse',updatedMCPToolOutput:{content:[{type:'text',text:${JSON.stringify(marker)}}],structuredContent:{marker:${JSON.stringify(marker)}}}}}));else console.log('{}');});`);
  const transports=new Set();
  const server=http.createServer(async(req,res)=>{
    if(req.url!=='/mcp'){res.writeHead(404).end();return;}
    const mcp=new McpServer({name:'survey-kb-probe',version:'1.0.0'});
    mcp.registerTool('echo',{description:'Return a probe marker',inputSchema:{}},async()=>({content:[{type:'text',text:'ORIGINAL_OUTPUT_MUST_BE_REPLACED'}]}));
    mcp.registerTool('slow',{description:'Intentional 35-second delay for timeout verification',inputSchema:{}},async()=>{await new Promise(r=>{const timer=setTimeout(r,35000);timer.unref();});return {content:[{type:'text',text:'TOO_LATE'}]};});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});transports.add(transport);
    res.on('close',()=>{transports.delete(transport);void transport.close();void mcp.close();});
    try{await mcp.connect(transport);await transport.handleRequest(req,res);}catch{if(!res.headersSent)res.writeHead(500).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    const configFile=path.join(dir,'mcp.json'),settingsFile=path.join(dir,'settings.json');
    atomic(configFile,{mcpServers:{'survey-kb-probe':{type:'http',url:`http://127.0.0.1:${server.address().port}/mcp`,timeout:20000}}});
    atomic(settingsFile,{hooks:Object.fromEntries(['PreToolUse','PostToolUse','PostToolUseFailure'].map(event=>[event,[{matcher:'mcp__survey-kb-probe__.*',hooks:[{type:'command',command:`"${process.execPath}" "${hookFile}"`,timeout:10}]}]]))});
    const answer=await new Promise((resolve,reject)=>{
      const child=spawn('claude',['-p','Call mcp__survey-kb-probe__echo exactly once. Then call mcp__survey-kb-probe__slow exactly once. Do not retry either call. After the second finishes or errors, output only the exact marker you received from echo.','--mcp-config',configFile,'--strict-mcp-config','--settings',settingsFile,'--allowedTools','mcp__survey-kb-probe__echo,mcp__survey-kb-probe__slow','--tools','','--no-session-persistence'],{cwd:dir,env:{...process.env,CLAUDECODE:undefined},stdio:['ignore','pipe','pipe']});
      let output='',error='';const timer=setTimeout(()=>{child.kill();reject(new Error('native probe exceeded 120 seconds; inspect model connectivity'));},120000);
      child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);
      child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error('Claude probe failed; check login, model access and version. '+error.slice(-500)));});
    });
    const events=fs.existsSync(eventsFile)?fs.readFileSync(eventsFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
    const result={status:'passed',claudeVersion:version.stdout.trim(),...validateProbe(events,answer,marker),at:new Date().toISOString()};atomic(receipt,result);return result;
  }finally{
    for(const transport of transports)await transport.close().catch(()=>{});
    server.closeAllConnections();await new Promise(r=>server.close(r));
    // Exact directory created above under the system temp root; no computed workspace deletion.
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{console.log(JSON.stringify(await runProbe(process.argv[2]),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
