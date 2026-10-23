import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { preparePaper, validatePaper, buildPaper, paperStatus } from '../scripts/paper-build.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-paper-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  preparePaper(dir);
  const tex = fs.readFileSync(path.join(dir, 'main.tex'), 'utf8')
    .replace('Survey Title', 'Retrieval Methods: A Survey')
    .replace('\\section{Topic Name}\\label{sec:topic-slug}', ['Retrieval-Augmented Generation', 'Long-Context Modeling', 'Hybrid Methods'].map((name, i) => `\\section{${name}}\\label{sec:topic-${i}}`).join('\n'))
    .replace('\\begin{abstract}', '\\begin{abstract}\nA limited review of retrieval methods.')
    .replace(/(\\label\{[^}]+\})/g, '$1\nEvidence and comparison conditions are discussed in \\citep{lewis2020}.');
  const bib = '@article{lewis2020, author={Lewis, Patrick and others}, title={Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks}, year={2020}}';
  fs.writeFileSync(path.join(dir, 'main.tex'), tex);
  fs.writeFileSync(path.join(dir, 'references.bib'), bib);
  return { dir, tex, bib };
}

function successfulRun(command, args, options) {
  assert.equal(command, 'latexmk');
  assert.ok(args.includes('-norc'));
  assert.ok(args.includes('-no-shell-escape'));
  assert.equal(options.shell, false);
  const output = args.find((arg) => arg.startsWith('-outdir=')).slice(8);
  fs.writeFileSync(path.join(output, 'main.pdf'), '%PDF-1.4\nfake test payload');
  fs.writeFileSync(path.join(output, 'main.log'), 'Build completed');
  return { status: 0, stdout: '', stderr: '' };
}

test('preparation is idempotent and preserves legacy manuscripts and edited sources', (t) => {
  const { dir, tex } = fixture(t);
  fs.writeFileSync(path.join(dir, 'REVIEW_PAPER.md'), 'legacy');
  preparePaper(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'main.tex'), 'utf8'), tex);
  assert.equal(fs.readFileSync(path.join(dir, 'REVIEW_PAPER.md'), 'utf8'), 'legacy');
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '.build/\n');
});

test('structure and citation checks reject placeholder, missing and duplicate references', (t) => {
  const { tex, bib } = fixture(t);
  assert.deepEqual(validatePaper(tex, bib), []);
  assert.match(validatePaper(tex.replace('Long-Context Modeling', 'Topic Name B'), bib).join(), /placeholder/);
  assert.match(validatePaper(tex.replace('sec:comparison', 'sec:wrong'), bib).join(), /expected/);
  assert.match(validatePaper(tex, '').join(), /missing BibTeX/);
  assert.match(validatePaper(tex, bib + bib).join(), /duplicate/);
  assert.match(validatePaper(tex, bib + '\n@article{unused, title={Other}}').join(), /uncited/);
});

test('PDF freshness requires successful build plus current sources and matching PDF', (t) => {
  const { dir } = fixture(t);
  assert.equal(buildPaper(dir, { run: successfulRun }).status, 'success');
  assert.equal(paperStatus(dir).current, true);
  fs.appendFileSync(path.join(dir, 'main.tex'), '\n% revision');
  assert.equal(paperStatus(dir).current, false);
  assert.equal(buildPaper(dir, { run: successfulRun }).status, 'success');
  fs.appendFileSync(path.join(dir, 'main.pdf'), 'changed');
  assert.equal(paperStatus(dir).current, false);
});

test('missing compiler and failed rebuild preserve old PDF without publishing it as current', (t) => {
  const { dir } = fixture(t);
  buildPaper(dir, { run: successfulRun });
  const old = fs.readFileSync(path.join(dir, 'main.pdf'));
  const result = buildPaper(dir, { run: () => ({ error: new Error('ENOENT latexmk') }) });
  assert.equal(result.status, 'compile-failed');
  assert.equal(paperStatus(dir).current, false);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'main.pdf')), old);
  const fresh = fs.readdirSync(path.join(dir, '.build'));
  assert.equal(fresh.length, 2);
});

test('unresolved references and missing glyphs prevent publishing successful-process output', (t) => {
  const { dir } = fixture(t);
  for (const message of ['LaTeX Warning: There were undefined references.', 'Missing character: missing glyph']) {
    const result = buildPaper(dir, { run: (cmd, args, opts) => {
      const response = successfulRun(cmd, args, opts);
      const output = args.find((arg) => arg.startsWith('-outdir=')).slice(8);
      fs.writeFileSync(path.join(output, 'main.log'), message);
      return response;
    } });
    assert.equal(result.status, 'compile-failed');
    assert.equal(fs.existsSync(path.join(dir, 'main.pdf')), false);
  }
});
