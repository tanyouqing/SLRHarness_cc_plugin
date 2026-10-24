import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('role contracts preserve decomposition and limited writes',()=>{assert.match(read('agents/slr-manager.md'),/subtopic/i);assert.match(read('agents/slr-worker.md'),/metadata.json/);assert.match(read('agents/slr-paper-writer.md'),/targeted|specific paper/i);assert.match(read('agents/slr-checker.md'),/major/);assert.match(read('skills/review/references/workflow.md'),/main-dispatch/);});
test('old update execution is suspended and legacy research read-only',()=>{assert.match(read('skills/update/SKILL.md'),/suspend/i);assert.match(read('skills/review/references/workflow.md'),/Schema 1.*status/);});
test('active plugin files contain no retired appraisal protocol',()=>{const banned=/\b(?:ESS|RUS|ORS)\b|slr-score|slr-ranking|validate-ranking-scores|mandatory evidence scoring|neutral imputation/i;for(const folder of ['agents','skills','scripts','evals','docs'])for(const f of walk(path.join(root,folder)))if(/\.(?:md|mjs|json|yaml)$/.test(f))assert.equal(banned.test(fs.readFileSync(f,'utf8')),false,path.relative(root,f));});
function* walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())yield* walk(f);else yield f;}}
test('generic template chooses one title and dynamic topic block',()=>{const t=read('skills/paper/template/neurips_2026.tex');assert.match(t,/\\section\{Background\}/);assert.match(t,/\\section\{Taxonomy\}/);assert.equal((t.match(/\\section\{Topic Name\}/g)||[]).length,1);assert.match(t,/\[preprint\]/);});

test('paper contract uses nonblocking self-proofreading',()=>{const s=read('skills/paper/SKILL.md');assert.match(s,/lightweight proofreading only/);assert.match(s,/continues compilation/);assert.doesNotMatch(s,/save its verdict through review-paper/);});

test('Checker and final Reviewer have separate contracts',()=>{
  const checker=read('agents/slr-checker.md'), reviewer=read('agents/slr-reviewer.md');
  assert.match(checker,/name: slr-checker/);assert.match(checker,/Do not search, edit or delegate/);
  assert.match(reviewer,/name: slr-reviewer/);assert.match(reviewer,/WebSearch, WebFetch/);
  assert.match(reviewer,/Twenty|twenty/);assert.match(reviewer,/Scoper/);assert.match(reviewer,/Manager/);assert.match(reviewer,/Worker/);
  assert.match(read('skills/paper/SKILL.md'),/final-review.mjs status/);
  assert.match(read('skills/paper/references/final-review.md'),/three completed revisions/);
  for(const file of ['scripts/pipeline.mjs','agents/slr-checker.md','skills/review/references/workflow.md'])
    assert.doesNotMatch(read(file),/reviewerId/);
});


test('all roles distinguish READY from final transport and preserve exact review JSON',()=>{
  for(const role of ['scoper','manager','worker','checker','reviewer','paper-writer']) {
    const prompt=read(`agents/slr-${role}.md`);
    assert.match(prompt,/Required result delivery/);assert.match(prompt,/SubagentHandback/);
    assert.match(prompt,/READY never means/);assert.match(prompt,/otherwise use a final text/);
    assert.match(prompt,/PARTIAL:/);assert.match(prompt,/BLOCKED:/);
  }
  for(const role of ['checker','reviewer'])assert.match(read(`agents/slr-${role}.md`),/Do not prepend DONE:/);
});

test('orchestration integrates bounded delivery recovery without self-approval',()=>{
  for(const f of ['skills/review/SKILL.md','skills/review/references/workflow.md','skills/paper/SKILL.md','skills/paper/references/final-review.md'])assert.match(read(f),/handback\.md/);
  const contract=read('skills/review/references/handback.md');
  assert.match(contract,/at most one focused recovery/);assert.match(contract,/at most\s+three owned paper IDs/);
  assert.match(contract,/remainingPaperIds\s+is empty/);assert.match(contract,/Do not manually take over independent/);
  assert.match(contract,/SendMessage/);assert.match(contract,/existing maximum of two attempts/);
});

test('review defaults skip initial questions but retain human scope approval',()=>{
  const entry=read('skills/review/SKILL.md'), flow=read('skills/review/references/workflow.md');
  for(const text of [entry,flow]) {
    assert.match(text,/Do not ask initial configuration questions/);
    assert.match(text,/verifiable preprints/);
    assert.match(text,/search cutoff/);
    assert.match(text,/hard limit on paper count/);
  }
  assert.match(entry,/stop for explicit human approval/);
  assert.match(flow,/explicitApproval:true,userMessage,scopeHash/);
  assert.doesNotMatch(entry,/No workspace or scoper\s+starts before intake completes/);
  assert.match(read('skills/paper/SKILL.md'),/ask once for missing audience/);
});

test('scope dispatch separates global authorship from research topic ownership',()=>{
  for(const file of ['agents/slr-scoper.md','agents/slr-manager.md','skills/review/references/workspace-schemas.md']) {
    const text=read(file);
    assert.match(text,/Global sections never count/);
    assert.match(text,/Paper Agent writes these global sections/);
    assert.match(text,/Unified Evolutionary Taxonomy/);
  }
  const scope=read('skills/review/references/scoping.md');
  assert.match(scope,/Only group 2 enters draft.topics/);
  assert.match(scope,/never fill the/);
  const flow=read('skills/review/references/workflow.md');
  assert.match(flow,/before binding Managers/);
  assert.match(flow,/not semantic ownership/);
  assert.match(flow,/ask the user to resolve/);
  assert.match(read('agents/slr-manager.md'),/before planning or launching Workers/);
  for(const file of ['skills/paper/SKILL.md','agents/slr-paper-writer.md','skills/paper/references/paper-template.md'])
    assert.match(read(file),/Paper Agent is both author and/);
});

test('bounded workflow routes Worker delivery to Manager and uses staged source/report handoffs',()=>{
  assert.match(read('agents/slr-manager.md'),/manager-control.mjs/);
  assert.match(read('agents/slr-manager.md'),/Workers return\s+to you/);
  assert.match(read('skills/review/references/workflow.md'),/Main does not reread the entire corpus/);
  assert.match(read('agents/slr-paper-writer.md'),/Do not read every chapter/);
  assert.match(read('agents/slr-reviewer.md'),/assigned score artifact/);
  assert.match(read('skills/paper/references/staged-execution.md'),/fresh Reviewer/);
  assert.match(read('skills/review/references/context-workflow.md'),/Hooks never trigger \/compact/);
});
