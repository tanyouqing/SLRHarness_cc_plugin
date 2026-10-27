import fs from 'node:fs';
import path from 'node:path';

export const inputPath=(input,value='.')=>path.resolve(input.cwd??input.project_dir??process.env.CLAUDE_PROJECT_DIR??process.cwd(),value);
export function hasSymlink(file) {
  for(let p=path.resolve(file);;p=path.dirname(p)) {
    try{if(fs.lstatSync(p).isSymbolicLink())return true;}catch(e){if(e.code!=='ENOENT')return true;}
    if(path.dirname(p)===p)return false;
  }
}
// Recognize a project, an explicit workspace, or a descendant of either.
// Candidate identity remains unambiguous; callers must not select the first binding.
export function workspaceRoots(input) {
  const roots=new Set();
  for(const base of [input.project_dir,process.env.CLAUDE_PROJECT_DIR,input.cwd].filter(x=>typeof x==='string'&&x)) {
    for(let p=path.resolve(base);;p=path.dirname(p)) {
      if(hasSymlink(p))break;
      if(fs.existsSync(path.join(p,'.slr/state.json'))){roots.add(p);break;}
      const dir=path.join(p,'workspaces');
      if(fs.existsSync(dir)&&!hasSymlink(dir)) {
        for(const e of fs.readdirSync(dir,{withFileTypes:true}))if(e.isDirectory()&&!e.isSymbolicLink()) {
          const root=path.join(dir,e.name);if(fs.existsSync(path.join(root,'.slr/state.json')))roots.add(root);
        }
        break;
      }
      if(path.dirname(p)===p||fs.existsSync(path.join(p,'.git')))break;
    }
  }
  return [...roots];
}
export function sessionProject(input) {
  let base=path.resolve(input.project_dir??process.env.CLAUDE_PROJECT_DIR??input.cwd??'.');
  for(let p=base;;p=path.dirname(p)) {
    if(fs.existsSync(path.join(p,'.slr/state.json')))return path.basename(path.dirname(p))==='workspaces'?path.dirname(path.dirname(p)):p;
    if(fs.existsSync(path.join(p,'workspaces')))return p;
    if(path.dirname(p)===p||fs.existsSync(path.join(p,'.git')))return base;
  }
}
