import {paperConfig,templateFor,paperFiles,prepareConfigured,checkTemplateFiles,configPath,library} from './paper-config.mjs';
import {writerReady,stages} from './work-stages.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const template = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/paper/template');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const read = (file) => fs.readFileSync(file, 'utf8');
const uncomment = (text) => text.replace(/(?<!\\)%[^\n]*/g, '');

export function citedPaperKeys(tex) {
  return new Set([...uncomment(tex).matchAll(/\\cite[pt]\*?(?:\[[^\]]*\]){0,2}\{([^}]+)\}/g)].flatMap(m=>m[1].split(',').map(s=>s.trim())));
}

export function validatePaper(tex, bib, config=null) {
  const errors = [];
  const rawTex=tex;
  tex = uncomment(tex);
  bib = uncomment(bib);
  const sections = [...tex.matchAll(/\\section\{([^{}]+)\}\s*\\label\{([^{}]+)\}/g)];
  const labels = sections.map((m) => m[2]);
  const fixed = ['sec:introduction', 'sec:background', 'sec:taxonomy'];
  const tail = ['sec:comparison', 'sec:challenges', 'sec:conclusion'];
  if (fixed.some((s, i) => labels[i] !== s) || tail.some((s, i) => labels[labels.length - 3 + i] !== s)
      || labels.length < 7 || labels.slice(3, -3).some((s) => !/^sec:topic-[a-z0-9-]+$/.test(s))) {
    errors.push('expected introduction, background, taxonomy, actual topic section(s), comparison, challenges, conclusion');
  }
  if (new Set(labels).size !== labels.length) errors.push('duplicate section labels');
  if(!['Background','Preliminaries'].includes(sections[1]?.[1])) errors.push('choose Background OR Preliminaries');
  if(!['Taxonomy','Unified Framework'].includes(sections[2]?.[1])) errors.push('choose Taxonomy OR Unified Framework');
  if ([...tex.matchAll(/\\section\{/g)].length !== sections.length) errors.push('each top-level section needs its stable label');
  if (/Survey Title|Topic Name|Survey of Existing Approaches|\bTODO\b|\bTBD\b/.test(tex)) errors.push('placeholder or generic survey heading remains');
  if (!config) {
    if (!/\\usepackage\[preprint\]\{neurips_2026\}/.test(tex)) errors.push('use the preprint style');
  } else {
    const t=templateFor(config);
    if(t.protectedAdapter) {
      const block=text=>/% BEGIN SLR PREPRINT ADAPTER[\s\S]*?% END SLR PREPRINT ADAPTER/.exec(text.replace(/\r\n/g,'\n'))?.[0];
      if(block(rawTex)!==block(read(path.join(library,t.skeleton))))errors.push('preserve the registered neutral preprint adapter');
    }
    const expected=t.venue==='ICLR'?`\\usepackage{${t.style}}`:`\\usepackage[preprint]{${t.style}}`;
    if(!tex.includes(expected))errors.push('use the configured preprint style');
    if(!t.styleOwnsBibliography && !tex.includes(`\\bibliographystyle{${t.bibliographyStyle}}`))errors.push('use the conference bibliography style');
    if(t.styleOwnsBibliography && /\\bibliographystyle\b/.test(tex))errors.push('template owns bibliography style; remove duplicate command');
    if(t.venue==='AAAI' && (/\\bibliographystyle|\\usepackage(?:\[[^\]]*\])?\{(?:hyperref|times|geometry)\}/.test(tex)))errors.push('AAAI owns bibliography/fonts and forbids these packages');
    if(t.venue==='ICLR' && (!tex.includes('Preprint. Work in progress.') || !tex.includes('\\patchcmd{\\@maketitle}')))errors.push('ICLR neutral preprint adapter required');
    if(t.venue!=='ICLR' && /\\(?:iclrfinalcopy|iclrfinaltrue)\b/.test(tex))errors.push('unexpected final-copy command');
    if(/\\usepackage\[(?:[^\]]*,)?(?:final|accepted|submission|review)(?:,[^\]]*)?\]/.test(tex))errors.push('submission/final options are outside the preprint profile');
  }
  if (!/\\bibliography\{references\}/.test(tex)) errors.push('use references.bib');
  if (/\\(?:input|include|includegraphics|write18)\b/.test(tex)) errors.push('external inputs and executable commands are outside this single-file contract');
  const abstract = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/.exec(tex)?.[1] ?? '';
  if (!abstract.trim()) errors.push('abstract is empty');
  sections.forEach((m, i) => {
    const body = tex.slice(m.index + m[0].length, sections[i + 1]?.index ?? tex.search(/\\bibliograph(?:ystyle|y)\{/));
    if (!body.replace(/\\[a-zA-Z]+(?:\[[^\]]*\])?(?:\{[^{}]*\})?/g, '').trim()) errors.push(`empty section: ${m[2]}`);
  });
  const keys = [...bib.matchAll(/@(?!comment\b|string\b|preamble\b)[a-z]+\s*\{\s*([^,\s]+)\s*,/gi)].map((m) => m[1]);
  if (new Set(keys).size !== keys.length) errors.push('duplicate BibTeX keys');
  const cited = citedPaperKeys(tex);
  for (const key of cited) if (!keys.includes(key)) errors.push(`missing BibTeX key: ${key}`);
  for (const key of keys) if (!cited.has(key)) errors.push(`uncited BibTeX key: ${key}`);
  if (!cited.size) errors.push('no evidence citations');
  return errors;
}

export function sourceHash(paper) {
  checkTemplateFiles(paper);
  const c=paperConfig(path.dirname(paper));
  return digest(paperFiles(paper).map((name) => `${name}\0${read(path.join(paper, name))}`).join('\0')+(c?read(configPath(path.dirname(paper))):''));
}

