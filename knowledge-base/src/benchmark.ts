import {performance} from 'node:perf_hooks';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {connectClient,call} from './client.js';
import {prepare} from './embedding.js';
const client=await connectClient();
try {
  await call(client,'search_papers',{query:'retrieval evaluation'});
  const times:number[]=[];
  for(let i=0;i<10;i++){const start=performance.now();await call(client,'search_papers',{query:i%2?'文献检索与实验比较':'retrieval evaluation'});times.push(performance.now()-start);}
  const paper=JSON.parse(await readFile('examples/paper.json','utf8'));
  paper.note+='\n\n'+('Synthetic benchmark paragraph for multilingual retrieval. 多语言文献检索测试。\n\n'.repeat(100));
  const start=performance.now(),encoded=await prepare('paper',paper),seconds=(performance.now()-start)/1000;
  times.sort((a,b)=>a-b);
  const report={time:new Date().toISOString(),query_count:times.length,query_ms:{p50:times[Math.ceil(times.length*.5)-1],p95:times[Math.ceil(times.length*.95)-1]},embedding:{chunks:encoded.chunks.length,seconds,chunks_per_second:encoded.chunks.length/seconds},note:'Measure container memory concurrently using scripts/cloud-benchmark.sh. No hardware performance threshold is assumed.'};
  await mkdir('reports',{recursive:true});await writeFile('reports/benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await client.close();}
