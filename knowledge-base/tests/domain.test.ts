import test from 'node:test';
import assert from 'node:assert/strict';
import {hash,normalizeDoi,normalizeArxiv,validateTrajectory,keywords,fuse,validateDecision,experienceInput,readSchema,searchText,strategyFilters,experienceRoles} from '../src/domain.js';
import {trajectorySegments,checkSupplement} from '../src/processing.js';
import {checkDistilled,distilledToolSchema} from '../src/agents.js';
const id='00000000-0000-4000-8000-000000000001';
const experience={sourceType:'review' as const,role:'worker',stage:'reading',task:'compare',executionSummary:'observed',strategy:'verify metrics',applicability:'cross-paper'};

test('experience roles are the four applicable roles across submissions, search and agent decisions',()=>{
  for(const role of experienceRoles) {
    assert.equal(experienceInput.parse({experience:{...experience,role}}).experience.role,role);
    assert.equal(strategyFilters.parse({role}).role,role);
    assert.equal(checkDistilled({summary:'x',candidates:[{experience:{...experience,role,sourceType:'trajectory'},sources:[{type:'trajectory',id}]}]},id,2,role).candidates[0].experience.role,role);
  }
  for(const role of ['reviewer','checker','assistant','tool','paper-writer','Worker','',null]) {
    assert.throws(()=>experienceInput.parse({experience:{...experience,role}}));
    assert.throws(()=>strategyFilters.parse({role}));
    assert.throws(()=>checkDistilled({summary:'x',candidates:[{experience:{...experience,role,sourceType:'trajectory'},sources:[{type:'trajectory',id}]}]},id,2,'worker'));
    assert.throws(()=>validateDecision({action:'supplement',targetId:id,expectedRevision:1,reason:'x',evidence:['x'],proposedContent:{...experience,role}},'experience',[id]));
  }
});

test('distiller sees concrete nested field schemas before generating candidates',()=>{
  const props=distilledToolSchema.properties;
  const item=props.candidates.items;
  assert.equal(props.summary.maxLength,6000);
  assert.equal(props.candidates.maxItems,20);
  assert.deepEqual(item.properties.experience.properties.role.enum,[...experienceRoles]);
  assert.deepEqual([...item.properties.experience.required].sort(),['executionSummary','role','sourceType','strategy']);
  assert.equal(item.properties.experience.properties.sourceType.const,'trajectory');
  assert.equal(item.properties.sources.minItems,1);
  assert.deepEqual([...item.properties.sources.items.required].sort(),['id','type']);
  assert.equal(item.properties.sources.items.properties.event_range.properties.start.type,'integer');
  assert.equal(item.properties.sources.items.properties.event_range.properties.start.exclusiveMinimum,0);
});

test('optional experience context may be omitted independently without inventing values',()=>{
  const base={sourceType:'review' as const,role:'worker',executionSummary:'observed',strategy:'verify metrics'};
  const optional=['stage','task','applicability'] as const;
  for(let mask=0;mask<8;mask++) {
    const input={...base,...Object.fromEntries(optional.filter((_,i)=>mask & (1<<i)).map(k=>[k,experience[k]]))};
    const parsed=experienceInput.parse({experience:input});
    assert.deepEqual(parsed.experience,input);
    assert.doesNotMatch(searchText('experience',parsed.experience),/undefined|null/);
  }
  for(const key of optional)for(const bad of [null,'','   ',42])assert.throws(()=>experienceInput.parse({experience:{...base,[key]:bad}}));
  for(const key of Object.keys(base)) {
    const input:any={...base};delete input[key];
    assert.throws(()=>experienceInput.parse({experience:input}));
  }
});