function researchComplete(paper) {
  const stateFile=path.join(path.dirname(paper),'.slr/state.json');
  if(!fs.existsSync(stateFile)) return true; // Standalone template compilation.
  return ['completed','completed_with_limitations'].includes(JSON.parse(read(stateFile)).stage);
}

export function paperStatus(paper) {
  try {
    const record = JSON.parse(read(path.join(paper, 'build.json')));
    const current = researchComplete(paper) && record.status === 'success' && record.sourceHash === sourceHash(paper)
      && record.pdfHash === digest(fs.readFileSync(path.join(paper, 'main.pdf')));
    return { ...record, current, citedPaperCount:current?citedPaperKeys(read(path.join(paper,'main.tex'))).size:null };
  } catch { return { status: 'missing-or-unverified', current: false }; }
}

export function preparePaper(paper) {
  fs.mkdirSync(paper, { recursive: true });
  if(paperConfig(path.dirname(paper))) prepareConfigured(paper);
  else for (const [source, target] of [['neurips_2026.tex', 'main.tex'], ['references.bib', 'references.bib'], ['neurips_2026.sty', 'neurips_2026.sty']]) {
    const destination = path.join(paper, target);
    if (!fs.existsSync(destination)) fs.copyFileSync(path.join(template, source), destination);
  }
  const ignore = path.join(paper, '.gitignore');
  const previous = fs.existsSync(ignore) ? read(ignore) : '';
  if (!previous.split(/\r?\n/).includes('.build/')) fs.writeFileSync(ignore, `${previous}${previous && !previous.endsWith('\n') ? '\n' : ''}.build/\n`);
}

export function buildPaper(paper, { run = spawnSync } = {}) {
  const buildRoot = path.join(paper, '.build');
  fs.mkdirSync(buildRoot, { recursive: true });
  // A fresh directory prevents a failed build from publishing an old PDF.
  const buildDir = fs.mkdtempSync(path.join(buildRoot, 'run-'));
  const recordPath = path.join(paper, 'build.json');
  let hash = null;
  const save = (status, details) => {
    const record = { status, sourceHash: hash, ...details };
    fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    return record;
  };
  try {
    hash = sourceHash(paper);
    if(stages(path.dirname(paper)).format?.active) return save('writing-incomplete',{error:'finish active format invocation before compiling'});
    if(!writerReady(path.dirname(paper))) return save('writing-incomplete',{error:'complete current writer phases before compilation'});
    if(!researchComplete(paper)) return save('research-incomplete',{error:'paper delivery requires completed research'});
    const config=paperConfig(path.dirname(paper));
    if(config && !templateFor(config).engines[config.language]?.verified) throw new Error('template/language engine is not verified');
    const errors = validatePaper(read(path.join(paper, 'main.tex')), read(path.join(paper, 'references.bib')),config);
    if (errors.length) return save('validation-failed', { errors });
    // No shell, no project/user latexmk rc files, no shell escape, bounded runtime.
    const result = run('latexmk', ['-norc', config?.engine==='pdflatex'?'-pdf':'-xelatex', '-bibtex', '-interaction=nonstopmode',
      '-halt-on-error', '-file-line-error', '-no-shell-escape', `-outdir=${buildDir}`, 'main.tex'],
    { cwd: paper, encoding: 'utf8', timeout: 180000, windowsHide: true, shell: false });
    fs.writeFileSync(path.join(buildDir, 'build-output.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    const logPath = path.join(buildDir, 'main.log');
    const log = fs.existsSync(logPath) ? read(logPath) : '';
    const pdf = path.join(buildDir, 'main.pdf');
    if (result.error || result.status !== 0 || !fs.existsSync(pdf)) {
      return save('compile-failed', { error: result.error?.message ?? `latexmk exit ${result.status}`, log: path.relative(paper, buildDir) });
    }
    if (/undefined references|undefined citations|Citation .* undefined|Reference .* undefined|multiply defined|Missing character:/i.test(log)) {
      return save('compile-failed', { error: 'unresolved citations/references, duplicate labels or missing glyphs', log: path.relative(paper, buildDir) });
    }
    if (sourceHash(paper) !== hash) return save('compile-failed', { error: 'sources changed during compilation' });
    const bytes = fs.readFileSync(pdf);
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return save('compile-failed', { error: 'invalid PDF output' });
    fs.copyFileSync(pdf, path.join(paper, 'main.pdf'));
    return save('success', { pdfHash: digest(bytes), citedPaperCount:citedPaperKeys(read(path.join(paper,'main.tex'))).size, layoutWarnings: log.split(/\r?\n/).filter((s) => /Overfull \\[hv]box/.test(s)) });
  } catch (error) { return save('compile-failed', { error: error.message }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory] = process.argv.slice(2);
  if (!directory || !['prepare', 'validate', 'build', 'status'].includes(command)) {
    console.error('Usage: node scripts/paper-build.mjs <prepare|validate|build|status> <absolute-paper-directory>');
    process.exitCode = 2;
  } else {
    const paper = path.resolve(directory);
    try {
      let result;
      if (command === 'prepare') { preparePaper(paper); result = { prepared: paper }; }
      if (command === 'status') result = paperStatus(paper);
      if (command === 'validate') result = { errors: validatePaper(read(path.join(paper, 'main.tex')), read(path.join(paper, 'references.bib')),paperConfig(path.dirname(paper))) };
      if (command === 'build') result = buildPaper(paper);
      console.log(JSON.stringify(result, null, 2));
      if (result.errors?.length || (command === 'build' && result.status !== 'success')) process.exitCode = 1;
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
