// Real compiler probe of candidate adapters. Does not mark engines verified or edit the catalog.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {catalog,library} from '../scripts/paper-config.mjs';
import {configurePaper} from '../scripts/paper-config.mjs';
import {preparePaper,buildPaper,paperStatus} from '../scripts/paper-build.mjs';
const out=process.argv[2];
if(!path.isAbsolute(out??'')||fs.existsSync(out))throw new Error('provide a new absolute output directory');
fs.mkdirSync(out,{recursive:true});
const results=[];
for(const t of catalog().filter(t=>!process.argv[3]||process.argv[3].split(',').includes(t.venue)))for(const language of ['english','chinese']) {
  const root=path.join(out,`${t.venue.toLowerCase()}-${language}`),dir=path.join(root,'paper');fs.mkdirSync(dir,{recursive:true});
  if(t.venue==='AAAI'&&language==='chinese') {
    results.push({templateId:t.id,language,status:'unsupported',reason:'Official AAAI 2027 style requires pdfTeX; no engine guard bypass'});continue;
  }
  const production=t.engines[language].verified;
  if(production) {
    fs.mkdirSync(path.join(root,'.slr'));configurePaper(root,{venue:t.venue,language});preparePaper(dir);
  } else for(const f of t.dependencies)fs.copyFileSync(path.join(library,t.directory,f),path.join(dir,f));
  let tex=fs.readFileSync(path.join(library,t.skeleton),'utf8').replaceAll('Survey Title','Retrieval Methods: A Survey')
    .replace('Topic Name','Retrieval Methods').replace('\\begin{abstract}','\\begin{abstract}\nA compiler fixture testing the conference preprint adapter.')
    .replace(/(\\label\{[^}]+\})/g,'$1\nMethods and their documented conditions are compared in \\citep{lewis2020}.');
  if(language==='chinese')tex=tex.replace('\\surveychinesefalse','\\surveychinesetrue').replace('A compiler fixture','中文编译测试。 A compiler fixture');
  fs.writeFileSync(path.join(dir,'main.tex'),tex);
  fs.writeFileSync(path.join(dir,'references.bib'),'@article{lewis2020, author={Lewis, Patrick and others}, title={Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks}, year={2020}}\n');
  if(production) {
    const result=buildPaper(dir),item={templateId:t.id,language,status:result.status,directory:dir,current:paperStatus(dir).current,production:true,...result};
    results.push(item);console.log(JSON.stringify(item));continue;
  }
  const r=spawnSync('latexmk',['-norc',language==='english'?'-pdf':'-xelatex','-bibtex','-interaction=nonstopmode','-halt-on-error','-no-shell-escape','main.tex'],{cwd:dir,shell:false,windowsHide:true,encoding:'utf8',timeout:180000});
  fs.writeFileSync(path.join(dir,'validation-output.txt'),`${r.stdout??''}\n${r.stderr??''}`);
  const log=fs.existsSync(path.join(dir,'main.log'))?fs.readFileSync(path.join(dir,'main.log'),'utf8'):'';
  const status=r.status===0&&fs.existsSync(path.join(dir,'main.pdf'))&&!/undefined references|undefined citations|Citation .* undefined|Reference .* undefined|Missing character:/i.test(log)?'success':'failed';
  const item={templateId:t.id,language,status,directory:dir,error:r.error?.message,warnings:log.split(/\r?\n/).filter(x=>/Overfull|end occurred/.test(x))};
  results.push(item);console.log(JSON.stringify(item));
}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
if(results.some(r=>!['success','unsupported'].includes(r.status)))process.exitCode=1;
