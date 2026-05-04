import { getStore } from '../db.js';

/**
 * Persists and resolves Crewden agent <-> Paseo runtime instance mappings.
 *
 * Phase 1 usage:
 * - bind() after createAgent on Paseo succeeds
 * - resolveCrewdenAgentId() for stream/event callbacks by runtimeInstanceId
 * - clear() on stop/delete or stale mapping cleanup
 */
export class RuntimeInstanceMapper {
  async bind(crewdenAgentId: string, runtimeInstanceId: string): Promise<void> {
    await getStore().setAgentRuntimeInstanceId(crewdenAgentId, runtimeInstanceId);
  }

  async resolveRuntimeInstanceId(crewdenAgentId: string): Promise<string | undefined> {
    const agent = await getStore().getAgent(crewdenAgentId);
    return agent?.runtimeInstanceId;
  }

  async resolveCrewdenAgentId(runtimeInstanceId: string): Promise<string | undefined> {
    const agent = await getStore().getAgentByRuntimeInstanceId(runtimeInstanceId);
    return agent?.id;
  }

  async clear(crewdenAgentId: string): Promise<void> {
    await getStore().clearAgentRuntimeInstanceId(crewdenAgentId);
  }
}
