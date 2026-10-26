import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {catalog,library,configurePaper,paperConfig,selectTemplate,checkTemplateFiles,officialURL} from '../scripts/paper-config.mjs';
import {preparePaper,validatePaper,buildPaper,paperStatus} from '../scripts/paper-build.mjs';
import {formatControl,formatStatus} from '../scripts/format-check.mjs';
import {stageControl,writerReady,writerEvidence,stages} from '../scripts/work-stages.mjs';
import {paperControl,loadState,hash} from '../scripts/pipeline.mjs';
import {contextControl} from '../scripts/context-control.mjs';
import {finalReviewControl} from '../scripts/final-review.mjs';
import {evaluateHook} from '../scripts/guard-agent-actions.mjs';
import {complete,write} from '../evals/fixture-lib.mjs';
const stopped={stopped:true,runtimeEvidence:'Deterministic fixture; no actual Agent invocation'};
test('legacy staged evidence fingerprints remain byte-compatible without a new config',t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'slr-old-hash-')),root=path.join(base,'legacy');
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));complete(root);
  const s=loadState(root),files=['SCOPE_ORIGINAL.md','SCOPE.md',...s.topics.flatMap(t=>[`topics/${t.id}/chapter.md`,`topics/${t.id}/synthesis.md`])];
  const oldDigest=hash(files.map(n=>`${n}\0${hash(fs.readFileSync(path.join(root,n)))}`).join('\n'));
  const oldFingerprint=hash(oldDigest+JSON.stringify(Object.values(s.papers).map(p=>[p.id,p.fingerprint])));
  assert.equal(writerEvidence(root),oldFingerprint);assert.equal(paperConfig(root),null);
  assert.equal(formatStatus(root).status,'legacy');assert.equal(formatStatus(root).canReview,true);
});
test('new CLI workspaces persist default selection and research language without interactive intake',t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'slr-intake-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const cli=fileURLToPath(new URL('../scripts/pipeline.mjs',import.meta.url));
  for(const [id,input] of Object.entries({default:{},chinese:{language:'Chinese',paperConfig:{venue:'ACL'}},unknown:{paperConfig:{venue:'ICLR',year:2026}}})) {
    const root=path.join(base,id),config=path.join(base,`${id}.json`);
    fs.writeFileSync(config,JSON.stringify({reviewId:id,topic:'Fixture only',...input}));
    execFileSync(process.execPath,[cli,'init',root,config],{windowsHide:true,stdio:'pipe'});
    const p=paperConfig(root);
    if(id==='default'){assert.equal(p.venue,'NeurIPS');assert.equal(p.language,'english');}
    if(id==='chinese'){assert.equal(p.venue,'ACL');assert.equal(p.language,'chinese');}
    if(id==='unknown')assert.equal(p.status,'unresolved');
    const before=fs.readFileSync(path.join(root,'.slr/paper-config.json'));
    execFileSync(process.execPath,[cli,'status',root],{windowsHide:true,stdio:'pipe'});
    assert.deepEqual(fs.readFileSync(path.join(root,'.slr/paper-config.json')),before);
  }
});
function setup(t,venue='NeurIPS') {
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'slr-format-')),root=path.join(project,'workspaces','format-fixture');
  t.after(()=>fs.rmSync(project,{recursive:true,force:true}));complete(root);configurePaper(root,{venue});contextControl(root,'enable');
  const paper=path.join(root,'paper');preparePaper(paper);
  const tex=fs.readFileSync(path.join(paper,'main.tex'),'utf8').replaceAll('Survey Title','Retrieval Methods').replace('Topic Name','Retrieval Methods')
    .replace('\\begin{abstract}','\\begin{abstract}\nA test abstract.')
    .replace(/(\\label\{[^}]+\})/g,'$1\nConditions in \\citep{lewis2020}.');
  write(root,'paper/main.tex',tex);write(root,'paper/references.bib','@article{lewis2020,title={Retrieval methods},author={Lewis, Patrick},year={2020}}');
  finishWriter(root);build(root);return {project,root,paper};
}
function finishWriter(root,prefix='writer') {
  let n=0;do {
    const agentId=`${prefix}-${n++}`;paperControl(root,'bind-paper',{agentId,role:'paper'});
    const p=stageControl(root,'writer-start',{agentId});write(root,'paper/writing-handoff.md',`Phase ${p.phase}; fixture only`);
    stageControl(root,'writer-finish',{agentId,phase:p.phase,inputHash:p.inputHash,...stopped});
  }while(!writerReady(root));
}
function build(root) {
  const r=buildPaper(path.join(root,'paper'),{run:(cmd,args,opts)=>{
    assert.equal(opts.shell,false);assert.ok(args.includes('-no-shell-escape'));assert.ok(args.includes('-norc'));assert.ok(args.includes('-pdf'));
    const out=args.find(a=>a.startsWith('-outdir=')).slice(8);
    fs.writeFileSync(path.join(out,'main.pdf'),'%PDF-1.4\nsynthetic output');fs.writeFileSync(path.join(out,'main.log'),'ok');return {status:0};
  }});assert.equal(r.status,'success',JSON.stringify(r));
}
function start(root,agentId,extra={}) {
  paperControl(root,'bind-paper',{agentId,role:'paper'});return formatControl(root,'start',{agentId,kind:'check',...extra});
}
function finish(root,a,{major=false,unavailable=false,...extra}={}) {
  return formatControl(root,'finish',{agentId:a.agentId,...stopped,officialStatus:unavailable?'unavailable':'verified',
    checkedPdfHash:a.pdfHash,pdfChecked:true,clean:!major,...(major?{reason:'Unresolved major clipping'}:{}),...extra});
}

