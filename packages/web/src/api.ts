import { getEffectiveAuthToken } from './auth.js';

export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
export const WEB_VERSION = (import.meta.env.VITE_APP_VERSION ?? '2.0.0').trim();
export const WEB_COMMIT_SHA = (import.meta.env.VITE_COMMIT_SHA ?? '').trim();

export type Channel = { id: string; name: string; createdAt: string };
export type Mention = { type: 'agent' | 'user'; id: string; label: string };
export type ActorType = 'human' | 'agent' | 'system';
export type Actor = { actorType: ActorType; actorId: string };
export type Message = { id: string; channelId: string; senderName: string; content: string; actorType: ActorType; actorId: string; agentId?: string; threadRootId?: string; replyCount?: number; latestReplyAt?: string; mentions?: Mention[]; createdAt: string };
export type MessageThread = { root: Message; replies: Message[] };
export type SearchMessageResult = Message & { channelName: string };
export type AgentOrganization = { department?: string; roles?: string[]; capabilities?: string[]; responsibilities?: string[]; managerId?: string; backupAgentIds?: string[]; availability?: 'available' | 'unavailable' | 'overloaded' };
export type Agent = { id: string; name: string; displayName?: string; description?: string; runtime: string; model?: string; systemPrompt?: string; envVars?: Record<string, string>; organization?: AgentOrganization; status: string; machineId?: string; autoStart?: boolean; createdAt: string };
export type AgentActivity = { id: string; agentId: string; type: 'thinking' | 'working' | 'output' | 'idle' | 'sending' | 'error'; detail?: string; createdAt: string };
export type DirectMessage = { id: string; fromAgentId: string; toAgentId: string; content: string; createdAt: string };
export type DirectMessageThread = { otherAgentId: string; lastMessage: DirectMessage };
export type WorkspaceFile = { name: string; type: 'file' | 'dir'; size?: number; modifiedAt?: string };
export type WorkspaceEntry =
  | { type: 'dir'; path: string; children: WorkspaceFile[] }
  | { type: 'file'; path: string; content: string; truncated?: boolean; binary?: boolean };
