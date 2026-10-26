// Shared storage shape for review experience and future trajectory extraction.
export const EXPERIENCE_ROLES=['paper','manager','scoper','worker'];
export const EXPERIENCE_SOURCE_TYPES=['review','trajectory'];
const required=['sourceType','role','executionSummary','strategy'];
const optional=['stage','task','applicability'];
const nonempty=v=>typeof v==='string' && !!v.trim();
const object=v=>v!==null && typeof v==='object' && !Array.isArray(v);
const need=(ok,message)=>{if(!ok)throw new Error(message);};
export function validateExperiences(value,{sourceType}={}) {
  need(object(value) && Object.keys(value).length===1 && Array.isArray(value.experiences),'expected {experiences: [...]}');
  if(sourceType!==undefined)need(EXPERIENCE_SOURCE_TYPES.includes(sourceType),'invalid expected experience sourceType');
  for(const e of value.experiences) {
    need(object(e) && required.every(k=>Object.hasOwn(e,k)&&nonempty(e[k])),'experience requires sourceType, role, executionSummary and strategy');
    need(EXPERIENCE_SOURCE_TYPES.includes(e.sourceType),'invalid experience sourceType');
    need(sourceType===undefined || e.sourceType===sourceType,'Reviewer experiences must use sourceType review');
    need(EXPERIENCE_ROLES.includes(e.role),'experience role must be paper, manager, scoper or worker');
    need(Object.keys(e).every(k=>required.includes(k)||optional.includes(k)),'unknown experience field');
    need(optional.every(k=>!Object.hasOwn(e,k)||e[k]===null||typeof e[k]==='string'),'optional experience fields must be strings or null');
  }
  return value;
}