test('minimal distilled and supplemented experiences remain valid without optional context',()=>{
  const minimal={sourceType:'trajectory' as const,role:'worker',executionSummary:'observed',strategy:'verify metrics'};
  const candidate={experience:minimal,sources:[{type:'trajectory',id}]};
  assert.deepEqual(checkDistilled({summary:'observed',candidates:[candidate]},id,2,'worker').candidates[0].experience,minimal);
  assert.throws(()=>experienceInput.parse({experience:minimal}));
  assert.doesNotThrow(()=>checkSupplement('experience',minimal,{...minimal,strategy:'verify dataset and metrics'}));
  assert.throws(()=>checkSupplement('experience',{...minimal,stage:'reading'},minimal));
  assert.doesNotThrow(()=>validateDecision({action:'supplement',targetId:id,expectedRevision:1,reason:'more evidence',evidence:['observed'],proposedContent:minimal},'experience',[id]));
});
test('fingerprints ignore object ordering and line endings, preserve meaningful differences',()=>{
  assert.equal(hash({b:'x\r\ny',a:1}),hash({a:1,b:'x\ny'}));
  assert.notEqual(hash({...experience,role:'manager'}),hash(experience));
  assert.notEqual(hash({tool_output:'  indented code'}),hash({tool_output:'indented code'}));
});
test('normalize DOI/arXiv identity without inventing missing IDs',()=>{
  assert.equal(normalizeDoi('https://doi.org/10.123/ABC'),'10.123/abc');
  assert.equal(normalizeArxiv('https://arxiv.org/pdf/hep-th/9901001v2.pdf'),'hep-th/9901001');
  assert.equal(normalizeArxiv('2301.12345v3'),'2301.12345');
  assert.equal(normalizeDoi(null),null);
});
test('trajectory validates every line; rejects primitives, blank internal lines and malformed tail',()=>{
  assert.equal(validateTrajectory('{"type":"start"}\n{"type":"end"}\n').length,2);
  for(const value of ['[]','1','{}\n\n{}','{}\n{broken'])assert.throws(()=>validateTrajectory(value));
});
test('Chinese and English keyword segmentation is repeatable and nonempty',()=>{
  const text=keywords('验证 数据集版本 Benchmark F1');
  assert.ok(text.includes('benchmark'));assert.ok(text.includes('数据'));assert.equal(text,keywords('验证 数据集版本 Benchmark F1'));
});
test('RRF merges modalities and returns one best chunk per entity',()=>{
  const a={id:'a',entity_id:'p1'},b={id:'b',entity_id:'p2'},c={id:'c',entity_id:'p1'};
  const result=fuse([a,b],[b,c],10);
  assert.equal(result[0].id,'b');assert.equal(result.length,2);assert.equal(new Set(result.map(x=>x.entity_id)).size,2);
});
test('decisions may not invent target IDs or omit supplement content',()=>{
  assert.throws(()=>validateDecision({action:'duplicate',targetId:id,expectedRevision:1,reason:'same',evidence:['x']},'experience',[]));
  assert.throws(()=>validateDecision({action:'supplement',targetId:id,expectedRevision:1,reason:'more',evidence:['x']},'experience',[id]));
  assert.equal(validateDecision({action:'keep_separate',targetId:id,expectedRevision:1,reason:'conditions differ',evidence:['dataset v1 vs v2']},'experience',[id]).action,'keep_separate');
});
test('review needs no source, trajectory-derived experience needs stored source IDs',()=>{
  assert.deepEqual(experienceInput.parse({experience}).sources,[]);
  assert.throws(()=>experienceInput.parse({experience:{...experience,sourceType:'trajectory'}}));
  assert.equal(experienceInput.parse({experience:{...experience,sourceType:'trajectory'},sources:[{type:'trajectory',id}]}).sources.length,1);
});
test('read cannot mix trajectory revision with paper event range',()=>{
  assert.throws(()=>readSchema.parse({type:'trajectory',id,revision:1}));
  assert.throws(()=>readSchema.parse({type:'paper',id,event_range:{start:1,end:2}}));
});
test('distiller output validates source identity, bounds and source type',()=>{
  assert.deepEqual(checkDistilled({summary:'nothing useful',candidates:[]},id,5,'worker').candidates,[]);
  const c={experience:{...experience,sourceType:'trajectory'},sources:[{type:'trajectory',id,event_range:{start:1,end:8}}]};
  assert.throws(()=>checkDistilled({summary:'x',candidates:[c]},id,5,'worker'));
  c.sources[0].event_range.end=5;
  assert.equal(checkDistilled({summary:'x',candidates:[c]},id,5,'worker').candidates.length,1);
});
test('large trajectory segmenting retains the entire event body and original line numbers',()=>{
  const content=JSON.stringify({data:'abcdef'.repeat(100)})+'\n{"end":true}';
  const parts=trajectorySegments(content,100);
  assert.ok(parts.length>2);assert.equal(parts[0].start,1);assert.equal(parts.at(-1)?.end,2);
  assert.ok(parts.at(-1)?.text.includes('"end":true'));
  const reconstructed=parts.filter(x=>x.start===1).map(x=>x.text.replace(/^\[.*?\]\n/,'')).join('');
  assert.equal(reconstructed,content.split('\n')[0]);
});
test('supplement preserves experience category and known paper identifiers',()=>{
  assert.throws(()=>checkSupplement('experience',experience,{...experience,role:'manager'}));
  const p={metadata:{title:'t',authors:[],year:null,canonicalUrl:null,doi:'10.1/a',arxivId:null,venue:null},note:'text'};
  assert.throws(()=>checkSupplement('paper',p,{...p,metadata:{...p.metadata,doi:'10.1/b'}}));
});