export type AgentDelegation = { id: string; fromAgentId: string; toAgentId: string; content: string; status: 'queued' | 'delivered' | 'started' | 'failed'; error?: string; createdAt: string };
export type Machine = { id: string; hostname: string; os: string; runtimes: string[]; status: string; connectedAt: string };
export type RuntimeStatus = {
  mode: 'paseo-daemon';
  configuredMode: 'paseo-daemon';
  connected: boolean;
  fallbackReason?: string;
  daemonUrl?: string;
  mcpBridgeBin?: string;
  mcpBridgeReady?: boolean;
  diagnostics?: string[];
  alerts?: string[];
  agentHealth?: Array<{
    id: string;
    name: string;
    status: string;
    runtimeInstanceId?: string;
    runtimeLifecycle?: string;
    pendingPermissions: Array<{
      id: string;
      name: string;
      kind: 'tool' | 'plan' | 'question' | 'mode' | 'other';
      title?: string;
      description?: string;
      actions?: Array<{
        id: string;
        label: string;
        behavior: 'allow' | 'deny';
        variant?: 'primary' | 'secondary' | 'danger';
        intent?: 'implement' | 'implement_resume' | 'dismiss';
      }>;
    }>;
    issues: string[];
    lastActivityAt?: string;
  }>;
};
export type VersionInfo = { component: string; version: string; commit?: string; build?: string };
export type TaskStatus = 'backlog' | 'spec_needed' | 'ready' | 'assigned' | 'in_progress' | 'in_review' | 'changes_requested' | 'qa' | 'done' | 'cancelled';
export type TaskType = 'feature' | 'bug' | 'ops' | 'research' | 'review' | 'handoff';
export type GoalBriefStatus = 'draft' | 'confirmed' | 'cancelled' | 'completed';
export type GoalAlignmentStatus = 'needs_clarification' | 'awaiting_confirmation' | 'confirmed' | 'cancelled';
export type GoalAlignmentRiskLevel = 'low' | 'medium' | 'high';
export type TaskProgressEvent = { id: string; taskId: string; agentId: string; type: 'claimed' | 'started' | 'heartbeat' | 'blocked' | 'handoff' | 'completed' | 'escalated'; detail: string; createdAt: string };
export type TaskReview = { id: string; taskId: string; requesterAgentId?: string; reviewerAgentId?: string; status: 'requested' | 'changes_requested' | 'approved' | 'cancelled'; evidence: string[]; checklist: Array<{ label: string; checked: boolean }>; comment?: string; createdAt: string; updatedAt: string };
export type TaskContext = { goalId?: string; goalObjective?: string; goal?: string; background?: string; acceptanceCriteria?: string[]; constraints?: string[]; assumptions?: string[]; risks?: string[]; dependencies?: string[]; blockedByTaskIds?: string[]; sourceMessageIds?: string[]; artifacts?: string[]; requesterAgentId?: string; previousAgentId?: string; handoffNotes?: string[]; privateNotes?: string[]; claimedByAgentId?: string; blockedReason?: string; blockedNeeds?: string; escalatedReason?: string; progressEvents?: TaskProgressEvent[]; reviewerAgentId?: string; evidence?: string[]; acceptanceChecklist?: string[]; reviewIds?: string[]; reviewNotes?: string[]; reviews?: TaskReview[] };
export type Task = {
  id: string;
  channelId: string;
  messageId?: string;
  title: string;
  status: TaskStatus;
  type: TaskType;
  creatorName: string;
  creator: Actor;
  assigneeId?: string;
  owner?: Actor;
  reviewer?: Actor;
  acceptanceCriteria?: string[];
  definitionOfDone?: string[];
  constraints?: string[];
  dependsOn?: string[];
  isBlocked: boolean;
  blockedReason?: string;
  sourceChannelId?: string;
  sourceThreadId?: string;
  context?: TaskContext;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type GoalBrief = { id: string; channelId: string; sourceMessageId?: string; requesterName: string; objective: string; background: string[]; successCriteria: string[]; constraints: string[]; assumptions: string[]; risks: string[]; status: GoalBriefStatus; createdAt: string; updatedAt: string };
export type GoalAlignmentTaskDraft = { title: string; assigneeId?: string; dependencies?: string[]; acceptanceCriteria?: string[]; artifacts?: string[]; role?: 'owner' | 'reviewer' | 'support' };
export type GoalAlignment = { id: string; channelId: string; threadRootId: string; sourceMessageId: string; goalId?: string; status: GoalAlignmentStatus; objective: string; questions: string[]; answers: string[]; successCriteria: string[]; constraints: string[]; planSummary?: string; taskDrafts: GoalAlignmentTaskDraft[]; recommendedAgentIds: string[]; reviewerAgentIds: string[]; recommendationReasons: Record<string, string>; gaps: string[]; riskLevel: GoalAlignmentRiskLevel; createdAt: string; updatedAt: string };
export type ReminderStatus = 'pending' | 'triggered' | 'cancelled';
export type Reminder = { id: string; agentId: string; channelId: string; message: string; triggerAt: string; status: ReminderStatus; createdAt: string };
export type AuthWhoami = { authenticated: boolean; mode: 'token' | 'anonymous' };
export type AgentInboxItem = { id: string; kind: 'mention' | 'dm' | 'assigned_task' | 'claimable_task' | 'reminder' | 'review_request' | 'blocked_escalation'; agentId: string; channelId?: string; messageId?: string; taskId?: string; goalId?: string; priority: 'low' | 'normal' | 'high' | 'urgent'; summary: string; dueAt?: string; createdAt: string };
export type KnowledgeKind = 'decision' | 'project_archive' | 'user_preference' | 'runbook' | 'learning' | 'artifact';
export type KnowledgeStatus = 'active' | 'stale' | 'conflict' | 'archived';
export type KnowledgeEntry = { id: string; kind: KnowledgeKind; title: string; summary: string; body: string; tags: string[]; sourceRefs: string[]; ownerAgentId?: string; reviewerAgentId?: string; status: KnowledgeStatus; createdAt: string; updatedAt: string };
export type KnowledgeSearchResult = { entry: KnowledgeEntry; score?: number; reason?: string };

export class AuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'AuthError';
  }
}

