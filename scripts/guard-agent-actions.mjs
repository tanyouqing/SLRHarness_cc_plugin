import {managerRequest} from './manager-control.mjs';
import {enabled} from './context-control.mjs';
import {stageAccess} from './work-stages.mjs';
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadState, mutate } from "./pipeline.mjs";
const pipeline = path.join(path.dirname(fileURLToPath(import.meta.url)), "pipeline.mjs");
const roles = new Set(["slr-scoper", "slr-manager", "slr-worker", "slr-checker", "slr-reviewer", "slr-paper-writer"]);
const writes = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const deny = reason => ({allowed:false, reason});
const allow = () => ({allowed:true, reason:null});
const shortName = name => typeof name === "string" ? name.split(":").at(-1) : "";
function within(root, file) {
  const relative=path.relative(root,file);
  return relative!==".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function noLinks(root, file) {
  if(!within(root,file)) return false;
  let current=file;
  while(within(root,current)) {
    if(fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) return false;
    if(current===root) break;
    current=path.dirname(current);
  }
  return true;
}
function projectRoot(input) {
  if(input.project_dir || process.env.CLAUDE_PROJECT_DIR) return path.resolve(input.project_dir ?? process.env.CLAUDE_PROJECT_DIR);
  let p=path.resolve(input.cwd ?? process.cwd());
  while(path.dirname(p)!==p) {
    if(path.basename(path.dirname(p))==='workspaces') return path.dirname(path.dirname(p));
    p=path.dirname(p);
  }
  return path.resolve(input.cwd ?? process.cwd());
}
function binding(input) {
  if(!input.agent_id) return null;
  const base=path.join(projectRoot(input),'workspaces');
  if(!fs.existsSync(base)) return null;
  const matches=[];
  for(const item of fs.readdirSync(base,{withFileTypes:true})) {
    if(!item.isDirectory() || item.isSymbolicLink()) continue;
    const root=path.join(base,item.name);
    try {
      const state=loadState(root);
        const sidecar=path.join(root,'.slr/paper-bindings.json');
        const b=state.bindings?.[input.agent_id] ?? (fs.existsSync(sidecar)?JSON.parse(fs.readFileSync(sidecar,'utf8'))[input.agent_id]:null);
      const reviewFile=path.join(root,'.slr/final-review.json');
      const finalReview=fs.existsSync(reviewFile)?JSON.parse(fs.readFileSync(reviewFile,'utf8')):null;
      if(b) matches.push({root,state,b,finalReview});
    } catch { /* no valid binding in this workspace */ }
  }
  return matches.length===1?matches[0]:null;
}
function tokenize(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (quote) return null;
  if (current) tokens.push(current);
  return tokens;
}

function validPaperSearchYear(value) {
  const match = /^(19|20)(\d{2})(?:-(19|20)(\d{2}))?$/.exec(value);
  if (!match) return false;
  if (match[3] === undefined) return true;
  const start = Number(`${match[1]}${match[2]}`);
  const end = Number(`${match[3]}${match[4]}`);
  return start <= end;
}

