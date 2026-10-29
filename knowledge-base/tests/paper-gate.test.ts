import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateToolArguments} from '@earendil-works/pi-ai';
import {validateIdentity,validateContent,verifyLevel} from '../src/paper-verification.js';
import {publicIPv4,sourceUrl,discoveryUrls,discover,SourceUnavailable,resolvePublic} from '../src/paper-sources.js';
import {admitPaper,paperGateDependencies,recheckPaper} from '../src/paper-gate.js';
import {processIngest} from '../src/processing.js';
import {pool} from '../src/db.js';
import {publish,submit,getJob} from '../src/store.js';
import {hash,type Paper} from '../src/domain.js';

const id='00000000-0000-4000-8000-000000000001';
const paper:Paper={metadata:{title:'Method A',authors:['A'],year:2025,doi:'10.1234/a',arxivId:null,venue:null,canonicalUrl:'https://example.org/paper'},note:'The method achieves 90% accuracy on dataset X.'};
const original='Version of record 2025. Method A by A. doi:10.1234/a.\nThe method achieves 90% accuracy on dataset X.';
const source={id:'original',url:'https://example.org/paper',kind:'html' as const,text:original,hash:'raw-hash',fetchedAt:'2026-01-01',links:[],metadata:{}};
const dossier=()=>({documents:[{...source},{...source,id:'metadata',kind:'metadata' as const,independent:true}],errors:[],searched:true});
const evidence={sourceId:'original',start:0,quote:original};
const field={outcome:'match',reason:'matches bibliographic record',evidence:[{...evidence,sourceId:'metadata'}]};
const identity=()=>({passed:true,reason:'identity and original version match',fields:{title:field,authors:field,year:field,doi:field,arxivId:{outcome:'not_supplied',reason:'not supplied',evidence:[]},venue:{outcome:'not_supplied',reason:'not supplied',evidence:[]}},version:{label:'Version of record 2025',confirmed:true,reason:'published version',evidence:[evidence]},originalSources:['original']});
const content=()=>({passed:true,reason:'claim supported',coverageReason:'one core quantitative claim',claims:[{noteStart:0,noteQuote:paper.note,kind:'quantitative',verdict:'supported',reasoning:'same accuracy and dataset',conditions:'dataset X',evidence:[evidence],quantities:[{noteValue:'90%',sourceValue:'90%',metric:'accuracy',unit:'percent',setting:'dataset X',comparison:'absolute performance, no relative improvement'}]}]});
const spans=()=>new Map([['original',[{start:0,end:original.length}]],['metadata',[{start:0,end:original.length}]]]);
const job=()=>({id,kind:'ingest' as const,payload:{kind:'paper',content:paper,sources:[],fingerprint:hash(paper)},checkpoint:null,lease_token:'lease',attempts:1});

