import {pool,transaction} from './db.js';
import {lockJob,type Job} from './store.js';
import {prepare,queryVector,vectorSql,preparedSchema} from './embedding.js';
import {keywords,searchText,fuse} from './domain.js';
import {config} from './config.js';
import type {Draft} from './agents.js';


const scope=`FROM distillation_candidate_chunks c
    JOIN distillation_candidate_indexes i USING(job_id,candidate_id,content_version,model_version)
    JOIN jsonb_to_recordset($2::jsonb) AS active(id text,version text)
      ON active.id=c.candidate_id AND active.version=c.content_version
    WHERE c.job_id=$1 AND i.role=$3 AND c.model_version=$4`;
export const consolidationQueries={lexical:`WITH q AS (SELECT to_tsquery('simple',string_agg('(' || term_query::text || ')',' | ')) AS query
      FROM (SELECT DISTINCT plainto_tsquery('simple',term) AS term_query FROM unnest(string_to_array($6::text,' ')) term) terms
      WHERE term_query::text<>'')
      SELECT c.candidate_id AS id,c.candidate_id AS entity_id,max(ts_rank_cd(c.keywords,(SELECT query FROM q))) AS rank
      ${scope} AND $5::vector IS NOT NULL AND c.keywords @@ (SELECT query FROM q)
      GROUP BY c.candidate_id ORDER BY rank DESC,c.candidate_id LIMIT 20`,dense:`SELECT c.candidate_id AS id,c.candidate_id AS entity_id,min(c.embedding <=> $5::vector) AS distance
      ${scope} AND $6::text IS NOT NULL GROUP BY c.candidate_id ORDER BY distance,c.candidate_id LIMIT 20`};

// Checkpoint items are authoritative. Historical vector versions remain private
// and can only be searched when that exact ID/version is still in the checkpoint.
export async function ensureIndexes(job:Job,drafts:Draft[],modelVersion?:string):Promise<string|undefined> {
  let version=modelVersion;
  for(const draft of drafts) {
    if(version && (await pool.query(`SELECT 1 FROM distillation_candidate_indexes
      WHERE job_id=$1 AND candidate_id=$2 AND content_version=$3 AND model_version=$4 AND role=$5`,
      [job.id,draft.candidateId,draft.version,version,draft.experience.role])).rowCount)continue;
    const encoded=preparedSchema.parse(await prepare('experience',draft.experience));
    if(version && encoded.model_version!==version)throw new Error('consolidation embedding model version changed; explicit index recovery required');
    version=encoded.model_version;
    await transaction(async db=>{
      await lockJob(db,job);
      const inserted=await db.query(`INSERT INTO distillation_candidate_indexes(job_id,candidate_id,content_version,role,model_version)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING candidate_id`,
        [job.id,draft.candidateId,draft.version,draft.experience.role,version]);
      if(!inserted.rowCount)return;
      for(const [ordinal,chunk] of encoded.chunks.entries())await db.query(`INSERT INTO distillation_candidate_chunks
        (job_id,candidate_id,content_version,model_version,ordinal,keywords,embedding)
        VALUES($1,$2,$3,$4,$5,to_tsvector('simple',$6),$7::vector)`,
        [job.id,draft.candidateId,draft.version,version,ordinal,keywords(chunk.text),vectorSql(chunk.embedding)]);
    });
  }
  return version;
}

export async function retrieveCandidates(job:Job,current:Draft,items:Draft[],modelVersion?:string) {
  const text=Array.from(searchText('experience',current.experience)).slice(0,8000).join('');
  const query=await queryVector(text);
  if(modelVersion && query.model_version!==modelVersion)throw new Error('consolidation embedding model version changed; explicit index recovery required');
  await ensureIndexes(job,items,query.model_version);
  if(!items.length)return {targets:[],modelVersion:query.model_version};
  const args=[job.id,JSON.stringify(items.map(d=>({id:d.candidateId,version:d.version}))),current.experience.role,
    query.model_version,vectorSql(query.embedding),keywords(text)];
  const [lexical,dense]=await Promise.all([
    pool.query(consolidationQueries.lexical,args),pool.query(consolidationQueries.dense,args),
  ]);
  const byId=new Map(items.map(d=>[d.candidateId,d]));
  const targets=fuse(lexical.rows,dense.rows,config.consolidationTopK).map(row=>{
    const draft=byId.get(row.entity_id);if(!draft)throw new Error('retrieved candidate outside checkpoint');return draft;
  });
  return {targets,modelVersion:query.model_version};
}
