import fs from 'node:fs';
import path from 'node:path';
import {inputPath,workspaceRoots} from './workspace-context.mjs';

const inside=(root,file)=>{const r=path.relative(root,file);return r===''||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
const real=p=>{try{return fs.realpathSync(p);}catch{return p;}};
const pieces=p=>path.resolve(p).replaceAll('\\','/').split('/').filter(Boolean);
function segmentMatch(pattern,value) {
  if(/[\[\]{}()!]/.test(pattern))return true; // unsupported patterns are conservative
  const regex=pattern.split('').map(c=>c==='*'?'.*':c==='?'?'.':c.replace(/[.*+?^$|\\]/g,'\\$&')).join('');
  return new RegExp('^'+regex+'$',process.platform==='win32'?'i':'').test(value);
}
export function mayReach(pattern,protectedDir,{directoryMatch=false}={}) {
  const a=pieces(pattern),b=pieces(protectedDir),memo=new Map();
  function visit(i,j) {
    const key=i+':'+j;if(memo.has(key))return memo.get(key);
    let value;
    if(j===b.length)value=true;
    // Grep globs can select a directory and thereby all of its descendants.
    else if(i===a.length)value=directoryMatch;
    else if(a[i]==='**')value=visit(i+1,j)||visit(i,j+1);
    else value=segmentMatch(a[i],b[j])&&visit(i+1,j+1);
    memo.set(key,value);return value;
  }
  return visit(0,0);
}
export function protectedSearch(input) {
  const args=input.tool_input??{},target=inputPath(input,args.path??'.'),resolved=real(target);
  const pattern=input.tool_name==='Glob'?args.pattern:args.glob;
  if(typeof pattern==='string'&&/[\\/]\.slr[\\/]kb(?:[\\/]|$)/i.test('/'+pattern))return 'KB cache search is restricted; use a role-scoped cache helper';
  const roots=workspaceRoots(input),protectedDirs=roots.map(r=>path.join(r,'.slr/kb'));
  if(/[\\/]\.slr[\\/]kb(?:[\\/]|$)/i.test(resolved))return 'KB cache search is restricted; use a role-scoped cache helper';
  for(const dir of protectedDirs) {
    if(inside(dir,resolved))return 'KB cache search is restricted; use a role-scoped cache helper';
    if(!inside(resolved,dir))continue;
    if(typeof pattern!=='string'||!pattern||/[{}()!]/.test(pattern)||pattern.replaceAll('\\','/').split('/').includes('..'))return 'Search could include KB internals; set a research-folder path or an explicit file glob';
    // Grep's bare filename glob applies at every depth; regex pattern is never a file filter.
    const effective=input.tool_name==='Grep'&&!/[\\/]/.test(pattern)?'**/'+pattern:pattern;
    if(mayReach(path.resolve(resolved,effective),dir,{directoryMatch:input.tool_name==='Grep'}))return 'Search could include KB internals; set a research-folder path or an explicit file glob';
  }
  return null;
}
