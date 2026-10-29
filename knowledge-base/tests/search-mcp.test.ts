import test from 'node:test';
import assert from 'node:assert/strict';
import {openSearchTools,expand,resolveServer,searchableTool,bridgeName} from '../src/search-mcp.js';
import {validateToolArguments} from '@earendil-works/pi-ai';
const schema={type:'object',properties:{query:{type:'string'},limit:{type:'integer',minimum:1}},required:['query'],additionalProperties:false};
const remote=(name='tavily_search')=>({name,description:'Search papers',inputSchema:schema});
const dossier=()=>({documents:[],errors:[],searched:false});
const config={mcpServers:{tavily:{command:'npx',args:['-y','test-fixture'],env:{TAVILY_API_KEY:'fixture-private-token'}},'survey-kb':{type:'http',url:'http://localhost:3000/mcp'}}};
async function execute(tool:any,args:any){return tool.execute('test',validateToolArguments(tool,{type:'toolCall',id:'test',name:tool.name,arguments:args}));}

test('Claude MCP expansion preserves argument boundaries, transport and environment without shell evaluation',()=>{
  assert.equal(expand('${TOKEN}/${MISSING:-fallback}',{TOKEN:'value'}),'value/fallback');
  assert.throws(()=>expand('${MISSING}',{}),/environment variable/);
  assert.equal(expand('$(echo secret)',{}),'$(echo secret)');
  const s=resolveServer({command:'uvx',args:['package','${ARG}'],env:{KEY:'${KEY}'}},{ARG:'two words',KEY:'value'});
  assert.equal(s.type,'stdio');assert.deepEqual(s.args,['package','two words']);assert.equal(s.env?.KEY,'value');
  assert.equal(resolveServer({url:'https://example.org/mcp'}).type,'http');
  assert.throws(()=>resolveServer({type:'http',url:'file:///secret'}));
  assert.notEqual(bridgeName('a-b','search'),bridgeName('a_b','search'));
});

test('search bridge preserves actual required/optional schema, paginates, excludes self and mutating tools',async()=>{
  const d:any=dossier();let connections=0,closed=0,saves=0;const calls:any[]=[];
  const bridge=await openSearchTools(d,async()=>{saves++;},{configuration:config,connect:async()=>{connections++;return {
    listTools:async(args:any)=>args?.cursor?{tools:[remote('download_paper'),remote('delete_paper')]}:{tools:[remote()],nextCursor:'next'},
    callTool:async(args:any)=>{calls.push(args);return {content:[{type:'text',text:'metadata result'}]};},close:async()=>{closed++;}};}});
  assert.equal(connections,1);assert.equal(bridge.tools.length,2);assert.deepEqual(bridge.tools[0].parameters,schema);
  await assert.rejects(execute(bridge.tools[0],{limit:1}));assert.equal(calls.length,0);
  await execute(bridge.tools[0],{query:'paper'});assert.deepEqual(calls[0],{name:'tavily_search',arguments:{query:'paper'}});
  assert.equal(saves,1);assert.equal(d.documents[0].kind,'metadata');assert.equal(d.searched,true);
  await bridge.close();assert.equal(closed,1);
  for(const n of ['search','tavily_search','semantic_search','download_paper','fetch_url','read_paper'])assert.equal(searchableTool(n,{},{}),true);
  assert.equal(searchableTool('update_record',{},{}),false);assert.equal(searchableTool('search',{destructiveHint:true},{}),false);
});

test('MCP credentials are redacted from tool descriptions, schema and persisted responses; full evidence survives preview',async()=>{
  const d:any=dossier(),token='fixture-private-token';
  const bridge=await openSearchTools(d,async()=>{},{configuration:config,connect:async()=>({
    listTools:async()=>({tools:[{...remote(),description:`token ${token}`,inputSchema:{...schema,description:`token ${token}`}}]}),
    callTool:async()=>({content:[{type:'text',text:token+' x'.repeat(7000)}],structuredContent:{token}}),close:async()=>{}})});
  const output=await execute(bridge.tools[0],{query:'paper'});
  assert.ok(!JSON.stringify(bridge.tools).includes(token));assert.ok(!JSON.stringify(d).includes(token));assert.ok(!JSON.stringify(output).includes(token));
  const p=JSON.parse(output.content[0].text);assert.equal(p.text.length,12000);assert.equal(p.next_start,12000);assert.ok(d.documents[0].text.length>12000);
  await bridge.close();
});

test('unavailable MCP is an evidence gap and other services remain usable; thrown messages never leak',async()=>{
  const d:any=dossier();let closes=0;
  const bridge=await openSearchTools(d,async()=>{},{configuration:{mcpServers:{bad:{command:'bad'},good:{command:'good'}}},connect:async s=>{
    if(s.command==='bad')throw new Error('private-token must not appear');
    return {listTools:async()=>({tools:[remote()]}),callTool:async()=>{throw new Error('private-token');},close:async()=>{closes++;}};
  }});
  assert.equal(bridge.tools.length,1);const result=await execute(bridge.tools[0],{query:'paper'});
  assert.equal(JSON.parse(result.content[0].text).unavailable,true);assert.equal(d.errors.length,2);assert.equal(d.searched,false);
  assert.ok(!JSON.stringify(d).includes('private-token'));await bridge.close();assert.equal(closes,1);
});

test('MCP result errors and call budget do not fabricate sources; partial tool discovery is removed',async()=>{
  const d:any=dossier();let calls=0;
  const bridge=await openSearchTools(d,async()=>{},{configuration:config,connect:async()=>({
    listTools:async()=>({tools:[remote()]}),callTool:async()=>{calls++;return {isError:true,content:[{type:'text',text:'private error'}]};},close:async()=>{}})});
  for(let i=0;i<13;i++)await execute(bridge.tools[0],{query:'paper'});
  assert.equal(calls,12);assert.equal(d.documents.length,0);assert.equal(d.errors.length,12);await bridge.close();
  const broken=await openSearchTools(d,async()=>{},{configuration:config,connect:async()=>({
    listTools:async(args:any)=>{if(args)throw new Error('offline');return {tools:[remote()],nextCursor:'next'};},callTool:async()=>assert.fail('unavailable'),close:async()=>{}})});
  assert.equal(broken.tools.length,0);await broken.close();
});

test('invalid private MCP file fails clearly, and save failure closes acquired clients',async()=>{
  await assert.rejects(openSearchTools(dossier(),async()=>{},{configuration:{mcpServers:{bad:{unexpected:'secret'}}}}),/^Error: search MCP configuration invalid$/);
  let closed=0;
  await assert.rejects(openSearchTools(dossier(),async()=>{throw new Error('lease lost');},{configuration:config,connect:async()=>({
    listTools:async()=>{throw new Error('offline');},callTool:async()=>({}),close:async()=>{closed++;}})}),/lease lost/);
  assert.ok(closed>=1);
});
