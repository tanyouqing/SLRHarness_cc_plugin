import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scaffold} from '../evals/fixture-lib.mjs';
import {loadState} from '../scripts/pipeline.mjs';
for(const kind of ['three-topic','paper-revision','legacy','scope-gate'])test(`scaffold ${kind} safely`,t=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),'slr-eval-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));const r=scaffold(kind,p);assert.ok(loadState(r));assert.throws(()=>scaffold(kind,p),/already exists/);});
