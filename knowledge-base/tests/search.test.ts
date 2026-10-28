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
    await candidates('experience',{sourceType:'review',role:'worker',executionSummary:'observed',strategy:'compare metrics'});
    assert.equal(calls.length,2);
    for(const {sql,args} of calls) {
      assert.doesNotMatch(sql,/content->>'stage'/);
      assert.deepEqual(args.slice(4),['worker','review']);
      assert.doesNotMatch(args[2],/undefined|null/);
    }
  } finally {pool.query=originalQuery;globalThis.fetch=originalFetch;await pool.end();}
});
