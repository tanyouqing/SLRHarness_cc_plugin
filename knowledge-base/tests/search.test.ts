import test from 'node:test';
import assert from 'node:assert/strict';
import {pool} from '../src/db.js';
import {search,candidates} from '../src/store.js';
test('hybrid search pushes filters and revision/model visibility into BOTH database queries',async()=>{
  const originalQuery=pool.query,originalFetch=globalThis.fetch;
  const calls:{sql:string;args:any[]}[]=[];
  globalThis.fetch=(async()=>new Response(JSON.stringify({embedding:Array(1024).fill(.01),model_version:'fixture-model'}))) as typeof fetch;
  pool.query=(async(sql:string,args:any[])=>{calls.push({sql,args});return {rows:[]};}) as any;
  try {
    await search('paper','实验 evidence',{year_from:2020,year_to:2026,author:'A',doi:'https://doi.org/10.123/ABC'},5);
    assert.equal(calls.length,2);
    for(const {sql,args} of calls) {
      assert.match(sql,/c.revision=e.current_revision/);assert.match(sql,/c.model_version=\$4/);
      assert.match(sql,/jsonb_array_elements_text/);assert.match(sql,/metadata.*doi/);
      assert.equal(args.at(-1),'10.123/abc');assert.equal(args[3],'fixture-model');
      const referenced=new Set([...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1])));
      for(let i=1;i<=args.length;i++)assert.ok(referenced.has(i),`query must reference typed parameter ${i}`);
    }
    calls.length=0;
    await search('experience','compare',{role:'worker',stage:'reading',sourceType:'review'});
    for(const {sql,args} of calls){assert.match(sql,/content->>'role'/);assert.match(sql,/\(r.content->>'stage'=\$6 OR r.content->>'stage' IS NULL\)/);assert.match(sql,/content->>'sourceType'/);assert.deepEqual(args.slice(4),['worker','reading','review']);}
    calls.length=0;
    await candidates('experience',{sourceType:'review',role:'worker',stage:'arbitrary stage synonym',executionSummary:'observed',strategy:'compare metrics'});
    assert.equal(calls.length,2);
    for(const {sql,args} of calls) {
      assert.doesNotMatch(sql,/content->>'stage'/);
      assert.deepEqual(args.slice(4),['worker','review']);
      assert.doesNotMatch(args[2],/undefined|null/);
    }
  } finally {pool.query=originalQuery;globalThis.fetch=originalFetch;await pool.end();}
});

test('dedup includes same-source neighbors and global semantic candidates without stage filters',async t=>{
  const calls:string[]=[];
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({embedding:Array(1024).fill(.01),model_version:'fixture-model'})));
  t.mock.method(pool,'query',async(sql:string,args:any[])=>{
    calls.push(sql);
    if(sql.includes('ORDER BY distance')){assert.match(sql,/LIMIT 12/);assert.match(sql,/incoming.end_line/);assert.doesNotMatch(sql,/stage/);return {rows:[{id:'same-source'}]};}
    if(sql.includes('FROM search_chunks')){assert.doesNotMatch(sql,/stage/);return {rows:[{id:'chunk',entity_id:'global',revision:1,text:'advice',content:{role:'worker'}}]};}
    if(sql.startsWith('SELECT e.id,e.kind'))return {rows:[{id:args[0],content:{sourceType:'trajectory',role:'worker'}}]};
    return {rows:[]};
  });
  const records=await candidates('experience',{sourceType:'trajectory',role:'worker',stage:'custom',strategy:'advice',executionSummary:'observed'},[{type:'trajectory',id:'00000000-0000-4000-8000-000000000001',event_range:{start:1,end:4}}]);
  assert.deepEqual(records.map(r=>r.id),['same-source','global']);
  assert.ok(calls.some(sql=>sql.includes('ORDER BY distance')));
});