let authFailureHandler: (() => void) | undefined;

export function setAuthFailureHandler(handler: (() => void) | undefined): void {
  authFailureHandler = handler;
}

export function getCurrentAuthToken(): string {
  return getEffectiveAuthToken();
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const token = getEffectiveAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401) {
    authFailureHandler?.();
    throw new AuthError();
  }
  return response;
}

export async function verifyAuthToken(token = getEffectiveAuthToken()): Promise<AuthWhoami> {
  const headers: Record<string, string> = {};
  if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  const response = await fetch(`${API_BASE}/api/auth/whoami`, { headers });
  if (response.status === 401) throw new AuthError('Invalid token');
  if (!response.ok) throw new Error('Server unavailable');
  return response.json();
}

export function buildWsUrl(path: string): string {
  const base = API_BASE
    ? API_BASE.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
  const url = `${base}${path}`;
  const token = getEffectiveAuthToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export async function getChannels(): Promise<Channel[]> {
  const r = await apiFetch(`${API_BASE}/api/channels`, { headers: authHeaders() });
  return r.json();
}

export async function createChannel(name: string): Promise<Channel> {
  const r = await apiFetch(`${API_BASE}/api/channels`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Create channel failed');
  return r.json();
}

export async function deleteChannel(channelId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/api/channels/${encodeURIComponent(channelId)}`, { method: 'DELETE', headers: authHeaders() });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Delete channel failed');
}

export async function searchMessages(q: string, limit = 20): Promise<{ messages: SearchMessageResult[] }> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  const r = await apiFetch(`${API_BASE}/api/search?${params.toString()}`, { headers: authHeaders() });
  return r.json();
}

export async function getHubVersion(): Promise<VersionInfo> {
  const r = await apiFetch(`${API_BASE}/api/version`, { headers: authHeaders() });
  return r.json();
}

export async function getMessages(channelId: string): Promise<Message[]> {
  const r = await apiFetch(`${API_BASE}/api/channels/${channelId}/messages`, { headers: authHeaders() });
  return r.json();
}

export async function getMessageThread(messageId: string): Promise<MessageThread> {
  const r = await apiFetch(`${API_BASE}/api/messages/${encodeURIComponent(messageId)}/thread`, { headers: authHeaders() });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Load thread failed');
  return r.json();
}

export async function sendMessage(channelId: string, senderName: string, content: string, agentId?: string, threadRootId?: string): Promise<Message> {
  const r = await apiFetch(`${API_BASE}/api/channels/${channelId}/messages`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ senderName, content, agentId, threadRootId }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Send message failed');
  return r.json();
}

export async function getAgents(): Promise<Agent[]> {
  const r = await apiFetch(`${API_BASE}/api/agents`, { headers: authHeaders() });
  return r.json();
}

export async function getAgentActivities(agentId: string): Promise<AgentActivity[]> {
  const r = await apiFetch(`${API_BASE}/api/agents/${agentId}/activities`, { headers: authHeaders() });
  return r.json();
}

export async function getAgentWorkspace(agentId: string, relPath = ''): Promise<WorkspaceEntry> {
  const query = relPath ? `?path=${encodeURIComponent(relPath)}` : '';
  const r = await apiFetch(`${API_BASE}/api/agents/${agentId}/workspace${query}`, { headers: authHeaders() });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error ?? `Workspace request failed (${r.status})`);
  }
  return r.json();
}

export async function createAgent(data: {
  name: string;
  displayName?: string;
  description?: string;
  runtime: string;
  model?: string;
  systemPrompt?: string;
  envVars?: Record<string, string>;
  organization?: AgentOrganization;
  machineId?: string;
}): Promise<Agent> {
  const r = await apiFetch(`${API_BASE}/api/agents`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function patchAgent(agentId: string, data: { runtime?: string; machineId?: string; displayName?: string; description?: string; model?: string; systemPrompt?: string; envVars?: Record<string, string>; organization?: AgentOrganization; autoStart?: boolean }): Promise<Agent> {
  const r = await apiFetch(`${API_BASE}/api/agents/${agentId}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Update agent failed');
  return r.json();
}

export async function deleteAgent(agentId: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/api/agents/${agentId}`, { method: 'DELETE', headers: authHeaders() });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Delete agent failed');
}

export async function getAgentDmThreads(agentId: string): Promise<DirectMessageThread[]> {
  const r = await apiFetch(`${API_BASE}/api/agents/${agentId}/dms`, { headers: authHeaders() });
  return r.json();
}

export async function getAgentDirectMessages(agentId: string, otherId: string): Promise<DirectMessage[]> {
  const r = await apiFetch(`${API_BASE}/api/agents/${agentId}/dms/${encodeURIComponent(otherId)}`, { headers: authHeaders() });
  return r.json();
}

export async function sendAgentDirectMessage(agentId: string, otherId: string, content: string): Promise<DirectMessage> {
  const r = await apiFetch(`${API_BASE}/api/agents/${agentId}/dms/${encodeURIComponent(otherId)}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ content }),
  });
  return r.json();
}

