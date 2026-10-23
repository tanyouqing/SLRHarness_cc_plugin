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
