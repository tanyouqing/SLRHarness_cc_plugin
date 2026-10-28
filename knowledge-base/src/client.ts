import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
export async function connectClient() {
  const token=process.env.MCP_TOKEN;
  if(!token)throw new Error('MCP_TOKEN is required');
  const client=new Client({name:'kb-command-client',version:'0.1.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL??'http://localhost:3000/mcp'),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
  return client;
}
export async function call(client:Client,name:string,args:Record<string,unknown>):Promise<any> {
  const result=await client.callTool({name,arguments:args},undefined,{timeout:600_000});
  const text=(result.content as any[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  if(result.isError)throw new Error(text);
  return result.structuredContent ?? JSON.parse(text);
}
export async function waitJob(client:Client,id:string,timeoutMs=1800_000) {
  const end=Date.now()+timeoutMs;
  while(Date.now()<end) {
    const job=await call(client,'get_job',{job_id:id});
    if(job.status==='succeeded')return job.result;
    if(job.status==='failed')throw new Error(`job ${id} failed: ${job.error}`);
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw new Error(`job ${id} timed out; query get_job later`);
}