test('selection defaults, aliases, editions and unresolved requests are explicit',t=>{
  assert.equal(selectTemplate().venue,'NeurIPS');assert.equal(selectTemplate({venue:'nips'}).id,'neurips-2026');
  assert.equal(selectTemplate({venue:'ICLR',year:2027}).venue,'ICLR');assert.equal(selectTemplate({venue:'ICLR',year:2026}),null);
  const {root,paper}=setup(t);const old=fs.readFileSync(path.join(paper,'main.tex'),'utf8');
  assert.throws(()=>configurePaper(root,{venue:'ACL'}),/explicit/);
  configurePaper(root,{venue:'unknown',explicitChange:true,reason:'User requested unknown venue'});
  assert.equal(paperConfig(root).status,'unresolved');assert.equal(fs.readFileSync(path.join(paper,'main.tex'),'utf8'),old);
  assert.equal(paperStatus(paper).current,false);assert.equal(writerReady(root),false);
  const history=path.join(root,'.slr/paper-config-history'),entry=fs.readdirSync(history)[0];
  assert.ok(entry);assert.ok(fs.existsSync(path.join(history,entry,'neurips_2026.sty')));
});

test('six adapters have bounded guides, verified English engines and immutable dependencies',t=>{
  for(const entry of catalog()) {
    const {root,paper}=setup(t,entry.venue),c=paperConfig(root);
    assert.ok(fs.readFileSync(path.join(library,entry.guide),'utf8').length<=8000);
    assert.deepEqual(validatePaper(fs.readFileSync(path.join(paper,'main.tex'),'utf8'),fs.readFileSync(path.join(paper,'references.bib'),'utf8'),c),[]);
    checkTemplateFiles(paper);fs.appendFileSync(path.join(paper,entry.dependencies[0]),'\n% modified');
    assert.equal(paperStatus(paper).current,false);assert.throws(()=>checkTemplateFiles(paper),/dependency changed/);
  }
});

test('AAAI Chinese engine is refused without bypassing official style',t=>{
  const {root,paper}=setup(t,'AAAI');configurePaper(root,{venue:'AAAI',language:'chinese',explicitChange:true,reason:'User requested Chinese'});
  assert.throws(()=>preparePaper(paper),/unsupported/);assert.equal(paperStatus(paper).current,false);
});

test('format gate requires current completion without producing any format report',t=>{
  const {root,paper}=setup(t);assert.equal(formatStatus(root).canReview,false);
  assert.throws(()=>finalReviewControl(root,'submit'),/format check/);
  const a=start(root,'check-1');assert.equal(a.artifact,undefined);finish(root,a);
  assert.equal(formatStatus(root).status,'passed');
  const c=finalReviewControl(root,'submit');const manifest=JSON.parse(fs.readFileSync(path.join(paper,'reviews',c.submissions[0].id,'manifest.json'),'utf8')).manifest;
  assert.ok(manifest['.slr/paper-config.json']);assert.ok(manifest['paper/neurips_2026.sty']);
  assert.equal(Object.keys(manifest).some(n=>n.startsWith('paper/format/')),false);
  assert.equal(fs.existsSync(path.join(paper,'format')),false);
  fs.appendFileSync(path.join(paper,'main.tex'),'\n% changed');assert.equal(formatStatus(root).canReview,false);
});

test('unavailable official URLs allow review with honest status and explicit refresh',t=>{
  const {root}=setup(t);finish(root,start(root,'unavailable'),{unavailable:true});
  assert.equal(formatStatus(root).status,'official_unverified');assert.equal(formatStatus(root).canReview,true);
  assert.equal(finalReviewControl(root,'submit').status,'awaiting_review');
  finish(root,start(root,'retry-official',{refreshOfficial:true,reason:'User requested website retry'}));
  assert.equal(stages(root).format.runs.length,2);assert.equal(formatStatus(root).status,'passed');
});

