import { experienceRoles, type Experience } from './domain.js';

export type ExecutionRole = Experience['role'];
export function sourceRole(origins: any[]): ExecutionRole {
  if (!origins.length || origins.some(o => !o || !experienceRoles.includes(o.agentRole)))
    throw new Error('trajectory identity missing or unsupported');
  const roles = new Set(origins.map(o => o.agentRole));
  if (roles.size !== 1) throw new Error('trajectory source role conflict');
  return origins[0].agentRole;
}
export function assertExperienceRole(experience: Experience, role: ExecutionRole) {
  if (experience.sourceType !== 'trajectory' || experience.role !== role)
    throw new Error('trajectory experience role must equal source agentRole');
}
