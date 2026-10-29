// Persist this on job creation. Missing versions belong to pre-upgrade jobs.
export const currentPolicy = 'selective-v2';
export const legacyPolicy = 'legacy-v1';
export type Policy = typeof currentPolicy | typeof legacyPolicy;
export function policyOf(payload:any):Policy {
  const version=payload?.policyVersion??legacyPolicy;
  if(version!==currentPolicy && version!==legacyPolicy)throw new Error('unsupported distillation policy version');
  return version;
}
