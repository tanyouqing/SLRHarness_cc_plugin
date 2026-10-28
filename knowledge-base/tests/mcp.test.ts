import test from 'node:test';
import assert from 'node:assert/strict';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {createMcp,type Service} from '../src/mcp.js';
const id='00000000-0000-4000-8000-000000000001';
test('seven MCP tools expose schemas and route paper/strategy search independently',async()=>{
  const calls:any[]=[];
  const service:Service={
    submit:async(...args:any[])=>{calls.push(args);return {status:'pending',id:null,job_id:id};},
    submitTrajectory:async (content,metadata,transfer)=>{calls.push({content,metadata,transfer});return {status:'stored',id,job_id:id};},
    search:async(...args:any[])=>{calls.push(args);return [];},
    read:async()=>({id}),getJob:async()=>({status:'queued',id}),
  };
  const server=createMcp(service),client=new Client({name:'offline-test',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(a);await client.connect(b);
  try {
    const tools=(await client.listTools()).tools;
    assert.deepEqual(tools.map(t=>t.name).sort(),['get_job','read','search_papers','search_strategies','submit_experience','submit_paper','submit_trajectory']);
    await client.callTool({name:'search_papers',arguments:{query:'evidence'}});
    await client.callTool({name:'search_strategies',arguments:{query:'evidence',filters:{role:'worker'}}});
    assert.equal(calls[0][0],'paper');assert.equal(calls[1][0],'experience');
    assert.equal(calls[0][3],10);
    const result=await client.callTool({name:'submit_trajectory',arguments:{content:'{"type":"end"}'}});
    assert.equal((result.structuredContent as any).job_id,id);
    const metadata={runId:'run',agentId:'reviewer-id',agentRole:'reviewer',sessionId:'session',originalHash:'a'.repeat(64),projectionVersion:'1',lineMapping:'embedded-originalLine'};
    const transfer={id:'b'.repeat(64),index:0,count:2,contentHash:'c'.repeat(64)};
    const partial=await client.callTool({name:'submit_trajectory',arguments:{content:'{',metadata,transfer}});
    assert.ok(!partial.isError);assert.deepEqual(calls.at(-1),{content:'{',metadata,transfer});

    const invalid=await client.callTool({name:'search_papers',arguments:{query:'x',filters:{role:'worker'}}});
    assert.equal(invalid.isError,true);
    const schema:any=tools.find(t=>t.name==='submit_experience')!.inputSchema;
    assert.deepEqual([...schema.properties.experience.required].sort(),['executionSummary','role','sourceType','strategy']);
    assert.deepEqual(schema.properties.experience.properties.role.enum,['worker','manager','scoper','paper']);
    const experience={sourceType:'review',role:'worker',executionSummary:'observed comparison mismatch',strategy:'check dataset and metrics'};
    const submitted=await client.callTool({name:'submit_experience',arguments:{experience}});
    assert.ok(!submitted.isError);assert.deepEqual(calls.at(-1),['experience',experience,[]]);
    const rejected=await client.callTool({name:'submit_experience',arguments:{experience:{...experience,stage:null}}});
    assert.equal(rejected.isError,true);
    for(const role of ['reviewer','checker','assistant']) {
      assert.equal((await client.callTool({name:'submit_experience',arguments:{experience:{...experience,role}}})).isError,true);
      assert.equal((await client.callTool({name:'search_strategies',arguments:{query:'metrics',filters:{role}}})).isError,true);
    }
  } finally {await client.close();await server.close();}
});
