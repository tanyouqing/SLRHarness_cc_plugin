import { trajectoryInput } from './trajectory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { paperSchema, experienceInput, paperSearch, strategySearch, readSchema, normalizeDoi } from './domain.js';
import * as store from './store.js';
export type Service = Pick<typeof store,'submit'|'submitTrajectory'|'search'|'read'|'getJob'>;
export function createMcp(service:Service=store) {
  const server=new McpServer({name:'survey-knowledge-base',version:'0.1.0'});
  const register=(name:string,description:string,schema:z.ZodTypeAny,fn:(args:any)=>Promise<unknown>)=>{
    server.registerTool(name,{description,inputSchema:schema as any},async(args:any)=>{
      try {const result=await fn(schema.parse(args));return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result as Record<string,unknown>};}
      catch(error) {
        const message=error instanceof z.ZodError ? error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ') : error instanceof Error ? error.message : 'request failed';
        // Avoid leaking database diagnostics and provider internals across the public boundary.
        const safe=/^(record not found|job not found|source |event range|invalid JSON|line \d|trajectory |embedding )/.test(message) || error instanceof z.ZodError ? message : 'request failed; inspect service status and job result';
        return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:safe})}]};
      }
    });
  };
  register('submit_paper','Submit metadata and Markdown notes; no PDF.',paperSchema,async input=>{
    input.metadata.doi=normalizeDoi(input.metadata.doi);
    if(input.metadata.arxivId)input.metadata.arxivId=input.metadata.arxivId.trim().replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i,'').replace(/^arxiv:\s*/i,'').replace(/\.pdf$/i,'');
    return service.submit('paper',input);
  });
  register('submit_experience','Submit experience to deduplication. Required: sourceType, role (worker/manager/scoper/paper, the applicable role), executionSummary, strategy. Optional: stage, task, applicability; omit unknown fields. Trajectory-derived experience must reference stored sources.',experienceInput,input=>service.submit('experience',input.experience,input.sources));
  register('submit_trajectory','Persist one JSONL trajectory and automatically enqueue distillation; stored does not mean distilled.',trajectoryInput,input=>service.submitTrajectory(input.content,input.metadata,input.transfer));
  register('search_papers','Hybrid paper search. Filters: year_from/year_to, exact author/venue, normalized doi/arxivId.',paperSearch,async input=>({results:await service.search('paper',input.query,input.filters,input.limit)}));
  register('search_strategies','Hybrid strategy search with role/stage/sourceType filters. A stage filter also includes experiences with no stage; judge applicability from content.',strategySearch,async input=>({results:await service.search('experience',input.query,input.filters,input.limit)}));
  register('read','Read a paper/experience revision or trajectory. Event ranges use one-based JSONL lines.',readSchema,input=>service.read(input.type,input.id,input.revision,input.event_range));
  register('get_job','Read queued/running/succeeded/failed task status and final IDs or failure reason.',z.object({job_id:z.string().uuid()}).strict(),input=>service.getJob(input.job_id));
  return server;
}
