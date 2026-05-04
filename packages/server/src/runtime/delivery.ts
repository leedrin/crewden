import type { Agent, AgentDelivery } from '@crewden/shared';
import { paseoRuntimeService } from './paseo-runtime-service.js';

export type DeliverToAgentParams = {
  target: Agent;
  seq: number;
  channelId: string;
  message: AgentDelivery;
  inboxSummary?: string;
};

/**
 * Runtime delivery seam used by route handlers.
 */
export async function deliverToAgent(params: DeliverToAgentParams): Promise<boolean> {
  const { target, seq, channelId, message, inboxSummary } = params;
  if (target.status === 'inactive') return false;
  return paseoRuntimeService.deliverMessage({
    target,
    seq,
    channelId,
    message,
    inboxSummary,
  });
}