test('L1 holds only evidenced contradictions; missing original or version passes with gaps',()=>{
  assert.equal(validateIdentity(identity(),paper,dossier(),spans()).verified,true);
  const unknown=validateIdentity({...identity(),passed:false,version:{...identity().version,confirmed:false}},paper,dossier(),spans());
  assert.equal(unknown.passed,true);assert.equal(unknown.verified,false);
  const mismatch={...identity(),fields:{...identity().fields,doi:{...field,outcome:'mismatch'}}};
  assert.equal(validateIdentity(mismatch,paper,dossier(),spans()).passed,false);
  mismatch.fields.doi={...mismatch.fields.doi,evidence:[]};assert.equal(validateIdentity(mismatch,paper,dossier(),spans()).passed,true);
  assert.equal(validateIdentity({...identity(),fields:{...identity().fields,venue:{...field,outcome:'mismatch'}}},paper,dossier(),spans()).passed,true);
  assert.throws(()=>validateIdentity({...identity(),originalSources:['fake']},paper,dossier(),spans()),/fetched original/);
  const noSearch=validateIdentity(identity(),paper,{...dossier(),searched:false},spans());assert.equal(noSearch.passed,true);assert.equal(noSearch.verified,false);
  assert.throws(()=>validateIdentity(identity(),paper,dossier(),new Map()),/read cited/);
  assert.throws(()=>validateIdentity({...identity(),version:{...identity().version,evidence:[{...evidence,quote:'invented'}]}},paper,dossier(),spans()),/does not match/);
});
test('L2 rejects fabricated provenance but admits unverified claims; actual contradictions hold',()=>{
  const l1=validateIdentity(identity(),paper,dossier(),spans());assert.equal(validateContent(content(),paper,l1,dossier(),spans()).passed,true);
  const c=content();c.claims[0].quantities[0].sourceValue='99%';assert.equal(validateContent(c,paper,l1,dossier(),spans()).verified,false);
  assert.throws(()=>validateContent({...content(),claims:[{...content().claims[0],noteStart:1}]},paper,l1,dossier(),spans()),/submitted note/);
  for(const patch of [{verdict:'unverified'},{quantities:[]},{evidence:[]}]) {
    const r=validateContent({...content(),passed:false,claims:[{...content().claims[0],...patch}]},paper,l1,dossier(),spans());assert.equal(r.passed,true);assert.equal(r.verified,false);
  }
  assert.equal(validateContent({...content(),claims:[]},paper,l1,dossier(),spans()).verified,false);
  assert.equal(validateContent(content(),paper,{...l1,originalSources:['different-version']},dossier(),spans()).verified,false);
  const conflict=validateContent({...content(),claims:[{...content().claims[0],verdict:'contradicted',reasoning:'inspected original disagrees'}]},paper,l1,dossier(),spans());assert.equal(conflict.passed,false);
  const yearGap=validateIdentity({...identity(),fields:{...identity().fields,year:{outcome:'unknown',reason:'publication year unclear',evidence:[]}}},paper,dossier(),spans());
  assert.equal(yearGap.verified,false);assert.equal(yearGap.originalBound,true);
  assert.equal(validateContent({...content(),claims:[{...content().claims[0],verdict:'contradicted'}]},paper,yearGap,dossier(),spans()).passed,false);
});
test('arXiv approval pins a concrete source version and rejects version drift',()=>{
  const p={...paper,metadata:{...paper.metadata,arxivId:'2501.00001v2'}};
  const raw=original+' arXiv:2501.00001v2';
  const d=dossier();for(const s of d.documents)s.text=raw;d.documents[0].url='https://arxiv.org/html/2501.00001v2';
  const r:any=identity();r.fields.arxivId={...field,evidence:[{sourceId:'metadata',start:0,quote:raw}]};r.version.resolvedArxivId='2501.00001v2';
  const read=new Map(d.documents.map(s=>[s.id,[{start:0,end:raw.length}]]));
  assert.equal(validateIdentity(r,p,d,read).passed,true);
  r.version.resolvedArxivId='2501.00001v3';assert.equal(validateIdentity(r,p,d,read).passed,false);
  r.version.confirmed=false;assert.equal(validateIdentity(r,p,d,read).passed,true);
  delete r.version.resolvedArxivId;assert.equal(validateIdentity(r,p,d,read).verified,false);
});
async function execute(t:any,args:any){return t.execute('test',validateToolArguments({...t,parameters:JSON.parse(JSON.stringify(t.parameters))},{type:'toolCall',id:'test',name:t.name,arguments:args}));}
test('actual verification tools enforce full note reading, window reading and schema fields',async()=>{
  for(const level of ['L1','L2'] as const) {
    const l1=validateIdentity(identity(),paper,dossier(),spans());
    const result=await verifyLevel(level,paper,dossier(),async()=>{},l1,async(role,p:any,tools)=>{
      assert.equal(role,'manager');assert.equal(p.level,level);
      const tool=(name:string)=>tools.find(t=>t.name===name)!;
      assert.equal(tools.some(t=>t.name==='fetch_paper_source'),level==='L1');
      const decision=tool('submit_paper_verification'),value=level==='L1'?identity():content();
      await assert.rejects(execute(decision,value),/entire note/);
      await execute(tool('read_paper_submission'),{page:0});
      await assert.rejects(execute(decision,value),/read cited/);
      await execute(tool('read_paper_source'),{sourceId:'original',start:0,length:12000});
      if(level==='L1')await execute(tool('read_paper_source'),{sourceId:'metadata',start:0,length:12000});
      await assert.rejects(execute(decision,{passed:true}),/./);
      await execute(decision,value);
    },undefined,async()=>({tools:[],close:async()=>{}}));assert.equal(result.passed,true);
  }
});
test('no original and failed search admit with gaps through actual tools; MCP is available and always closed',async()=>{
  const d:any={documents:[],errors:[{url:'https://example.org',reason:'timeout'}],searched:false};let closes=0;
  const open=async()=>({tools:[{name:'search_fixture',label:'fixture',description:'offline search',parameters:{type:'object',properties:{}},execute:async()=>({content:[],details:{}})}],close:async()=>{closes++;}});
  const gapIdentity={...identity(),passed:false,reason:'original inaccessible',originalSources:[],fields:Object.fromEntries(Object.keys(identity().fields).map(k=>[k,{outcome:'unknown',reason:'no independent evidence',evidence:[]}])),version:{label:'unknown',confirmed:false,reason:'unavailable',evidence:[]}};
  const l1=await verifyLevel('L1',paper,d,async()=>{},undefined,async(_role,_prompt,tools)=>{
    assert.ok(tools.some(t=>t.name==='search_fixture'));
    await execute(tools.find(t=>t.name==='read_paper_submission'),{page:0});
    await execute(tools.find(t=>t.name==='submit_paper_verification'),gapIdentity);
  },undefined,open as any);
  assert.equal(l1.passed,true);assert.equal(l1.verified,false);
  const l2=await verifyLevel('L2',paper,d,async()=>{},l1 as any,async(_role,_prompt,tools)=>{
    await execute(tools.find(t=>t.name==='read_paper_submission'),{page:0});
    await execute(tools.find(t=>t.name==='submit_paper_verification'),{...content(),passed:false,claims:[{...content().claims[0],verdict:'unverified',evidence:[],quantities:[]}]});
  },undefined,open as any);
  assert.equal(l2.passed,true);assert.equal(l2.verified,false);assert.equal(closes,2);
  await assert.rejects(verifyLevel('L1',paper,d,async()=>{},undefined,async()=>{throw new Error('provider offline');},undefined,open as any),/provider offline/);
  assert.equal(closes,3);
});
function harness(){let row:any={id:'check',status:'checking',dossier:dossier(),report:{}};let calls:string[]=[];
  const deps:any={load:async()=>structuredClone(row),save:async(_j:any,r:any)=>{row=structuredClone(r);},discover:async()=>{},verify:async(l:string)=>{calls.push(l);return l==='L1'?{...identity(),verified:true}:{...content(),verified:true};}};
  return {deps,calls,get row(){return row;},set row(r){row=r;}};
}
test('held identity/content never publishes; saved L1 survives failure and source evidence stays pinned',async()=>{
  const h=harness();const verify=h.deps.verify;
  h.deps.verify=async(l:string)=>{if(l==='L2')throw new Error('model offline');return verify(l);};
  await assert.rejects(admitPaper(job(),paper,h.deps),/model offline/);assert.equal(h.row.report.L1.passed,true);
  h.deps.verify=verify;assert.equal((await admitPaper(job(),paper,h.deps)).status,'passed');assert.deepEqual(h.calls,['L1','L2']);
  await admitPaper(job(),paper,h.deps);assert.deepEqual(h.calls,['L1','L2']);
  const bad=harness();bad.deps.verify=async()=>({...identity(),passed:false,reason:'DOI conflict'});
  assert.equal((await admitPaper(job(),paper,bad.deps)).status,'held');assert.equal(bad.row.report.level,'L1');
  const unavailable=harness();unavailable.row={...unavailable.row,dossier:{documents:[],errors:[],searched:false}};
  unavailable.deps.verify=async(l:string)=>({...l==='L1'?identity():content(),passed:true,verified:false,reason:'sources unavailable'});
  assert.equal((await admitPaper(job(),paper,unavailable.deps)).status,'passed');assert.equal(unavailable.row.report.verification,'admitted_with_gaps');
});
test('a supplement checks its final merged payload; held revision leaves old publication unchanged',async()=>{
  const merged={...paper,note:paper.note+' Added limitation.'};let published=false,held=false,checked:any;
  const deps:any={store:{candidates:async()=>[{id,revision:1,content:paper}],checkpoint:async()=>{},publish:async()=>{published=true;}},
    manage:async()=>({action:'supplement',targetId:id,expectedRevision:1,reason:'addition',evidence:['note'],proposedContent:merged}),
    admitPaper:async(_j:any,p:any)=>{checked=p;return {status:'held'};},holdPaper:async()=>{held=true;},prepare:async()=>assert.fail('held must not encode')};
  await processIngest({...job(),payload:{...job().payload,content:{...paper,note:'Changed note'}}},deps);
  assert.deepEqual(checked,merged);assert.equal(held,true);assert.equal(published,false);
});
test('new paper with no dedup candidates still runs both-level gate before indexing',async()=>{
  const order:string[]=[];const deps:any={store:{candidates:async()=>[],checkpoint:async()=>{},publish:async()=>{order.push('publish');}},admitPaper:async()=>{order.push('verify');return {status:'passed'};},prepare:async()=>{order.push('index');return {};}};
  await processIngest(job(),deps);assert.deepEqual(order,['verify','index','publish']);
});
test('resumed paper ingestion reuses its decision only while candidate versions remain unchanged',async()=>{
  let version=1,decisions=0,checkpoint:any;const j=job();j.payload.content={...paper,note:'Changed note'};
  const deps:any={store:{candidates:async()=>[{id,revision:version,content:paper}],checkpoint:async(_j:any,p:any)=>{checkpoint=p;},publish:async()=>{}},manage:async()=>{decisions++;return {action:'supplement',targetId:id,expectedRevision:version,reason:'additional supported detail',evidence:['note'],proposedContent:{...paper,note:'merged'}};},admitPaper:async()=>{throw new Error('model offline');}};
  await assert.rejects(processIngest(j,deps),/model offline/);
  await assert.rejects(processIngest({...j,checkpoint},deps),/model offline/);assert.equal(decisions,1);
  version=2;await assert.rejects(processIngest({...j,checkpoint},deps),/model offline/);assert.equal(decisions,2);
});
test('public-source requests reject local credentials/protocols and retain exact arXiv versions',()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.18.0.1','192.168.1.1','100.64.1.1','::1','224.0.0.1'])assert.equal(publicIPv4(ip),false);
  assert.equal(publicIPv4('8.8.8.8'),true);
  for(const url of ['file:///etc/passwd','http://example.org','https://user:secret@example.org','https://example.org:3000'])assert.throws(()=>sourceUrl(url));
  assert.ok(discoveryUrls({...paper,metadata:{...paper.metadata,arxivId:'2501.00001v2'}}).some(u=>u.endsWith('2501.00001v2')));
});
test('all DNS results are checked before pinning a connection, including mixed public/private answers',async()=>{
  await assert.rejects(resolvePublic('paper.example',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}] as any),/not public/);
  assert.equal((await resolvePublic('paper.example',async()=>[{address:'8.8.8.8',family:4}] as any))[0].address,'8.8.8.8');
  await assert.rejects(resolvePublic('paper.example',async()=>{throw new Error('DNS error');}),/DNS unavailable/);
});
test('discovery caches successful fetches, records unavailable sources, and does not claim success without evidence',async()=>{
  const d={documents:[],errors:[],searched:false} as any;let count=0,saves=0;
  await discover(paper,d,async()=>{saves++;},async()=>{count++;throw new SourceUnavailable('blocked');});assert.equal(d.searched,false);assert.equal(saves,2);
  await discover(paper,d,async()=>{},async url=>({...source,url,kind:'metadata'}));assert.equal(d.searched,true);
  await discover(paper,d,async()=>{},async()=>{assert.fail('cached');});assert.equal(count,2);
});
function fakeDb(t:any,query:any){const connect=pool.connect;(pool as any).connect=async()=>({query,release(){}});t.after(()=>{pool.connect=connect;});}
test('publication transaction refuses missing approval before inserting revision and rolls back',async t=>{
  const calls:string[]=[];fakeDb(t,async(sql:string)=>{calls.push(sql);if(sql.startsWith('SELECT * FROM jobs'))return {rows:[job()]};return {rows:[],rowCount:0};});
  await assert.rejects(publish(job(),{action:'new',reason:'new',evidence:['new']},paper),/L1\/L2/);
  assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.some(s=>s.startsWith('INSERT INTO revisions')));
});
test('completed held submission is idempotent and recheck preserves its old audit and job ID',async t=>{
  const calls:string[]=[];fakeDb(t,async(sql:string)=>{calls.push(sql);
    if(sql.startsWith('SELECT * FROM ingestions'))return {rows:[{job_id:id}]};
    if(sql.startsWith('SELECT payload,status,result'))return {rows:[{...job(),status:'succeeded',result:{ids:[],admission:'held',reason:'original unavailable'}}]};
    if(sql.startsWith('SELECT * FROM jobs'))return {rows:[{...job(),status:'succeeded',result:{admission:'held',check_id:'check'}}]};
    if(sql.startsWith('SELECT content_hash'))return {rows:[{content_hash:hash(paper),metadata_hash:hash(paper.metadata),content:paper}]};
    return {rows:[],rowCount:1};
  });
  const receipt=await submit('paper',paper);assert.equal(receipt.job_id,id);assert.equal(receipt.admission,'held');assert.equal(receipt.id,null);
  assert.deepEqual(await recheckPaper(id),{rechecking:id});assert.ok(!calls.some(s=>s.startsWith('DELETE')||s.startsWith('UPDATE paper_checks')));
});
test('unchanged metadata reuses pinned L1 with new L2; existing checking attempt resumes instead',async t=>{
  let existing=false;const queries:any[]=[];
  fakeDb(t,async(sql:string,args:any[])=>{queries.push({sql,args});
    if(sql.startsWith('SELECT * FROM jobs'))return {rows:[job()]};
    if(sql.startsWith('SELECT * FROM paper_checks'))return {rows:existing?[{id:'existing'}]:[]};
    if(sql.startsWith('SELECT id,dossier,report'))return {rows:[{id:'previous',dossier:dossier(),report:{L1:identity(),L2:content()}}]};
    if(sql.startsWith('INSERT INTO paper_checks'))return {rows:[{report:JSON.parse(args[4])}]};return {rows:[],rowCount:1};});
  const row=await paperGateDependencies.load(job(),hash(paper),hash(paper.metadata),paper);assert.equal(row.report.identityReusedFrom,'previous');assert.equal(row.report.L2,undefined);
  existing=true;assert.equal((await paperGateDependencies.load(job(),hash(paper),hash(paper.metadata),paper)).id,'existing');
});
test('migration guards new revisions but leaves legacy rows intact; report approval cannot be null',()=>{
  const sql=readFileSync(new URL('../migrations/006_paper_admission.sql',import.meta.url),'utf8');
  assert.match(sql,/BEFORE INSERT ON revisions/);assert.match(sql,/COALESCE\(report/);assert.match(sql,/completed paper checks are immutable/);assert.doesNotMatch(sql,/UPDATE (entities|revisions)/);
});
