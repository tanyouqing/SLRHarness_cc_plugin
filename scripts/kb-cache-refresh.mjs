import {rememberStrategies} from './kb-core.mjs';
export const isStrategy=e=>e.method==='search_strategies'||e.method==='read'&&e.args.type==='experience';
// This is used at each cache injection, including bounded continuation reads.
export async function refreshStrategyEntry(root,entry,{transport}={}) {
  if(!isStrategy(entry))return entry;
  let client=transport;
  try {
    client??=await (await import('./kb-transport.mjs')).connect();
    const check=async row=>{
      const current=await client.call('read',{type:'experience',id:row.id});
      if(current.id!==row.id||current.strategy_status!=='active'||current.content?.role!==entry.scope.role||current.revision!==current.current_revision)return null;
      return current;
    };
    const next=structuredClone(entry);
    if(entry.method==='read') {
      const current=await check(entry.result);if(!current)return {...next,result:{unavailable:true,reason:'Strategy is no longer active; skip this cached material'}};
      next.args.revision=current.revision;next.result=current;
    } else {
      const rows=await Promise.all(entry.result.results.map(async row=>{
        const c=await check(row);if(!c)return null;
        return {...row,revision:c.revision,status:'active',status_version:c.status_version,role:c.content.role,stage:c.content.stage,
          task:c.content.task,applicability:c.content.applicability,snippet:c.content.strategy,sources:c.sources};
      }));
      next.result.results=rows.filter(Boolean);
    }
    rememberStrategies(root,next);return next;
  }catch{return {...entry,result:entry.method==='search_strategies'?{results:[],unavailable:true,reason:'Cannot verify current strategy state; continue without cached strategies'}:{unavailable:true,reason:'Cannot verify current strategy state; skip cached material'}};}
  finally{if(client&&!transport)await client.close().catch(()=>{});}
}
