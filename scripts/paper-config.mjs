import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {atomicJSON,withLock} from './pipeline.mjs';

export const library=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../skills/paper/template/library');
export const digest=v=>createHash('sha256').update(v).digest('hex');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const need=(v,m)=>{if(!v)throw new Error(m);};
export const configPath=root=>path.join(root,'.slr/paper-config.json');
export const paperConfig=root=>fs.existsSync(configPath(root))?read(configPath(root)):null;
export const catalog=()=>read(path.join(library,'catalog.json')).templates;
export function selectTemplate({venue='NeurIPS',year,templateId}={}) {
  return catalog().find(t=>templateId?t.id===templateId:
    [t.venue,...t.aliases??[]].some(x=>x.toLowerCase()===venue.toLowerCase()) && (!year || String(year)===t.editionYear))??null;
}
export function templateFor(config) {
  need(config?.status==='ready','paper template configuration is unresolved');
  const t=selectTemplate({templateId:config.templateId});
  need(t?.pipelineSelectable,'template is unavailable');
  need(config.mode==='preprint' && config.engine===t.engines[config.language]?.engine,'invalid preprint engine configuration');
  need(t.guideHash===config.guideHash && digest(fs.readFileSync(path.join(library,t.guide)))===config.guideHash,'local guide changed; explicitly refresh configuration');
  need(digest(fs.readFileSync(path.join(library,t.skeleton)))===config.skeletonHash,'template skeleton changed; explicitly refresh configuration');
  return t;
}
export function configurePaper(root,args={}) {
  return withLock(root,()=>{
    const old=paperConfig(root),t=selectTemplate(args);
    const rawLanguage=String(args.language??old?.language??'english').toLowerCase();
    const language=({en:'english',zh:'chinese','zh-cn':'chinese','中文':'chinese','简体中文':'chinese'})[rawLanguage]??rawLanguage;
    need(['english','chinese'].includes(language),'supported manuscript languages: english, chinese');
    need((args.reason??'').length<=1000,'configuration reason must be bounded');
    const next=t?{schemaVersion:1,status:'ready',templateId:t.id,venue:t.venue,year:t.editionYear,version:t.version,
      mode:'preprint',language,guide:t.guide,guideHash:t.guideHash,skeletonHash:digest(fs.readFileSync(path.join(library,t.skeleton))),
      engine:t.engines[language]?.engine,requirementsPages:t.requirementsPages,reason:args.reason??'Initial prompt selection; default NeurIPS'}:
      {schemaVersion:1,status:'unresolved',requested:{venue:args.venue,year:args.year,templateId:args.templateId},language,reason:'Requested conference/version is not registered; no fallback was selected'};
    if(old && JSON.stringify({...old,reason:null})===JSON.stringify({...next,reason:null}))return old;
    need(!old || args.explicitChange===true && typeof args.reason==='string'&&args.reason.trim(),'template changes require an explicit user request and reason');
    const stagesFile=path.join(root,'.slr/work-stages.json');
    if(fs.existsSync(stagesFile)) {
      const stages=read(stagesFile);need(!stages.writers?.at(-1)?.active && !stages.format?.active && !Object.values(stages.reviews??{}).some(r=>r.active),'stop the active writer before changing template');
    }
    const main=path.join(root,'paper/main.tex');
    need(old || !fs.existsSync(main) || args.explicitChange===true,'existing manuscript: explicit template adoption required');
    if(old || fs.existsSync(main)) {
      const dir=path.join(root,'.slr/paper-config-history',`${Date.now()}-${digest(JSON.stringify(next)).slice(0,12)}`);
      fs.mkdirSync(dir,{recursive:true});
      if(old)atomicJSON(path.join(dir,'config.json'),old);
      const previousDependencies=old?.templateId?selectTemplate({templateId:old.templateId})?.dependencies??[]:['neurips_2026.sty'];
      for(const name of new Set(['main.tex','references.bib','main.pdf','build.json','writing-handoff.md',...previousDependencies])) {
        const f=path.join(root,'paper',name);if(fs.existsSync(f))fs.copyFileSync(f,path.join(dir,name));
      }
    }
    atomicJSON(configPath(root),next);return next;
  });
}
export function paperFiles(paper) {
  const c=paperConfig(path.dirname(paper));
  return c?['main.tex','references.bib',...templateFor(c).dependencies]:['main.tex','references.bib','neurips_2026.sty'];
}
export function checkTemplateFiles(paper) {
  const c=paperConfig(path.dirname(paper));if(!c)return;
  const t=templateFor(c),manifest=read(path.join(library,t.fileManifest));
  for(const name of t.dependencies) {
    const entry=manifest.find(x=>x.path===name);
    need(entry && digest(fs.readFileSync(path.join(paper,name)))===entry.sha256,`official template dependency changed: ${name}`);
  }
}
export function officialURL(config,url) {
  try {
    const u=new URL(url),t=templateFor(config);
    return u.protocol==='https:' && !u.username && !u.password && t.officialHosts.includes(u.hostname);
  }catch{return false;}
}
export function prepareConfigured(paper) {
  const c=paperConfig(path.dirname(paper)),t=templateFor(c);
  need(t.engines[c.language]?.verified===true,`unverified/unsupported template-language combination: ${t.id}/${c.language}`);
  for(const name of t.dependencies) {
    const src=path.join(library,t.directory,name),dst=path.join(paper,name);
    if(fs.existsSync(dst))need(digest(fs.readFileSync(dst))===digest(fs.readFileSync(src)),`preserve conflicting dependency and resolve manually: ${name}`);
    else fs.copyFileSync(src,dst);
  }
  const main=path.join(paper,'main.tex');
  if(!fs.existsSync(main))fs.writeFileSync(main,fs.readFileSync(path.join(library,t.skeleton),'utf8').replace('\\surveychinesefalse',c.language==='chinese'?'\\surveychinesetrue':'\\surveychinesefalse'));
  if(!fs.existsSync(path.join(paper,'references.bib')))fs.writeFileSync(path.join(paper,'references.bib'),'% Verified sources only.\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [action,root,input]=process.argv.slice(2);need(path.isAbsolute(root??''),'absolute workspace required');
    need(['configure','status'].includes(action),'use configure|status');
    console.log(JSON.stringify(action==='status'?paperConfig(root):configurePaper(root,input?read(input):{})));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
