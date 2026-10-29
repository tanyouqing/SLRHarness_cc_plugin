export async function connect() {
  const token=process.env.SURVEY_KB_TOKEN;
  if(!token)throw Object.assign(new Error('SURVEY_KB_TOKEN is missing'),{permanent:true});
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
  const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client=new Client({name:'survey-pipeline-sync',version:'0.9.2'});
  const transport=new StreamableHTTPClientTransport(new URL(process.env.SURVEY_KB_URL??'http://127.0.0.1:3000/mcp'),{requestInit:{headers:{Authorization:`Bearer ${token}`}}});
  let timer;
  try {await Promise.race([client.connect(transport),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('KB connection timed out')),20000);})]);}
  catch(e){await client.close().catch(()=>{});throw e;}finally{clearTimeout(timer);}
  return {async call(name,args){
    const result=await client.callTool({name,arguments:args},undefined,{timeout:20000,resetTimeoutOnProgress:false});
    if(result.isError) {
      const text=result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')??'';
      throw Object.assign(new Error('KB tool rejected request; inspect service and input'),{permanent:/Invalid input|Unrecognized key|Too big|Too small|invalid JSON|line \d|event range|source .*required|trajectory .*conflict|trajectory .*mismatch|trajectory .*invalid|trajectory .*exceeds/i.test(text)});
    }
    return result.structuredContent??JSON.parse(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
  },close:()=>client.close()};
}
