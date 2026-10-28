import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceRole} from '../src/roles.js';
import {consolidate,checkConsolidation,type Draft} from '../src/agents.js';
import {validateExperienceRole,publish,submit} from '../src/store.js';
import {pool} from '../src/db.js';
const id='00000000-0000-4000-8000-000000000001';
const exp:any={sourceType:'trajectory',role:'worker',executionSummary:'observed',strategy:'verify'};
const draft:Draft={candidateId:'a',experience:exp,sources:[{type:'trajectory',id}]};
test('trusted origins agree across every association; text roles cannot fill missing metadata',()=>{
  for(const role of ['worker','manager','scoper','paper'])assert.equal(sourceRole([{agentRole:role},{agentRole:role}]),role);
  for(const origins of [[],[{role:'worker'}],[{agentRole:'reviewer'}],[{agentRole:'worker'},{agentRole:'manager'}]])assert.throws(()=>sourceRole(origins));
});
test('review bypasses trajectory identity; trajectory checks all sources and disallows cross-role',async()=>{
  const db:any={query:async(sql:string,args:any[])=>({rows:sql.includes('FROM trajectory_origins')?[{metadata:{agentRole:args[0]==='other'?'manager':'worker'}}]:[{id:args[0]}]})};
  await validateExperienceRole(db,{...exp,sourceType:'review'},[]);
  await validateExperienceRole(db,exp,[{type:'trajectory',id}]);
  await assert.rejects(validateExperienceRole(db,exp,[]),/requires sources/);
  await assert.rejects(validateExperienceRole(db,exp,[{type:'trajectory',id},{type:'trajectory',id:'other'}]),/role must equal/);
});
test('both submit and final publish enforce stored role before writes',async t=>{
  const writes:string[]=[];
  t.mock.method(pool,'connect',async()=>({release(){},async query(sql:string){
    if(sql.startsWith('INSERT')||sql.startsWith('UPDATE'))writes.push(sql);
    if(sql.includes('FROM trajectory_origins'))return {rows:[{metadata:{agentRole:'manager'}}]};
    if(sql.includes('FROM trajectories'))return {rows:[{id,line_count:1}]};
    if(sql.includes('FROM jobs'))return {rows:[{payload:{kind:'experience',sources:[{type:'trajectory',id}],fingerprint:'hash'}}]};
    return {rows:[]};
  }} as any));
  await assert.rejects(submit('experience',exp,[{type:'trajectory',id}]),/role must equal/);
  await assert.rejects(publish({id,lease_token:id} as any,{action:'new',reason:'x',evidence:['x']},exp),/role must equal/);
  assert.deepEqual(writes,[]);
});
test('consolidation rejects invented IDs, changed roles, invented sources and evidence-dropping comparisons',()=>{
  const other={...draft,candidateId:'b'};
  const merge={action:'merge',candidateId:'a',targetId:'b',reason:'same',experience:exp};
  assert.equal(checkConsolidation(merge,draft,other,'worker').action,'merge');
  for(const bad of [{...merge,targetId:'x'},{...merge,experience:{...exp,role:'manager'}},{...merge,sources:[]},{action:'drop',candidateId:'a',reason:'covered'}])
    assert.throws(()=>checkConsolidation(bad,draft,other,'worker'));
});
test('complete candidate is available through bounded windows, and decisions require every window',async()=>{
  const current={...draft,experience:{...exp,strategy:'中'.repeat(25000)}};
  let pages=0;
  const result=await consolidate(current,undefined,'worker',async(_role,_prompt,tools)=>{
    const read=tools.find(t=>t.name==='read_candidate')!,decide=tools.find(t=>t.name==='submit_consolidation')!;
    const decision={action:'keep',candidateId:'a',reason:'specific supported advice'};
    await assert.rejects(decide.execute('call',decision),/read complete/);
    let start:number|null=0,text='';
    while(start!==null){const r:any=await read.execute('call',{id:'a',start});const data=JSON.parse(r.content[0].text);assert.ok(data.text.length<=12000);text+=data.text;start=data.next_start;pages++;}
    assert.deepEqual(JSON.parse(text),current);
    await decide.execute('call',decision);
  });
  assert.equal(result.action,'keep');assert.equal(pages,3);
});