export async function startAgent(agentId: string): Promise<Agent> {
  const r = await apiFetch(`${API_BASE}/api/agents/${agentId}/start`, { method: 'POST', headers: authHeaders() });
  return r.json();
}

export async function stopAgent(agentId: string): Promise<Agent> {
  const r = await apiFetch(`${API_BASE}/api/agents/${agentId}/stop`, { method: 'POST', headers: authHeaders() });
  return r.json();
}

export async function getMachines(): Promise<Machine[]> {
  const r = await apiFetch(`${API_BASE}/api/machines`, { headers: authHeaders() });
  return r.json();
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const r = await apiFetch(`${API_BASE}/api/runtime/status`, { headers: authHeaders() });
  if (!r.ok) throw new Error('Failed to load runtime status');
  return r.json();
}

export async function respondRuntimePermission(
  agentId: string,
  permissionId: string,
  response:
    | {
        behavior: 'allow';
        selectedActionId?: string;
        updatedInput?: Record<string, unknown>;
        updatedPermissions?: Record<string, unknown>[];
      }
    | {
        behavior: 'deny';
        selectedActionId?: string;
        message?: string;
        interrupt?: boolean;
      },
): Promise<void> {
  const r = await apiFetch(
    `${API_BASE}/api/runtime/agents/${encodeURIComponent(agentId)}/permissions/${encodeURIComponent(permissionId)}/respond`,
    {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(response),
    },
  );
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Permission response failed');
}

export async function getTasks(filter: { channelId?: string; status?: TaskStatus } = {}): Promise<Task[]> {
  const params = new URLSearchParams();
  if (filter.channelId) params.set('channelId', filter.channelId);
  if (filter.status) params.set('status', filter.status);
  const query = params.toString() ? `?${params.toString()}` : '';
  const r = await apiFetch(`${API_BASE}/api/tasks${query}`, { headers: authHeaders() });
  return r.json();
}

