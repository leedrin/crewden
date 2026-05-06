import type { AgentPermissions } from '@crewden/shared';
import { getStore } from './db.js';

export type AgentPermissionKey =
  | 'createDocs'
  | 'createTasks'
  | 'claimTasks'
  | 'createBranches'
  | 'createPrs'
  | 'mergeToMain'
  | 'deployToProd'
  | 'accessSensitiveData';

export async function requireAgentPermission(agentId: string, permission: AgentPermissionKey): Promise<boolean> {
  const permissions = await getStore().getAgentPermissions(agentId);
  return Boolean(permissions[permission]);
}

export async function canAgentWriteChannel(agentId: string, channelId: string): Promise<boolean> {
  const permissions = await getStore().getAgentPermissions(agentId);
  return channelAllowed(permissions, 'writeChannels', channelId);
}

export async function canAgentReadChannel(agentId: string, channelId: string): Promise<boolean> {
  const permissions = await getStore().getAgentPermissions(agentId);
  return channelAllowed(permissions, 'readChannels', channelId);
}

function channelAllowed(permissions: AgentPermissions, key: 'readChannels' | 'writeChannels', channelId: string): boolean {
  const channels = permissions[key];
  if (!channels || channels.length === 0) return true;
  return channels.includes(channelId);
}
