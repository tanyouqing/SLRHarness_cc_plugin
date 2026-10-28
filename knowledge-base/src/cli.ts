import { readFile } from 'node:fs/promises';
import { connectClient,call,waitJob } from './client.js';
const [name,input]=process.argv.slice(2);
if(!name)throw new Error('Usage: npm run client -- <list|tool|wait> [@args.json|JSON|job-id]');
const client=await connectClient();
try {
  const result=name==='list'?await client.listTools():name==='wait'?await waitJob(client,input):await call(client,name,input?JSON.parse(input.startsWith('@')?await readFile(input.slice(1),'utf8'):input):{});
  console.log(JSON.stringify(result,null,2));
} finally {await client.close();}