function evaluatePaperSearchShell(command) {
  if (typeof command !== "string" || command.trim() === "") {
    return deny("paper-search shell command is empty");
  }
  if (/[;&|`$<>\r\n]/.test(command)) {
    return deny("paper-search command contains chaining, substitution, redirection, or a newline");
  }

  const tokens = tokenize(command.trim());
  if (!tokens || tokens.length === 0) return deny("paper-search command could not be parsed safely");
  if (tokens[0] !== "paper-search") {
    return deny("scopers and workers may run only the paper-search CLI through shell tools");
  }
  if (tokens.length === 2 && tokens[1] === "sources") return allow();
  if (tokens[1] !== "search") {
    return deny("paper-search access is limited to the sources and search subcommands");
  }
  if (tokens.length < 3 || tokens[2].trim() === "" || tokens[2].startsWith("-")) {
    return deny("paper-search search requires one quoted, non-empty query argument");
  }

  const seen = new Set();
  for (let index = 3; index < tokens.length; index += 2) {
    const option = tokens[index];
    const value = tokens[index + 1];
    if (!new Set(["-n", "-s", "-y"]).has(option) || value === undefined || seen.has(option)) {
      return deny("paper-search search allows each of -n, -s, and -y at most once");
    }
    seen.add(option);
    if (option === "-n" && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 20)) {
      return deny("paper-search -n must be an integer from 1 through 20");
    }
    if (option === "-s" && value !== "all" && !/^[a-z0-9][a-z0-9_-]*(?:,[a-z0-9][a-z0-9_-]*)*$/.test(value)) {
      return deny("paper-search -s must be all or a comma-separated list of source identifiers");
    }
    if (option === "-y" && !validPaperSearchYear(value)) {
      return deny("paper-search -y must be a year or ascending year range between 1900 and 2099");
    }
  }
  return allow();
}


export function evaluateHook(input) {
  const role=shortName(input?.agent_type);
  if(!roles.has(role)) return allow();
  const tool=input.tool_name, args=input.tool_input ?? {};
  const bound=binding(input);
  if(typeof tool!=='string') return deny('missing tool name');
  // Native result transport must work even before READY binding, or when reporting
  // a paused/failed task. It grants no file, shell, retrieval or delegation access.
  // The runtime routes this tool to the receiving parent; it is not SendMessage.
  if(tool==='SubagentHandback') return typeof args.message==='string' && args.message.trim() && args.message.length<=8000
    ?allow():deny('handback requires a nonempty report message of at most 8000 characters; save detailed artifacts');
  if(role==='slr-reviewer' && (!bound || bound.b.role!=='reviewer' || bound.finalReview?.status!=='awaiting_review'
    || bound.finalReview.submissions.at(-1)?.id!==bound.b.submissionId)) return deny('reviewer requires a current pending submission binding');
  if(role==='slr-reviewer' && enabled(bound.root)) {
    try {if(!stageAccess(bound.root,'reviewer',input.agent_id))return deny('Reviewer requires its active assigned unit');}
    catch(e){return deny(e.message);}
  }
  if(bound?.finalReview?.status==='paused' && (writes.has(tool) || ['Agent','Bash','PowerShell','WebFetch','WebSearch'].includes(tool) || tool.startsWith('mcp__'))) return deny('final review is paused');
  if(role==='slr-worker' && (tool==='WebSearch' || tool==='WebFetch' || tool.startsWith('mcp__'))
    && (!bound || bound.state.stage!=='researching' || !bound.state.leases[bound.b.leaseId]?.active)) return deny('worker retrieval requires an active research lease');
  if(tool==='Read' && args.file_path) {
    if(/\.pdf$/i.test(args.file_path)) {
      const m=/^(\d+)(?:-(\d+))?$/.exec(args.pages??'');
      if(!m || Number(m[1])<1 || Number(m[2]??m[1])<Number(m[1]) || Number(m[2]??m[1])-Number(m[1])>=5)return deny('read PDF in explicit batches of at most five pages');
    } else if(/\.(md|json|tex|bib|log|txt)$/i.test(args.file_path) && fs.existsSync(args.file_path)) {
      const offset=args.offset??1,limit=args.limit??Infinity;
      if(!Number.isInteger(offset)||offset<1||!(limit===Infinity||Number.isInteger(limit)&&limit>0))return deny('invalid Read line range');
      const text=fs.readFileSync(args.file_path,'utf8').split(/\r?\n/).slice(offset-1,offset-1+limit).join('\n');
      if(text.length>24000)return deny('text read exceeds 24000 characters; use smaller line ranges or ask main for bounded character slices');
    }
  }
  if(tool.startsWith('mcp__')) {
    const method=tool.split('__').at(-1);
    return ['slr-worker','slr-scoper','slr-reviewer'].includes(role) && /^(search|search_papers|search_arxiv|arxiv_search|fetch|fetch_paper|read_paper|get_paper|paper_details)$/.test(method)
      ?allow():deny('only explicit read-only scholarly retrieval MCP methods are permitted');
  }
  if(!new Set(['Read','Glob','Grep','ToolSearch','Write','Edit','MultiEdit','NotebookEdit','Bash','PowerShell','Agent','SendMessage','Skill','WebSearch','WebFetch']).has(tool)) return deny('tool outside role contract');
  if(tool==='Agent') {
    if(role!=='slr-manager') return deny('only topic managers may delegate workers');
    if(!bound || bound.b.role!=='manager' || bound.state.schemaVersion!==2 || bound.state.stage!=='researching') return deny('manager must have an active workspace binding');
    if(shortName(args.subagent_type)!=='slr-worker') return deny('manager may launch only slr-worker');
    const leases=Object.values(bound.state.leases).filter(l=>l.active && l.topicId===bound.b.topicId);
    if(args.resume) return leases.some(l=>l.agentId===args.resume)?allow():deny('worker resume is not allocated to this manager');
    const leaseId=/\bSLR_LEASE=([a-zA-Z0-9_-]+)\b/.exec(args.prompt ?? '')?.[1];
    if(!leases.some(l=>l.id===leaseId && !l.agentId && !l.launchClaimed)) return deny('include one unused allocated SLR_LEASE token in the initialization prompt');
    try { mutate(bound.root,'claim-launch',{leaseId,managerId:input.agent_id}); return allow(); }
    catch(error) { return deny(error.message); }
  }
  if(tool==='SendMessage') {
    const id=args.to??args.recipient;
    return role==='slr-manager' && bound?.b.role==='manager' && Object.values(bound.state.leases).some(l=>l.active&&l.topicId===bound.b.topicId&&l.agentId===id)
      ?allow():deny('Manager may message only its active bound Worker');
  }
  if(tool==='Skill') return deny('delegated roles cannot invoke skills');
  if(tool==='Bash' || tool==='PowerShell') {
    if(role==='slr-worker' || role==='slr-scoper' || role==='slr-reviewer') {
      if(role==='slr-worker' && (!bound || !bound.state.leases[bound.b.leaseId]?.active)) return deny('worker needs an active lease');
      return evaluatePaperSearchShell(args.command);
    }
    if(role==='slr-manager' && bound?.b.role==='manager') {
      const command=args.command;
      if(typeof command!=='string' || /[;&|`$<>\r\n]/.test(command)) return deny('unsafe manager command');
      const tokens=tokenize(command);
      if(tokens?.length===5 && tokens[0]==='node' && path.resolve(tokens[1])===path.join(path.dirname(pipeline),'manager-control.mjs')
        && path.resolve(tokens[2])===bound.root && tokens[3]===input.agent_id) {
        try {managerRequest(bound.root,input.agent_id,tokens[4]);return allow();}catch(e){return deny(e.message);}
      }
      if(tokens?.length===6 && tokens[0]==='node' && path.resolve(tokens[1])===pipeline && tokens[2]==='bind-worker'
        && path.resolve(tokens[3])===bound.root) {
        const lease=bound.state.leases[tokens[4]];
        return lease?.active && !lease.agentId && lease.topicId===bound.b.topicId && /^[a-zA-Z0-9_-]+$/.test(tokens[5])
          ?allow():deny('worker binding outside allocated topic/lease');
      }
    }
    return deny('no shell access except read-only paper-search or manager bind-worker helper');
  }
  if(['slr-manager','slr-checker','slr-paper-writer'].includes(role)
    && (tool==='WebSearch' || tool==='WebFetch' || tool.startsWith('mcp__'))) return deny('this role does not retrieve new evidence');
  if(!writes.has(tool)) return allow();
  if(role==='slr-scoper' || role==='slr-checker') return deny('role is read-only');
  if(!bound) return deny('missing runtime agent_id binding; initialize READY agent, bind, then resume');
  const expected={'slr-manager':'manager','slr-worker':'worker','slr-paper-writer':'paper','slr-reviewer':'reviewer'}[role];
  if(bound.b.role!==expected) return deny('binding role mismatch');
  const {root,state,b}=bound;
  const targets=[args.file_path,args.path,args.notebook_path,...(args.edits??[]).flatMap(e=>[e.file_path,e.path])].filter(x=>typeof x==='string');
  if(!targets.length) return deny('no target path');
  let allowed=[];
  if(role==='slr-reviewer') {
    if(!enabled(root))return deny('Reviewer is read-only outside staged workflow');
    let artifact;try{artifact=stageAccess(root,'reviewer',input.agent_id);}catch(e){return deny(e.message);}
    if(!artifact)return deny('no active Reviewer unit');
    allowed=[artifact];
  } else if(role==='slr-paper-writer') {
    if(enabled(root)) {
      try {if(!stageAccess(root,'paper',input.agent_id))return deny('no current active writer phase');}catch(e){return deny(e.message);}
    }
    if(!['completed','completed_with_limitations'].includes(state.stage)) return deny('paper requires terminal research');
    if(state.schemaVersion===1) {
      const updates=path.join(root,'.slr/updates');
      if(fs.existsSync(updates)) for(const id of fs.readdirSync(updates)) {
        try { if(!['completed','completed_with_limitations'].includes(JSON.parse(fs.readFileSync(path.join(updates,id,'state.json'),'utf8')).stage)) return deny('unfinished legacy update'); }
        catch { return deny('invalid legacy update'); }
      }
    }
    allowed=['paper/main.tex','paper/references.bib',...(enabled(root)?['paper/writing-handoff.md']:[])];
  } else {
    if(state.schemaVersion!==2 || state.stage!=='researching') return deny('research writes require active v2 state');
    if(role==='slr-manager') {
      const t=state.topics.find(t=>t.id===b.topicId);
      if(state.revisionContext?.active && !state.revisionContext.topicIds.includes(b.topicId)) return deny('topic outside assigned revision');
      if(!t || t.status==='completed') return deny('topic is absent or already accepted');
      const requestPrefix=`topics/${t.id}/requests/`;
      for(const target of targets) {
        const rel=path.relative(root,path.resolve(target)).split(path.sep).join('/');
        if(rel.startsWith(requestPrefix) && /^[a-zA-Z0-9_-]+\.json$/.test(rel.slice(requestPrefix.length)) && enabled(root))allowed.push(rel);
      }
      allowed.push(`topics/${t.id}/plan.json`,`topics/${t.id}/chapter.md`,`topics/${t.id}/synthesis.md`,`topics/${t.id}/acceptance.json`);
    } else {
      const l=state.leases[b.leaseId];
      if(!l?.active || l.agentId!==input.agent_id) return deny('worker lease inactive');
      const prefix=`topics/${l.topicId}/tasks/${l.taskId}`;
      allowed=[`${prefix}/search.md`,`${prefix}/candidates.json`,`${prefix}/result.json`];
      if(l.phase==='read') for(const p of Object.values(state.papers)) if(p.owner.topicId===l.topicId && p.owner.taskId===l.taskId && p.status!=='final') allowed.push(`papers/${p.id}/metadata.json`,`papers/${p.id}/note.md`);
    }
  }
  for(const target of targets) {
    if(!path.isAbsolute(target)) return deny('write paths must be absolute');
    const file=path.resolve(target);
    if(!noLinks(root,file)) return deny('outside workspace or symbolic link target');
    const relative=path.relative(root,file).split(path.sep).join('/');
    if(!allowed.includes(relative)) return deny('target is outside this runtime assignment');
  }
  return allow();
}

if(process.argv[1] && path.resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()) {
  let text=''; for await(const chunk of process.stdin) text+=chunk;
  try { const result=evaluateHook(JSON.parse(text)); if(!result.allowed) { console.error(result.reason); process.exitCode=2; } }
  catch(error) { console.error(error.message); process.exitCode=2; }
}
