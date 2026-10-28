import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { pool } from './db.js';
import { createMcp } from './mcp.js';
if(config.token.length<32)throw new Error('MCP_TOKEN must contain at least 32 characters');
const app=express();
app.disable('x-powered-by');
app.get('/healthz',(_req,res)=>res.json({alive:true}));
app.get('/readyz',async(_req,res)=>{
  try {
    await pool.query('SELECT name FROM schema_migrations LIMIT 1');
    const response=await fetch(config.embeddingUrl+'/healthz',{signal:AbortSignal.timeout(5000)});
    if(!response.ok || !(await response.json() as any).ready)throw new Error('embedding unavailable');
    res.json({ready:true});
  } catch {res.status(503).json({ready:false});}
});
app.use('/mcp',(req,res,next)=>{
  const expected=Buffer.from(`Bearer ${config.token}`),actual=Buffer.from(req.headers.authorization??'');
  if(expected.length!==actual.length || !timingSafeEqual(expected,actual)){res.status(401).json({error:'unauthorized'});return;}
  // Browser origins are not supported in this server-to-server v1.
  if(req.headers.origin){res.status(403).json({error:'browser origin not allowed'});return;}
  next();
},express.json({limit:config.bodyLimit}));
app.post('/mcp',async(req,res)=>{
  const server=createMcp();
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{void server.close();});
  try {await server.connect(transport);await transport.handleRequest(req,res,req.body);}
  catch {if(!res.headersSent)res.status(500).json({error:'MCP transport failed'});}
});
app.all('/mcp',(_req,res)=>res.status(405).json({error:'use POST'}));
app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  res.status(err.type==='entity.too.large'?413:400).json({error:err.type==='entity.too.large'?'request exceeds MAX_REQUEST_BYTES':'invalid request body'});
});
const listener=app.listen(config.port,'0.0.0.0',()=>console.log(JSON.stringify({event:'mcp_ready',port:config.port})));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>listener.close(()=>{void pool.end();}));