test('same check invocation repairs sources, main recompiles, and a fresh check passes',t=>{
  const {root,paper}=setup(t),a=start(root,'fix');fs.appendFileSync(path.join(paper,'main.tex'),'\n% layout fix');
  assert.equal(buildPaper(paper).status,'writing-incomplete');
  assert.equal(finish(root,a).status,'awaiting_compile');assert.equal(writerReady(root),true);
  assert.equal(formatStatus(root).canReview,false);build(root);
  finish(root,start(root,'verify'));assert.equal(formatStatus(root).canReview,true);
  assert.equal(formatStatus(root).repairs,1);
});

test('three direct repairs exhaust edit permission then unresolved major defects pause',t=>{
  const {root,paper,project}=setup(t);
  for(let n=1;n<=3;n++) {
    const a=start(root,`fix-${n}`);assert.equal(a.canEdit,true);
    fs.appendFileSync(path.join(paper,'main.tex'),`\n% repair ${n}`);finish(root,a);build(root);
  }
  const a=start(root,'last-check');assert.equal(a.canEdit,false);
  assert.equal(evaluateHook({project_dir:project,agent_type:'slr-paper-writer',agent_id:a.agentId,
    tool_name:'Write',tool_input:{file_path:path.join(paper,'main.tex')}}).allowed,false);
  finish(root,a,{major:true});assert.equal(formatStatus(root).status,'paused');
  assert.equal(formatStatus(root).canReview,false);assert.throws(()=>start(root,'fourth'),/paused/);
});

test('interrupted check preserves partial sources without consuming a completed repair',t=>{
  const {root,paper}=setup(t),a=start(root,'partial');fs.appendFileSync(path.join(paper,'main.tex'),'\n% partial repair');
  formatControl(root,'abandon',{agentId:a.agentId,...stopped,reason:'Runtime interrupted'});
  assert.equal(formatStatus(root).canReview,false);assert.equal(formatStatus(root).repairs,0);
  assert.equal(writerReady(root),true);build(root);finish(root,start(root,'continue'));
  assert.equal(formatStatus(root).canReview,true);
});

test('format checks can fetch selected official sites and edit sources but no report, style or evidence',t=>{
  const {root,project,paper}=setup(t),a=start(root,'format-checker');
  const hook=(tool_name,tool_input)=>evaluateHook({project_dir:project,agent_type:'slr-paper-writer',agent_id:a.agentId,tool_name,tool_input}).allowed;
  assert.equal(hook('WebFetch',{url:paperConfig(root).requirementsPages[0]}),true);
  assert.equal(hook('WebFetch',{url:'https://example.com/rules'}),false);
  assert.equal(hook('WebSearch',{query:'rules'}),false);
  assert.equal(hook('WebSearch',{query:'rules',allowed_domains:['neurips.cc']}),true);
  for(const name of ['main.tex','references.bib','writing-handoff.md'])assert.equal(hook('Write',{file_path:path.join(paper,name)}),true);
  for(const name of ['paper/format/report.json','paper/neurips_2026.sty','.slr/paper-config.json','topics/retrieval/chapter.md'])
    assert.equal(hook('Write',{file_path:path.join(root,name)}),false,name);
  assert.equal(hook('Bash',{command:'latexmk main.tex'}),false);assert.equal(hook('Agent',{}),false);
  paperControl(root,'bind-paper',{agentId:'conflict',role:'paper'});
  assert.throws(()=>stageControl(root,'writer-start',{agentId:'conflict',newRevision:true,reason:'conflict'}),/format.*active/);
  finish(root,a);assert.equal(hook('WebFetch',{url:paperConfig(root).requirementsPages[0]}),false);
  assert.equal(hook('Write',{file_path:path.join(paper,'main.tex')}),false);
});

test('minimal completion requires current PDF inspection and official availability',t=>{
  const {root}=setup(t),a=start(root,'check'),c=paperConfig(root);
  assert.throws(()=>finish(root,a,{checkedPdfHash:'stale'}),/current PDF/);
  assert.throws(()=>finish(root,a,{pdfChecked:false}),/PDF inspection/);
  assert.throws(()=>finish(root,a,{officialStatus:'invented'}),/availability/);
  assert.equal(officialURL(c,'https://neurips.cc.evil.example/rules'),false);
  assert.equal(officialURL(c,'https://user:pass@neurips.cc/rules'),false);
  finish(root,a);assert.equal(formatStatus(root).canReview,true);
});
