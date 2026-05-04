import type { Agent, AgentDelivery } from '@crewden/shared';
import { toRuntimeConfig } from '@crewden/hub-core';
import { daemonRegistry } from '../daemonRegistry.js';

export type DeliverToAgentParams = {
  target: Agent;
  seq: number;
  channelId: string;
  message: AgentDelivery;
  inboxSummary?: string;
};

/**
 * Runtime delivery seam used by route handlers.
 *
 * Current implementation still routes through legacy daemonRegistry.
 * This function exists so callers can stop depending on transport details
 * before switching to Paseo runtime in later phases.
 */
export function deliverToAgent(params: DeliverToAgentParams): boolean {
  const { target, seq, channelId, message, inboxSummary } = params;
  if (!target.machineId || target.status === 'inactive') return false;

  return daemonRegistry.send(target.machineId, {
    type: 'agent:deliver',
    agentId: target.id,
    seq,
    channelId,
    config: toRuntimeConfig(target),
    message,
    inboxSummary,
  });
}