export async function createTask(data: { channelId?: string; title: string; assigneeId?: string; creatorName?: string; status?: TaskStatus; type?: TaskType; acceptanceCriteria?: string[]; definitionOfDone?: string[]; constraints?: string[]; dependsOn?: string[] }): Promise<Task> {
  const r = await apiFetch(`${API_BASE}/api/tasks`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function patchTask(taskId: string, data: { status?: TaskStatus; assigneeId?: string; expectedVersion?: number; isBlocked?: boolean; blockedReason?: string; dependsOn?: string[] }): Promise<Task> {
  const r = await apiFetch(`${API_BASE}/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function deleteTask(taskId: string): Promise<void> {
  await apiFetch(`${API_BASE}/api/tasks/${taskId}`, { method: 'DELETE', headers: authHeaders() });
}

export async function messageToTask(messageId: string, data: { assigneeId?: string; creatorName?: string } = {}): Promise<Task> {
  const r = await apiFetch(`${API_BASE}/api/messages/${messageId}/to-task`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function messageToGoal(messageId: string, data: { requesterName?: string; objective?: string; background?: string[]; successCriteria?: string[]; constraints?: string[]; assumptions?: string[]; risks?: string[] } = {}): Promise<GoalBrief> {
  const r = await apiFetch(`${API_BASE}/api/messages/${messageId}/to-goal`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Create goal failed');
  return r.json();
}

export async function patchGoal(goalId: string, data: Partial<Pick<GoalBrief, 'objective' | 'background' | 'successCriteria' | 'constraints' | 'assumptions' | 'risks' | 'status'>>): Promise<GoalBrief> {
  const r = await apiFetch(`${API_BASE}/api/goals/${goalId}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Update goal failed');
  return r.json();
}

export async function createGoalTasks(goalId: string, data: { creatorName?: string; tasks: Array<{ title: string; assigneeId?: string; dependencies?: string[]; acceptanceCriteria?: string[]; artifacts?: string[] }> }): Promise<{ tasks: Task[] }> {
  const r = await apiFetch(`${API_BASE}/api/goals/${goalId}/tasks`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Create goal tasks failed');
  return r.json();
}

export async function startGoalAlignment(messageId: string, data: { requesterName?: string; objective?: string } = {}): Promise<GoalAlignment> {
  const r = await apiFetch(`${API_BASE}/api/messages/${messageId}/start-goal-alignment`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Start goal alignment failed');
  return r.json();
}

export async function patchGoalAlignment(alignmentId: string, data: Partial<Pick<GoalAlignment, 'status' | 'objective' | 'questions' | 'answers' | 'successCriteria' | 'constraints' | 'planSummary' | 'taskDrafts' | 'recommendedAgentIds' | 'reviewerAgentIds' | 'recommendationReasons' | 'gaps' | 'riskLevel'>>): Promise<GoalAlignment> {
  const r = await apiFetch(`${API_BASE}/api/goal-alignments/${alignmentId}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Update goal alignment failed');
  return r.json();
}

export async function confirmGoalAlignment(alignmentId: string, data: { requesterName?: string } = {}): Promise<{ alignment: GoalAlignment; goal: GoalBrief; tasks: Task[] }> {
  const r = await apiFetch(`${API_BASE}/api/goal-alignments/${alignmentId}/confirm`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Confirm goal alignment failed');
  return r.json();
}

export async function getAgentReminders(agentId: string): Promise<Reminder[]> {
  const r = await apiFetch(`${API_BASE}/api/agents/${agentId}/reminders`, { headers: authHeaders() });
  return r.json();
}

export async function createAgentReminder(agentId: string, data: { channelId?: string; message: string; triggerAt: string }): Promise<Reminder> {
  const r = await apiFetch(`${API_BASE}/api/agents/${agentId}/reminders`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  return r.json();
}

export async function cancelReminder(reminderId: string): Promise<Reminder> {
  const r = await apiFetch(`${API_BASE}/api/reminders/${reminderId}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status: 'cancelled' }),
  });
  return r.json();
}

export async function searchKnowledge(query = '', filters: { kind?: KnowledgeKind; tag?: string } = {}): Promise<KnowledgeSearchResult[]> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.tag) params.set('tag', filters.tag);
  const r = await apiFetch(`${API_BASE}/api/knowledge${params.toString() ? `?${params.toString()}` : ''}`, { headers: authHeaders() });
  return r.json();
}

export async function createKnowledge(data: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'> & { allowNoSource?: boolean }): Promise<KnowledgeEntry> {
  const r = await apiFetch(`${API_BASE}/api/knowledge`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Create knowledge failed');
  return r.json();
}

export async function patchKnowledge(id: string, data: Partial<Pick<KnowledgeEntry, 'kind' | 'title' | 'summary' | 'body' | 'tags' | 'sourceRefs' | 'ownerAgentId' | 'reviewerAgentId' | 'status'>>): Promise<KnowledgeEntry> {
  const r = await apiFetch(`${API_BASE}/api/knowledge/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Update knowledge failed');
  return r.json();
}
