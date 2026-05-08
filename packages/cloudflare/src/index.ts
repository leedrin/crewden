import { DurableObject } from 'cloudflare:workers';
import type {
  Agent,
  AgentActivity,
  AgentDelegation,
  AgentInboxItem,
  BrowserEvent,
  Channel,
  Decision,
  DecisionStatus,
  DaemonToServer,
  DirectMessage,
  DirectMessageThread,
  GoalAlignment,
  GoalAlignmentStatus,
  GoalBrief,
  GoalBriefStatus,
  Document,
  DocumentKind,
  DocumentStatus,
  KnowledgeEntry,
  KnowledgeKind,
  KnowledgeSearchResult,
  KnowledgeStatus,
  Machine,
  Message,
  Mention,
  Reminder,
  ReminderStatus,
  RuntimeId,
  ServerToDaemon,
  Task,
  TaskProgressEventType,
  TaskReview,
  TaskStatus,
  WorkspaceEntry,
  WorkspaceError,
  ActorType,
} from '@crewden/shared';
import {
  createVersionInfo,
  CreateChannelRequestSchema,
  CreateAgentDelegationRequestSchema,
  CreateAgentRequestSchema,
  CreateDirectMessageRequestSchema,
  CreateGoalBriefRequestSchema,
  CreateGoalTasksRequestSchema,
  ConfirmGoalAlignmentRequestSchema,
  CreateDecisionRequestSchema,
  CreateDocumentRequestSchema,
  CreateKnowledgeEntryRequestSchema,
  CreateReminderRequestSchema,
  CreateTaskReviewRequestSchema,
  CreateTaskRequestSchema,
  GoalBriefStatusSchema,
  GoalAlignmentStatusSchema,
  InternalAgentDelegateRequestSchema,
  InternalAgentResolveRequestSchema,
  InternalDmSendRequestSchema,
  InternalGoalCreateRequestSchema,
  InternalGoalCreateTasksRequestSchema,
  InternalGoalListRequestSchema,
  InternalGoalAlignRequestSchema,
  InternalGoalAlignmentPatchRequestSchema,
  InternalInboxRequestSchema,
  InternalMessageReadRequestSchema,
  InternalMessageSendRequestSchema,
  InternalReviewListRequestSchema,
  InternalTaskBlockRequestSchema,
  InternalTaskEscalateRequestSchema,
  InternalTaskHandoffRequestSchema,
  InternalTaskListRequestSchema,
  InternalTaskProgressRequestSchema,
  InternalTaskUpdateRequestSchema,
  CreateMessageRequestSchema,
  MessageToGoalBriefRequestSchema,
  MessageToTaskRequestSchema,
  PatchGoalBriefRequestSchema,
  PatchGoalAlignmentRequestSchema,
  PatchKnowledgeEntryRequestSchema,
  PatchAgentRequestSchema,
  PatchDecisionRequestSchema,
  PatchDocumentRequestSchema,
  PatchReminderRequestSchema,
  PatchTaskRequestSchema,
  ReviewDecisionRequestSchema,
  SearchRequestSchema,
  SearchKnowledgeRequestSchema,
  StartGoalAlignmentRequestSchema,
  DecisionStatusSchema,
  DocumentKindSchema,
  DocumentStatusSchema,
  DecisionTransitionRequestSchema,
  SubmitDocumentReviewRequestSchema,
  ApproveDocumentRequestSchema,
  TaskStatusSchema,
} from '@crewden/shared';
import { buildClarifyingQuestions, buildContextPackage, findDuplicateMachineIds, inferGoalRiskLevel, isAgentActive, isTaskTransitionAllowed, recommendAgentsForGoal, resolveAgentReference, resolveAgents, resolveStartMachineId, toAgentDelivery, toRuntimeConfig } from '@crewden/hub-core';

type SocketAttachment =
  | { kind: 'browser' }
  | { kind: 'daemon'; machineId: string };

type Row = Record<string, string | null>;
type NewMessage = Omit<Message, 'createdAt' | 'actorType' | 'actorId'> & Partial<Pick<Message, 'actorType' | 'actorId'>>;
type NewTask = Omit<Task, 'createdAt' | 'updatedAt' | 'version' | 'type' | 'creator' | 'owner' | 'reviewer' | 'isBlocked'> &
  Partial<Pick<Task, 'type' | 'creator' | 'owner' | 'reviewer' | 'isBlocked'>>;
type TaskPatch = Partial<Pick<Task, 'status' | 'assigneeId' | 'owner' | 'reviewer' | 'acceptanceCriteria' | 'definitionOfDone' | 'constraints' | 'dependsOn' | 'isBlocked' | 'blockedReason' | 'context'>>;
type AuditLog = {
  id: string;
  actorType: ActorType;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  taskId?: string;
  agentId?: string;
  detailJson: Record<string, unknown>;
  createdAt: string;
};

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.HUB.idFromName('central');
    const hub = env.HUB.get(id);
    return hub.fetch(request);
  },
};

export class CrewdenHub extends DurableObject<Env> {
  private workspaceReads = new Map<string, {
    resolve: (result: WorkspaceEntry | WorkspaceError) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.initSchema();
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });
    this.triggerDueReminders();

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/version') {
      return json(createVersionInfo('cloudflare-hub', {
        version: this.env.CREWDEN_VERSION,
        commit: this.env.CREWDEN_COMMIT_SHA,
        build: this.env.CREWDEN_BUILD_ID,
      }));
    }

    if (url.pathname === '/ws') {
      const authResp = await requireBrowserAuthForWs(url, this.env);
      if (authResp) return authResp;
      return this.acceptBrowser(request);
    }
    if (url.pathname === '/daemon/connect') return this.acceptDaemon(request, url);

    if (url.pathname.startsWith('/internal/agent/')) {
      return this.handleInternalAgentRequest(request, url);
    }

    if (url.pathname.startsWith('/api/')) {
      const authResp = await requireBrowserAuth(request, this.env);
      if (authResp) return authResp;
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/auth/whoami') {
        return json({ authenticated: true, mode: 'token' });
      }

      if (request.method === 'GET' && url.pathname === '/api/channels') {
        return json(this.listChannels());
      }

      if (request.method === 'POST' && url.pathname === '/api/channels') {
        return this.createUserChannel(await request.json());
      }

      const channelMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/);
      if (channelMatch && request.method === 'DELETE') {
        return this.deleteUserChannel(decodeURIComponent(channelMatch[1]));
      }

      if (request.method === 'GET' && url.pathname === '/api/search') {
        const parsed = SearchRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
        if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
        return json({ messages: this.searchMessages(parsed.data.q, parsed.data.limit) });
      }

      const messagesMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/messages$/);
      if (messagesMatch && request.method === 'GET') {
        const channel = this.getChannel(messagesMatch[1]);
        if (!channel) return json({ error: 'Channel not found' }, 404);
        return json(this.listMessages(messagesMatch[1]));
      }

      if (messagesMatch && request.method === 'POST') {
        return this.createUserMessage(messagesMatch[1], await request.json());
      }

      const threadMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/thread$/);
      if (threadMatch && request.method === 'GET') {
        const thread = this.getThread(decodeURIComponent(threadMatch[1]));
        if (!thread) return json({ error: 'Message not found' }, 404);
        return json(thread);
      }

      if (request.method === 'GET' && url.pathname === '/api/tasks') {
        const statusValue = url.searchParams.get('status') ?? undefined;
        const status = statusValue === undefined ? undefined : TaskStatusSchema.safeParse(statusValue);
        if (status && !status.success) return json({ error: 'Invalid status' }, 400);
        return json(this.listTasks({
          channelId: url.searchParams.get('channelId') ?? undefined,
          status: status?.success ? status.data : undefined,
        }));
      }

      if (request.method === 'POST' && url.pathname === '/api/tasks') {
        return await this.createUserTask(await request.json());
      }

      const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch && request.method === 'GET') {
        return await this.getSingleTask(decodeURIComponent(taskMatch[1]));
      }
      if (taskMatch && request.method === 'PATCH') {
        return await this.patchTask(decodeURIComponent(taskMatch[1]), await request.json());
      }

      if (taskMatch && request.method === 'DELETE') {
        return this.deleteTask(decodeURIComponent(taskMatch[1]));
      }

      const taskContextPkgMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/context-package$/);
      if (taskContextPkgMatch && request.method === 'POST') {
        return this.regenerateContextPackage(decodeURIComponent(taskContextPkgMatch[1]));
      }

      const taskReviewsMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/reviews$/);
      if (taskReviewsMatch && request.method === 'GET') {
        const task = this.getTask(decodeURIComponent(taskReviewsMatch[1]));
        if (!task) return json({ error: 'Task not found' }, 404);
        return json(task.context?.reviews ?? []);
      }

      if (taskReviewsMatch && request.method === 'POST') {
        return this.createTaskReview(decodeURIComponent(taskReviewsMatch[1]), await request.json());
      }

      const reviewApproveMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/approve$/);
      if (reviewApproveMatch && request.method === 'POST') {
        return this.reviewDecision(decodeURIComponent(reviewApproveMatch[1]), await request.json(), 'approved');
      }

      const reviewChangesMatch = url.pathname.match(/^\/api\/reviews\/([^/]+)\/request-changes$/);
      if (reviewChangesMatch && request.method === 'POST') {
        return this.reviewDecision(decodeURIComponent(reviewChangesMatch[1]), await request.json(), 'changes_requested');
      }

      const messageTaskMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/to-task$/);
      if (messageTaskMatch && request.method === 'POST') {
        return this.createTaskFromMessage(decodeURIComponent(messageTaskMatch[1]), await request.json().catch(() => ({})));
      }

      if (request.method === 'GET' && url.pathname === '/api/goals') {
        const statusValue = url.searchParams.get('status') ?? undefined;
        const status = statusValue === undefined ? undefined : GoalBriefStatusSchema.safeParse(statusValue);
        if (status && !status.success) return json({ error: 'Invalid status' }, 400);
        return json(this.listGoals({
          channelId: url.searchParams.get('channelId') ?? undefined,
          status: status?.success ? status.data : undefined,
        }));
      }

      if (request.method === 'POST' && url.pathname === '/api/goals') {
        return this.createUserGoal(await request.json());
      }

      const goalMatch = url.pathname.match(/^\/api\/goals\/([^/]+)$/);
      if (goalMatch && request.method === 'GET') {
        const goal = this.getGoal(decodeURIComponent(goalMatch[1]));
        if (!goal) return json({ error: 'Goal not found' }, 404);
        return json({ goal, tasks: this.listTasks({ channelId: goal.channelId }).filter((task) => task.context?.goalId === goal.id) });
      }

      if (goalMatch && request.method === 'PATCH') {
        return this.patchGoal(decodeURIComponent(goalMatch[1]), await request.json());
      }

      const goalTasksMatch = url.pathname.match(/^\/api\/goals\/([^/]+)\/tasks$/);
      if (goalTasksMatch && request.method === 'POST') {
        return this.createTasksFromGoal(decodeURIComponent(goalTasksMatch[1]), await request.json());
      }

      const messageGoalMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/to-goal$/);
      if (messageGoalMatch && request.method === 'POST') {
        return this.createGoalFromMessage(decodeURIComponent(messageGoalMatch[1]), await request.json().catch(() => ({})));
      }

      if (request.method === 'GET' && url.pathname === '/api/goal-alignments') {
        const statusValue = url.searchParams.get('status') ?? undefined;
        const status = statusValue === undefined ? undefined : GoalAlignmentStatusSchema.safeParse(statusValue);
        if (status && !status.success) return json({ error: 'Invalid status' }, 400);
        return json(this.listGoalAlignments({
          channelId: url.searchParams.get('channelId') ?? undefined,
          status: status?.success ? status.data : undefined,
        }));
      }

      const messageAlignmentMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/start-goal-alignment$/);
      if (messageAlignmentMatch && request.method === 'POST') {
        return this.startGoalAlignment(decodeURIComponent(messageAlignmentMatch[1]), await request.json().catch(() => ({})));
      }

      const goalAlignmentMatch = url.pathname.match(/^\/api\/goal-alignments\/([^/]+)$/);
      if (goalAlignmentMatch && request.method === 'GET') {
        const alignment = this.getGoalAlignment(decodeURIComponent(goalAlignmentMatch[1]));
        if (!alignment) return json({ error: 'Goal alignment not found' }, 404);
        return json(alignment);
      }

      if (goalAlignmentMatch && request.method === 'PATCH') {
        return this.patchGoalAlignment(decodeURIComponent(goalAlignmentMatch[1]), await request.json());
      }

      const goalAlignmentConfirmMatch = url.pathname.match(/^\/api\/goal-alignments\/([^/]+)\/confirm$/);
      if (goalAlignmentConfirmMatch && request.method === 'POST') {
        return this.confirmGoalAlignment(decodeURIComponent(goalAlignmentConfirmMatch[1]), await request.json().catch(() => ({})));
      }

      const goalAlignmentCancelMatch = url.pathname.match(/^\/api\/goal-alignments\/([^/]+)\/cancel$/);
      if (goalAlignmentCancelMatch && request.method === 'POST') {
        return this.cancelGoalAlignment(decodeURIComponent(goalAlignmentCancelMatch[1]));
      }

      if (request.method === 'GET' && url.pathname === '/api/knowledge') {
        const parsed = SearchKnowledgeRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
        if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
        return json(this.searchKnowledge(parsed.data));
      }

      if (request.method === 'POST' && url.pathname === '/api/knowledge') {
        return this.createKnowledgeEntry(await request.json());
      }

      const knowledgeMatch = url.pathname.match(/^\/api\/knowledge\/([^/]+)$/);
      if (knowledgeMatch && request.method === 'GET') {
        const entry = this.getKnowledgeEntry(decodeURIComponent(knowledgeMatch[1]));
        if (!entry) return json({ error: 'Knowledge entry not found' }, 404);
        return json(entry);
      }

      if (knowledgeMatch && request.method === 'PATCH') {
        return this.patchKnowledgeEntry(decodeURIComponent(knowledgeMatch[1]), await request.json());
      }

      const goalArchiveMatch = url.pathname.match(/^\/api\/goals\/([^/]+)\/archive$/);
      if (goalArchiveMatch && request.method === 'POST') {
        const entry = this.archiveGoal(decodeURIComponent(goalArchiveMatch[1]));
        if (!entry) return json({ error: 'Goal not found' }, 404);
        return json(entry, 201);
      }

      const channelDecisionsMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/decisions$/);
      if (channelDecisionsMatch && request.method === 'GET') {
        const channelId = decodeURIComponent(channelDecisionsMatch[1]);
        if (!this.getChannel(channelId)) return json({ error: 'Channel not found' }, 404);
        const statusValue = url.searchParams.get('status') ?? undefined;
        const status = statusValue === undefined ? undefined : DecisionStatusSchema.safeParse(statusValue);
        if (status && !status.success) return json({ error: 'Invalid decision status' }, 400);
        return json(this.listDecisions({ channelId, status: status?.success ? status.data : undefined }));
      }

      if (request.method === 'POST' && url.pathname === '/api/decisions') {
        return this.createDecision(await request.json().catch(() => ({})));
      }

      const decisionMatch = url.pathname.match(/^\/api\/decisions\/([^/]+)$/);
      if (decisionMatch && request.method === 'GET') {
        const decision = this.getDecision(decodeURIComponent(decisionMatch[1]));
        if (!decision) return json({ error: 'Decision not found' }, 404);
        return json(decision);
      }
      if (decisionMatch && request.method === 'PATCH') {
        return this.patchDecision(decodeURIComponent(decisionMatch[1]), await request.json().catch(() => ({})));
      }

      const decisionDeprecateMatch = url.pathname.match(/^\/api\/decisions\/([^/]+)\/deprecate$/);
      if (decisionDeprecateMatch && request.method === 'POST') {
        return this.deprecateDecision(decodeURIComponent(decisionDeprecateMatch[1]));
      }

      const decisionSupersedeMatch = url.pathname.match(/^\/api\/decisions\/([^/]+)\/supersede$/);
      if (decisionSupersedeMatch && request.method === 'POST') {
        return this.supersedeDecision(decodeURIComponent(decisionSupersedeMatch[1]), await request.json().catch(() => ({})));
      }

      const messageDecisionMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/to-decision$/);
      if (messageDecisionMatch && request.method === 'POST') {
        return this.createDecisionFromMessage(decodeURIComponent(messageDecisionMatch[1]), await request.json().catch(() => ({})));
      }

      if (request.method === 'GET' && url.pathname === '/api/documents') {
        const kindValue = url.searchParams.get('kind') ?? undefined;
        const statusValue = url.searchParams.get('status') ?? undefined;
        const kind = kindValue === undefined ? undefined : DocumentKindSchema.safeParse(kindValue);
        if (kind && !kind.success) return json({ error: 'Invalid document kind' }, 400);
        const status = statusValue === undefined ? undefined : DocumentStatusSchema.safeParse(statusValue);
        if (status && !status.success) return json({ error: 'Invalid document status' }, 400);
        return json(this.listDocuments({
          sourceChannelId: url.searchParams.get('channelId') ?? undefined,
          kind: kind?.success ? kind.data : undefined,
          status: status?.success ? status.data : undefined,
        }));
      }

      if (request.method === 'POST' && url.pathname === '/api/documents') {
        return this.createDocument(await request.json().catch(() => ({})));
      }

      const documentMatch = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
      if (documentMatch && request.method === 'GET') {
        const document = this.getDocument(decodeURIComponent(documentMatch[1]));
        if (!document) return json({ error: 'Document not found' }, 404);
        return json(document);
      }
      if (documentMatch && request.method === 'PATCH') {
        return this.patchDocument(decodeURIComponent(documentMatch[1]), await request.json().catch(() => ({})));
      }

      const documentSubmitReviewMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/submit-review$/);
      if (documentSubmitReviewMatch && request.method === 'POST') {
        return this.submitDocumentReview(decodeURIComponent(documentSubmitReviewMatch[1]), await request.json().catch(() => ({})));
      }

      const documentApproveMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/approve$/);
      if (documentApproveMatch && request.method === 'POST') {
        return this.approveDocument(decodeURIComponent(documentApproveMatch[1]), await request.json().catch(() => ({})));
      }

      const documentDeprecateMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/deprecate$/);
      if (documentDeprecateMatch && request.method === 'POST') {
        return this.deprecateDocument(decodeURIComponent(documentDeprecateMatch[1]));
      }

      const documentSupersedeMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/supersede$/);
      if (documentSupersedeMatch && request.method === 'POST') {
        return this.supersedeDocument(decodeURIComponent(documentSupersedeMatch[1]), await request.json().catch(() => ({})));
      }

      const messageDocumentMatch = url.pathname.match(/^\/api\/messages\/([^/]+)\/to-document$/);
      if (messageDocumentMatch && request.method === 'POST') {
        return this.createDocumentFromMessage(decodeURIComponent(messageDocumentMatch[1]), await request.json().catch(() => ({})));
      }

      if (request.method === 'GET' && url.pathname === '/api/agents') {
        return json(this.listAgents());
      }

      const remindersMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/reminders$/);
      if (remindersMatch && request.method === 'GET') {
        const agentId = decodeURIComponent(remindersMatch[1]);
        if (!this.getAgent(agentId)) return json({ error: 'Agent not found' }, 404);
        return json(this.listReminders(agentId));
      }

      if (remindersMatch && request.method === 'POST') {
        return this.createUserReminder(decodeURIComponent(remindersMatch[1]), await request.json());
      }

      const reminderMatch = url.pathname.match(/^\/api\/reminders\/([^/]+)$/);
      if (reminderMatch && request.method === 'PATCH') {
        return this.patchReminder(decodeURIComponent(reminderMatch[1]), await request.json());
      }

      const dmThreadsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/dms$/);
      if (dmThreadsMatch && request.method === 'GET') {
        const agentId = decodeURIComponent(dmThreadsMatch[1]);
        if (!this.getAgent(agentId)) return json({ error: 'Agent not found' }, 404);
        return json(this.listDirectMessageThreads(agentId));
      }

      const dmMessagesMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/dms\/([^/]+)$/);
      if (dmMessagesMatch && request.method === 'GET') {
        const agentId = decodeURIComponent(dmMessagesMatch[1]);
        const otherId = decodeURIComponent(dmMessagesMatch[2]);
        if (!this.getAgent(agentId)) return json({ error: 'Agent not found' }, 404);
        return json(this.listDirectMessages(agentId, otherId));
      }

      if (dmMessagesMatch && request.method === 'POST') {
        return this.createUserDirectMessage(
          decodeURIComponent(dmMessagesMatch[1]),
          decodeURIComponent(dmMessagesMatch[2]),
          await request.json(),
        );
      }

      const delegationListMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/delegations$/);
      if (delegationListMatch && request.method === 'GET') {
        const agentId = decodeURIComponent(delegationListMatch[1]);
        if (!this.getAgent(agentId)) return json({ error: 'Agent not found' }, 404);
        return json(this.listAgentDelegations(agentId));
      }

      const delegationCreateMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/delegate\/([^/]+)$/);
      if (delegationCreateMatch && request.method === 'POST') {
        const fromAgentId = decodeURIComponent(delegationCreateMatch[1]);
        const toAgentId = decodeURIComponent(delegationCreateMatch[2]);
        return this.createUserDelegation(fromAgentId, toAgentId, await request.json());
      }

      const activitiesMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/activities$/);
      if (activitiesMatch && request.method === 'GET') {
        if (!this.getAgent(activitiesMatch[1])) return json({ error: 'Agent not found' }, 404);
        return json(this.listAgentActivities(activitiesMatch[1], 200));
      }

      const workspaceMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/workspace$/);
      if (workspaceMatch && request.method === 'GET') {
        return await this.readAgentWorkspace(decodeURIComponent(workspaceMatch[1]), url.searchParams.get('path') ?? '');
      }

      if (request.method === 'POST' && url.pathname === '/api/agents') {
        return this.createAgent(await request.json());
      }

      const agentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
      if (agentMatch && request.method === 'GET') {
        const agent = this.getAgent(decodeURIComponent(agentMatch[1]));
        if (!agent) return json({ error: 'Agent not found' }, 404);
        return json(agent);
      }

      if (agentMatch && request.method === 'PATCH') {
        return this.patchAgent(decodeURIComponent(agentMatch[1]), await request.json());
      }

      if (agentMatch && request.method === 'DELETE') {
        return this.deleteAgent(decodeURIComponent(agentMatch[1]));
      }

      const startMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/start$/);
      if (startMatch && request.method === 'POST') {
        return this.startAgent(startMatch[1]);
      }

      const stopMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/stop$/);
      if (stopMatch && request.method === 'POST') {
        return this.stopAgent(stopMatch[1]);
      }

      if (request.method === 'GET' && url.pathname === '/api/machines') {
        return json(this.listMachines());
      }

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(JSON.stringify({ msg: 'request failed', error: err instanceof Error ? err.message : String(err) }));
      return json({ error: 'Internal server error' }, 500);
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let data: DaemonToServer;
    try {
      data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }

    const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
    if (!attachment || attachment.kind !== 'daemon') return;

    if (data.type === 'pong' || data.type === 'agent:deliver:ack' || data.type === 'agent:session') return;

    if (data.type === 'ready') {
      const machineId = data.machineId || attachment.machineId;
      ws.serializeAttachment({ kind: 'daemon', machineId } satisfies SocketAttachment);
      const duplicateIds = findDuplicateMachineIds({
        machines: this.listMachines(),
        targetMachineId: machineId,
        hostname: data.hostname,
        os: data.os,
      });
      this.mergeMachines(machineId, duplicateIds);
      const machine = this.upsertMachine({
        id: machineId,
        hostname: data.hostname,
        os: data.os,
        daemonVersion: data.daemonVersion,
        runtimes: data.runtimes,
        runtimeVersions: data.runtimeVersions,
        status: 'online',
        connectedAt: new Date().toISOString(),
      });
      this.broadcast({ type: 'machine:update', machine });
      this.reconcileReadyAgents(machineId, data.runtimes, new Set(data.runningAgents));
      return;
    }

    if (data.type === 'agent:status') {
      const agent = this.updateAgent(data.agentId, { status: data.status });
      if (agent) this.broadcast({ type: 'agent:update', agent });
      return;
    }

    if (data.type === 'agent:message') {
      const channel = this.getChannel(data.channelId);
      if (!channel) return;
      const agent = this.getAgent(data.agentId);
      let threadRootId = data.inReplyToMessageId;
      if (threadRootId) {
        const thread = this.getThread(threadRootId);
        if (!thread || thread.root.channelId !== data.channelId) return;
        threadRootId = thread.root.id;
      }
      const created = this.createMessage({
        id: crypto.randomUUID(),
        channelId: data.channelId,
        agentId: data.agentId,
        senderName: agent?.displayName ?? agent?.name ?? data.agentId,
        content: data.content,
        threadRootId,
      });
      if (created.threadRootId) {
        const thread = this.getThread(created.threadRootId);
        if (thread) this.broadcast({ type: 'thread:message:new', root: thread.root, message: created });
      } else {
        this.broadcast({ type: 'message:new', message: created });
      }
      return;
    }

    if (data.type === 'agent:activity') {
      const activity = this.createAgentActivity({
        id: crypto.randomUUID(),
        agentId: data.agentId,
        type: data.activityType,
        detail: data.detail,
      });
      this.broadcast({ type: 'agent:activity', agentId: data.agentId, activity });
      return;
    }

    if (data.type === 'workspace:result') {
      this.resolveWorkspaceRead(data.requestId, data.result);
      return;
    }

    if (data.type === 'agent:dm') {
      const target = this.findAgentByNameOrId(data.toAgentId);
      if (!target) return;
      const dm = this.createDirectMessage({
        id: crypto.randomUUID(),
        fromAgentId: data.fromAgentId,
        toAgentId: target.id,
        content: data.content,
      });
      this.broadcast({ type: 'dm:new', dm });
      this.deliverDirectMessage(target, dm);
      return;
    }

    if (data.type === 'agent:delegate') {
      this.delegateAgent({
        fromAgentId: data.fromAgentId,
        toAgentId: data.toAgentId,
        content: data.content,
        startIfInactive: data.startIfInactive,
      });
      return;
    }

    if (data.type === 'agent:create_task') {
      const channelId = data.channelId ?? 'general';
      const channel = this.getChannel(channelId);
      if (!channel) return;
      const agent = this.getAgent(data.agentId);
      const assignee = data.assigneeId ? this.findAgentByNameOrId(data.assigneeId) : undefined;
      const task = this.createTask({
        id: crypto.randomUUID(),
        channelId,
        title: data.title,
        status: 'backlog',
        creatorName: agent?.displayName ?? agent?.name ?? data.agentId,
        creator: { actorType: 'agent', actorId: data.agentId },
        assigneeId: assignee?.id ?? data.assigneeId,
      });
      this.appendAuditLog({
        actorType: 'agent',
        actorId: data.agentId,
        action: 'task.created',
        entityType: 'task',
        entityId: task.id,
        taskId: task.id,
        agentId: data.agentId,
        detailJson: { status: task.status, type: task.type },
      });
      this.broadcast({ type: 'task:update', task });
      this.notifyTaskAssignee(task);
      return;
    }

    if (data.type === 'agent:update_task') {
      const task = this.updateTask(data.taskId, { status: data.status });
      if (task) {
        this.broadcast({ type: 'task:update', task });
        this.notifyTaskAssignee(task);
      }
      return;
    }

    if (data.type === 'agent:set_reminder') {
      const channelId = data.channelId ?? 'general';
      const channel = this.getChannel(channelId);
      const agent = this.getAgent(data.agentId);
      if (!channel || !agent) return;
      const reminder = this.createReminder({
        id: crypto.randomUUID(),
        agentId: agent.id,
        channelId,
        message: data.message,
        triggerAt: data.triggerAt,
        status: 'pending',
      });
      this.broadcast({ type: 'reminder:update', reminder });
      return;
    }

    if (data.type === 'agent:cancel_reminder') {
      const reminder = this.getReminder(data.reminderId);
      if (!reminder || reminder.agentId !== data.agentId) return;
      const updated = this.updateReminder(data.reminderId, { status: 'cancelled' });
      if (updated) this.broadcast({ type: 'reminder:update', reminder: updated });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
    if (!attachment || attachment.kind !== 'daemon') return;
    const machine = this.setMachineOffline(attachment.machineId);
    if (machine) this.broadcast({ type: 'machine:update', machine });
    this.markMachineAgentsInactive(attachment.machineId);
  }

  private acceptBrowser(request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ kind: 'browser' } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptDaemon(request: Request, url: URL): Response {
    const key = url.searchParams.get('key');
    const expected = this.env.DAEMON_API_KEY;
    if (!key || !expected || !timingSafeEqualStr(key, expected)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ kind: 'daemon', machineId: crypto.randomUUID() } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private initSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        content TEXT NOT NULL,
        agent_id TEXT,
        actor_type TEXT NOT NULL DEFAULT 'human',
        actor_id TEXT,
        thread_root_id TEXT,
        mentions TEXT,
        created_at TEXT NOT NULL
      )
    `);
    try {
      this.ctx.storage.sql.exec('ALTER TABLE messages ADD COLUMN actor_type TEXT NOT NULL DEFAULT "human"');
    } catch {
      // Existing Durable Objects may already have the column.
    }
    try {
      this.ctx.storage.sql.exec('ALTER TABLE messages ADD COLUMN actor_id TEXT');
    } catch {
      // Existing Durable Objects may already have the column.
    }
    try {
      this.ctx.storage.sql.exec('ALTER TABLE messages ADD COLUMN thread_root_id TEXT');
    } catch {
      // Existing Durable Objects may already have the column.
    }
    try {
      this.ctx.storage.sql.exec('ALTER TABLE messages ADD COLUMN mentions TEXT');
    } catch {
      // Existing Durable Objects may already have the column.
    }
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        task_id TEXT,
        agent_id TEXT,
        detail_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'feature',
        creator_name TEXT NOT NULL,
        creator_type TEXT NOT NULL DEFAULT 'human',
        creator_id TEXT,
        assignee_id TEXT,
        owner_type TEXT,
        owner_id TEXT,
        reviewer_type TEXT,
        reviewer_id TEXT,
        acceptance_criteria TEXT,
        definition_of_done TEXT,
        constraints TEXT,
        depends_on TEXT,
        is_blocked INTEGER NOT NULL DEFAULT 0,
        blocked_reason TEXT,
        source_channel_id TEXT,
        source_thread_id TEXT,
        context TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        source_message_id TEXT,
        requester_name TEXT NOT NULL,
        objective TEXT NOT NULL,
        background TEXT NOT NULL,
        success_criteria TEXT NOT NULL,
        constraints TEXT NOT NULL,
        assumptions TEXT NOT NULL,
        risks TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS goal_alignments (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        thread_root_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        goal_id TEXT,
        status TEXT NOT NULL,
        objective TEXT NOT NULL,
        questions TEXT NOT NULL,
        answers TEXT NOT NULL,
        success_criteria TEXT NOT NULL,
        constraints TEXT NOT NULL,
        plan_summary TEXT,
        task_drafts TEXT NOT NULL,
        recommended_agent_ids TEXT NOT NULL,
        reviewer_agent_ids TEXT NOT NULL,
        recommendation_reasons TEXT NOT NULL,
        gaps TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    try {
      this.ctx.storage.sql.exec('ALTER TABLE tasks ADD COLUMN context TEXT');
    } catch {
      // Existing Durable Objects may already have the column.
    }
    try {
      this.ctx.storage.sql.exec('ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    } catch {
      // Existing Durable Objects may already have the column.
    }
    for (const statement of [
      'ALTER TABLE tasks ADD COLUMN type TEXT NOT NULL DEFAULT "feature"',
      'ALTER TABLE tasks ADD COLUMN creator_type TEXT NOT NULL DEFAULT "human"',
      'ALTER TABLE tasks ADD COLUMN creator_id TEXT',
      'ALTER TABLE tasks ADD COLUMN owner_type TEXT',
      'ALTER TABLE tasks ADD COLUMN owner_id TEXT',
      'ALTER TABLE tasks ADD COLUMN reviewer_type TEXT',
      'ALTER TABLE tasks ADD COLUMN reviewer_id TEXT',
      'ALTER TABLE tasks ADD COLUMN acceptance_criteria TEXT',
      'ALTER TABLE tasks ADD COLUMN definition_of_done TEXT',
      'ALTER TABLE tasks ADD COLUMN constraints TEXT',
      'ALTER TABLE tasks ADD COLUMN depends_on TEXT',
      'ALTER TABLE tasks ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE tasks ADD COLUMN blocked_reason TEXT',
      'ALTER TABLE tasks ADD COLUMN source_channel_id TEXT',
      'ALTER TABLE tasks ADD COLUMN source_thread_id TEXT',
    ]) {
      try {
        this.ctx.storage.sql.exec(statement);
      } catch {
        // Existing Durable Objects may already have the column.
      }
    }
    this.ctx.storage.sql.exec(`UPDATE tasks SET status = 'backlog' WHERE status = 'todo'`);
    this.ctx.storage.sql.exec(`UPDATE tasks SET is_blocked = 1, status = 'in_progress' WHERE status = 'blocked'`);
    this.ctx.storage.sql.exec(`UPDATE messages SET actor_type = 'agent', actor_id = agent_id WHERE agent_id IS NOT NULL AND actor_id IS NULL`);
    this.ctx.storage.sql.exec(`UPDATE messages SET actor_type = 'human', actor_id = sender_name WHERE actor_id IS NULL`);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message TEXT NOT NULL,
        trigger_at TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT NOT NULL,
        source_refs TEXT NOT NULL,
        owner_agent_id TEXT,
        reviewer_agent_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        source_thread_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed',
        problem TEXT NOT NULL,
        alternatives TEXT,
        decision_text TEXT NOT NULL,
        rationale TEXT,
        consequences TEXT,
        participants TEXT,
        related_decisions TEXT,
        superseded_by TEXT,
        accepted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_decisions_channel ON decisions(channel_id)`);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status)`);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        content TEXT NOT NULL DEFAULT '',
        source_thread_id TEXT,
        source_channel_id TEXT NOT NULL,
        author_type TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        reviewers TEXT,
        related_decisions TEXT,
        related_tasks TEXT,
        superseded_by TEXT,
        approved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_documents_channel ON documents(source_channel_id)`);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_documents_kind ON documents(kind)`);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status)`);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS direct_messages (
        id TEXT PRIMARY KEY,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS agent_delegations (
        id TEXT PRIMARY KEY,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS agent_tokens (
        agent_id TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        description TEXT,
        runtime TEXT NOT NULL,
        model TEXT,
        system_prompt TEXT,
        env_vars TEXT,
        organization TEXT,
        machine_id TEXT,
        status TEXT NOT NULL,
        auto_start INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);
    try {
      this.ctx.storage.sql.exec('ALTER TABLE agents ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0');
    } catch (err) {
      const message = [String(err), (err as { message?: string }).message, (err as { cause?: { message?: string } }).cause?.message]
        .join(' ')
        .toLowerCase();
      if (!message.includes('duplicate column')) throw err;
    }
    try {
      this.ctx.storage.sql.exec('ALTER TABLE agents ADD COLUMN env_vars TEXT');
    } catch {
      // Existing Durable Objects may already have the column.
    }
    try {
      this.ctx.storage.sql.exec('ALTER TABLE agents ADD COLUMN organization TEXT');
    } catch {
      // Existing Durable Objects may already have the column.
    }
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS machines (
        id TEXT PRIMARY KEY,
        hostname TEXT NOT NULL,
        os TEXT NOT NULL,
        daemon_version TEXT NOT NULL,
        runtimes TEXT NOT NULL,
        runtime_versions TEXT NOT NULL,
        status TEXT NOT NULL,
        connected_at TEXT NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO channels (id, name, created_at) VALUES (?, ?, ?)',
      'general',
      'general',
      new Date().toISOString()
    );
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS context_package_refs (
        task_id TEXT NOT NULL,
        ref_type TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        ref_updated_at TEXT NOT NULL,
        PRIMARY KEY (task_id, ref_type, ref_id)
      )
    `);
    this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_cp_refs_ref ON context_package_refs(ref_type, ref_id)`);
  }

  private createUserMessage(channelId: string, body: unknown): Response {
    const channel = this.getChannel(channelId);
    if (!channel) return json({ error: 'Channel not found' }, 404);
    const parsed = CreateMessageRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    }
    const payload = parsed.data;
    let threadRootId = payload.threadRootId;
    if (threadRootId) {
      const thread = this.getThread(threadRootId);
      if (!thread) return json({ error: 'Thread root not found' }, 404);
      if (thread.root.channelId !== channelId) return json({ error: 'Thread root belongs to another channel' }, 400);
      threadRootId = thread.root.id;
    }

    const mentions = this.parseMentions(payload.content);
    const message = this.createMessage({
      id: crypto.randomUUID(),
      channelId,
      senderName: payload.senderName,
      content: payload.content,
      agentId: payload.agentId,
      threadRootId,
      mentions,
    });
    if (message.threadRootId) {
      const thread = this.getThread(message.threadRootId);
      if (thread) this.broadcast({ type: 'thread:message:new', root: thread.root, message });
    } else {
      this.broadcast({ type: 'message:new', message });
    }

    const targetAgentIds = new Set<string>();
    if (payload.agentId) targetAgentIds.add(payload.agentId);
    for (const mention of mentions ?? []) {
      if (mention.type === 'agent') targetAgentIds.add(mention.id);
    }

    for (const targetAgentId of targetAgentIds) {
      const agent = this.getAgent(targetAgentId);
      const machineId = agent ? this.resolveStartMachineId(agent) : undefined;
      if (agent && machineId && agent.status !== 'inactive') {
        this.sendToDaemon(machineId, {
          type: 'agent:deliver',
          agentId: agent.id,
          seq: Date.now(),
          message: toAgentDelivery(message, channel),
          channelId: channel.id,
          config: this.toAgentRuntimeConfig(agent),
        });
      }
    }

    return json(message, 201);
  }

  private createUserChannel(body: unknown): Response {
    const parsed = CreateChannelRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    if (this.listChannels().some((channel) => channel.name === parsed.data.name)) return json({ error: 'Channel name already exists' }, 409);
    const channel = this.createChannel(crypto.randomUUID(), parsed.data.name);
    this.broadcast({ type: 'channel:created', channel });
    return json(channel, 201);
  }

  private deleteUserChannel(id: string): Response {
    if (id === 'general') return json({ error: 'Cannot delete general channel' }, 400);
    if (!this.getChannel(id)) return json({ error: 'Channel not found' }, 404);
    this.deleteChannel(id);
    this.broadcast({ type: 'channel:deleted', channelId: id });
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  private async createUserTask(body: unknown): Promise<Response> {
    const parsed = CreateTaskRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    if (!this.getChannel(parsed.data.channelId)) return json({ error: 'Channel not found' }, 404);
    const taskId = crypto.randomUUID();
    const dependencyError = this.validateTaskDependencies(taskId, parsed.data.context?.blockedByTaskIds);
    if (dependencyError) return json({ error: dependencyError }, 422);

    const task = this.createTask({
      id: taskId,
      channelId: parsed.data.channelId,
      messageId: parsed.data.messageId,
      title: parsed.data.title,
      status: parsed.data.status,
      type: parsed.data.type,
      creatorName: parsed.data.creatorName,
      creator: { actorType: parsed.data.creatorType, actorId: parsed.data.creatorId ?? parsed.data.creatorName },
      assigneeId: parsed.data.assigneeId,
      owner: parsed.data.assigneeId ? { actorType: parsed.data.ownerType ?? 'agent', actorId: parsed.data.ownerId ?? parsed.data.assigneeId } : undefined,
      reviewer: actorFromPatch(parsed.data.reviewerType, parsed.data.reviewerId),
      acceptanceCriteria: parsed.data.acceptanceCriteria,
      definitionOfDone: parsed.data.definitionOfDone,
      constraints: parsed.data.constraints,
      dependsOn: parsed.data.dependsOn ?? parsed.data.context?.blockedByTaskIds,
      isBlocked: parsed.data.isBlocked,
      blockedReason: parsed.data.blockedReason,
      sourceChannelId: parsed.data.sourceChannelId ?? parsed.data.channelId,
      sourceThreadId: parsed.data.sourceThreadId,
      context: parsed.data.context,
    });
    this.appendAuditLog({
      actorType: parsed.data.creatorType,
      actorId: parsed.data.creatorId ?? parsed.data.creatorName,
      action: 'task.created',
      entityType: 'task',
      entityId: task.id,
      taskId: task.id,
      detailJson: { status: task.status, type: task.type },
    });
    this.broadcast({ type: 'task:update', task });
    this.notifyTaskAssignee(task);
    if (task.status === 'assigned' && task.assigneeId) {
      const cp = await this.generateAndStoreContextPackage(task);
      if (cp) task.context = { ...task.context, contextPackage: cp };
    }
    return json(task, 201);
  }

  private createUserGoal(body: unknown): Response {
    const parsed = CreateGoalBriefRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const channel = this.getChannel(parsed.data.channelId);
    if (!channel) return json({ error: 'Channel not found' }, 404);
    if (parsed.data.sourceMessageId) {
      const source = this.getMessage(parsed.data.sourceMessageId);
      if (!source) return json({ error: 'Source message not found' }, 404);
      if (source.channelId !== channel.id) return json({ error: 'Source message belongs to another channel' }, 400);
    }
    const goal = this.createGoal({
      id: crypto.randomUUID(),
      channelId: channel.id,
      sourceMessageId: parsed.data.sourceMessageId,
      requesterName: parsed.data.requesterName,
      objective: parsed.data.objective,
      background: parsed.data.background,
      successCriteria: parsed.data.successCriteria,
      constraints: parsed.data.constraints,
      assumptions: parsed.data.assumptions,
      risks: parsed.data.risks,
      status: parsed.data.status,
    });
    this.broadcast({ type: 'goal:update', goal });
    return json(goal, 201);
  }

  private createUserReminder(agentId: string, body: unknown): Response {
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);
    const parsed = CreateReminderRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const channel = this.findChannel(parsed.data.channelId);
    if (!channel) return json({ error: 'Channel not found' }, 404);
    const reminder = this.createReminder({
      id: crypto.randomUUID(),
      agentId,
      channelId: channel.id,
      message: parsed.data.message,
      triggerAt: parsed.data.triggerAt,
      status: 'pending',
    });
    this.broadcast({ type: 'reminder:update', reminder });
    return json(reminder, 201);
  }

  private patchReminder(id: string, body: unknown): Response {
    const parsed = PatchReminderRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const reminder = this.updateReminder(id, { status: parsed.data.status });
    if (!reminder) return json({ error: 'Reminder not found' }, 404);
    this.broadcast({ type: 'reminder:update', reminder });
    return json(reminder);
  }

  private createKnowledgeEntry(body: unknown): Response {
    const parsed = CreateKnowledgeEntryRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    if (parsed.data.sourceRefs.length === 0 && !parsed.data.allowNoSource) return json({ error: 'sourceRefs are required unless allowNoSource is true' }, 400);
    const entry = this.writeKnowledgeEntry({
      id: crypto.randomUUID(),
      kind: parsed.data.kind,
      title: parsed.data.title,
      summary: parsed.data.summary,
      body: parsed.data.body,
      tags: parsed.data.tags,
      sourceRefs: parsed.data.sourceRefs,
      ownerAgentId: parsed.data.ownerAgentId,
      reviewerAgentId: parsed.data.reviewerAgentId,
      status: parsed.data.status,
    });
    this.broadcast({ type: 'knowledge:update', entry });
    return json(entry, 201);
  }

  private patchKnowledgeEntry(id: string, body: unknown): Response {
    const parsed = PatchKnowledgeEntryRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const entry = this.updateKnowledgeEntry(id, parsed.data);
    if (!entry) return json({ error: 'Knowledge entry not found' }, 404);
    this.broadcast({ type: 'knowledge:update', entry });
    return json(entry);
  }

  private createDecision(body: unknown): Response {
    const parsed = CreateDecisionRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    if (parsed.data.status !== 'proposed') return json({ error: 'Decision must start in proposed status' }, 422);
    const channel = this.getChannel(parsed.data.channelId);
    if (!channel) return json({ error: 'Channel not found' }, 404);
    const decision = this.writeDecision({
      id: crypto.randomUUID(),
      channelId: parsed.data.channelId,
      sourceThreadId: parsed.data.sourceThreadId,
      title: parsed.data.title,
      status: 'proposed',
      problem: parsed.data.problem,
      alternatives: parsed.data.alternatives,
      decisionText: parsed.data.decisionText,
      rationale: parsed.data.rationale,
      consequences: parsed.data.consequences,
      participants: parsed.data.participants,
      relatedDecisions: parsed.data.relatedDecisions,
    });
    this.appendAuditLog({
      actorType: 'human',
      actorId: 'user',
      action: 'decision.created',
      entityType: 'decision',
      entityId: decision.id,
      detailJson: { status: decision.status, channelId: decision.channelId },
    });
    return json(decision, 201);
  }

  private patchDecision(id: string, body: unknown): Response {
    const parsed = PatchDecisionRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const existing = this.getDecision(id);
    if (!existing) return json({ error: 'Decision not found' }, 404);
    if (parsed.data.status && parsed.data.status !== existing.status) {
      if (!(existing.status === 'proposed' && parsed.data.status === 'accepted')) {
        return json({ error: 'Invalid decision status transition', from: existing.status, to: parsed.data.status }, 422);
      }
    }
    const updated = this.updateDecision(id, {
      ...parsed.data,
      acceptedAt: parsed.data.status === 'accepted' ? new Date().toISOString() : existing.acceptedAt,
    });
    if (!updated) return json({ error: 'Decision not found' }, 404);
    this.markContextPackagesStale('decision', updated.id);
    this.appendAuditLog({
      actorType: 'human',
      actorId: 'user',
      action: parsed.data.status ? 'decision.status_changed' : 'decision.updated',
      entityType: 'decision',
      entityId: updated.id,
      detailJson: parsed.data.status ? { from: existing.status, to: updated.status } : { fields: Object.keys(parsed.data) },
    });
    return json(updated);
  }

  private deprecateDecision(id: string): Response {
    const existing = this.getDecision(id);
    if (!existing) return json({ error: 'Decision not found' }, 404);
    if (existing.status !== 'accepted') return json({ error: 'Only accepted decisions can be deprecated' }, 422);
    const updated = this.updateDecision(id, { status: 'deprecated' });
    if (!updated) return json({ error: 'Decision not found' }, 404);
    this.markContextPackagesStale('decision', updated.id);
    this.appendAuditLog({
      actorType: 'human',
      actorId: 'user',
      action: 'decision.status_changed',
      entityType: 'decision',
      entityId: updated.id,
      detailJson: { from: existing.status, to: updated.status },
    });
    return json(updated);
  }

  private supersedeDecision(id: string, body: unknown): Response {
    const parsed = DecisionTransitionRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    if (!parsed.data.supersededBy) return json({ error: 'supersededBy is required' }, 400);
    const existing = this.getDecision(id);
    if (!existing) return json({ error: 'Decision not found' }, 404);
    if (existing.status !== 'accepted') return json({ error: 'Only accepted decisions can be superseded' }, 422);
    const replacement = this.getDecision(parsed.data.supersededBy);
    if (!replacement) return json({ error: 'Superseding decision not found' }, 404);
    const updated = this.updateDecision(id, { status: 'superseded', supersededBy: replacement.id });
    if (!updated) return json({ error: 'Decision not found' }, 404);
    this.markContextPackagesStale('decision', updated.id);
    this.appendAuditLog({
      actorType: 'human',
      actorId: 'user',
      action: 'decision.status_changed',
      entityType: 'decision',
      entityId: updated.id,
      detailJson: { from: existing.status, to: updated.status, supersededBy: replacement.id },
    });
    return json(updated);
  }

  private createDocument(body: unknown): Response {
    const parsed = CreateDocumentRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    if (!this.getChannel(parsed.data.sourceChannelId)) return json({ error: 'Channel not found' }, 404);
    const document = this.writeDocument({
      id: crypto.randomUUID(),
      kind: parsed.data.kind,
      title: parsed.data.title,
      status: 'draft',
      content: parsed.data.content,
      sourceThreadId: parsed.data.sourceThreadId,
      sourceChannelId: parsed.data.sourceChannelId,
      author: { actorType: parsed.data.authorType, actorId: parsed.data.authorId },
      authorName: parsed.data.authorName,
      reviewers: [],
      relatedDecisions: parsed.data.relatedDecisions,
      relatedTasks: parsed.data.relatedTasks,
    });
    this.appendAuditLog({
      actorType: parsed.data.authorType,
      actorId: parsed.data.authorId,
      action: 'document.created',
      entityType: 'document',
      entityId: document.id,
      detailJson: { kind: document.kind, status: document.status, sourceChannelId: document.sourceChannelId },
    });
    return json(document, 201);
  }

  private patchDocument(id: string, body: unknown): Response {
    const parsed = PatchDocumentRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const existing = this.getDocument(id);
    if (!existing) return json({ error: 'Document not found' }, 404);
    const updated = this.updateDocument(id, parsed.data);
    if (!updated) return json({ error: 'Document not found' }, 404);
    this.markContextPackagesStale('document', updated.id);
    this.appendAuditLog({
      actorType: 'human',
      actorId: 'user',
      action: 'document.updated',
      entityType: 'document',
      entityId: updated.id,
      detailJson: { fields: Object.keys(parsed.data) },
    });
    return json(updated);
  }

  private submitDocumentReview(id: string, body: unknown): Response {
    const parsed = SubmitDocumentReviewRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const existing = this.getDocument(id);
    if (!existing) return json({ error: 'Document not found' }, 404);
    if (existing.status !== 'draft') return json({ error: 'Only draft documents can be submitted for review' }, 422);
    const updated = this.updateDocument(id, { status: 'in_review', reviewers: parsed.data.reviewers });
    if (!updated) return json({ error: 'Document not found' }, 404);
    this.markContextPackagesStale('document', updated.id);
    this.appendAuditLog({
      actorType: 'human',
      actorId: 'user',
      action: 'document.status_changed',
      entityType: 'document',
      entityId: updated.id,
      detailJson: { from: existing.status, to: updated.status },
    });
    return json(updated);
  }

  private approveDocument(id: string, body: unknown): Response {
    const parsed = ApproveDocumentRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const existing = this.getDocument(id);
    if (!existing) return json({ error: 'Document not found' }, 404);
    if (existing.status !== 'in_review') return json({ error: 'Only in_review documents can be approved' }, 422);
    const allowed = (existing.reviewers ?? []).some((reviewer) => reviewer.actorType === parsed.data.actorType && reviewer.actorId === parsed.data.actorId);
    if (!allowed) return json({ error: 'Approver must be in reviewers list' }, 403);
    const updated = this.updateDocument(id, { status: 'approved', approvedAt: new Date().toISOString() });
    if (!updated) return json({ error: 'Document not found' }, 404);
    this.markContextPackagesStale('document', updated.id);
    this.appendAuditLog({
      actorType: parsed.data.actorType,
      actorId: parsed.data.actorId,
      action: 'document.status_changed',
      entityType: 'document',
      entityId: updated.id,
      detailJson: { from: existing.status, to: updated.status },
    });
    return json(updated);
  }

  private deprecateDocument(id: string): Response {
    const existing = this.getDocument(id);
    if (!existing) return json({ error: 'Document not found' }, 404);
    if (existing.status !== 'approved') return json({ error: 'Only approved documents can be deprecated' }, 422);
    const updated = this.updateDocument(id, { status: 'deprecated' });
    if (!updated) return json({ error: 'Document not found' }, 404);
    this.markContextPackagesStale('document', updated.id);
    this.appendAuditLog({
      actorType: 'human',
      actorId: 'user',
      action: 'document.status_changed',
      entityType: 'document',
      entityId: updated.id,
      detailJson: { from: existing.status, to: updated.status },
    });
    return json(updated);
  }

  private supersedeDocument(id: string, body: unknown): Response {
    const parsed = DecisionTransitionRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    if (!parsed.data.supersededBy) return json({ error: 'supersededBy is required' }, 400);
    const existing = this.getDocument(id);
    if (!existing) return json({ error: 'Document not found' }, 404);
    if (existing.status !== 'approved') return json({ error: 'Only approved documents can be superseded' }, 422);
    const replacement = this.getDocument(parsed.data.supersededBy);
    if (!replacement) return json({ error: 'Superseding document not found' }, 404);
    const updated = this.updateDocument(id, { status: 'superseded', supersededBy: replacement.id });
    if (!updated) return json({ error: 'Document not found' }, 404);
    this.markContextPackagesStale('document', updated.id);
    this.appendAuditLog({
      actorType: 'human',
      actorId: 'user',
      action: 'document.status_changed',
      entityType: 'document',
      entityId: updated.id,
      detailJson: { from: existing.status, to: updated.status, supersededBy: replacement.id },
    });
    return json(updated);
  }

  private async patchTask(taskId: string, body: unknown): Promise<Response> {
    const parsed = PatchTaskRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const { expectedVersion, ...patch } = parsed.data;
    const existing = this.getTask(taskId);
    if (!existing) return json({ error: 'Task not found' }, 404);
    if (expectedVersion !== undefined && expectedVersion !== existing.version) {
      return json({ error: 'Task version conflict', currentVersion: existing.version }, 409);
    }
    if (patch.status && !isTaskTransitionAllowed(existing.status, patch.status)) {
      return json({ error: 'Invalid task status transition', from: existing.status, to: patch.status }, 422);
    }
    const dependencyError = this.validateTaskDependencies(existing.id, patch.dependsOn ?? patch.context?.blockedByTaskIds);
    if (dependencyError) return json({ error: dependencyError }, 422);
    if (patch.status === 'in_progress') {
      const blockersError = this.validateBlockersComplete({ ...existing, ...patch });
      if (blockersError) return json({ error: blockersError }, 422);
    }
    const task = this.updateTask(taskId, patch);
    if (!task) return json({ error: 'Task not found' }, 404);
    if (patch.status && patch.status !== existing.status) {
      this.appendAuditLog({
        actorType: existing.creator.actorType,
        actorId: existing.creator.actorId,
        action: 'task.status_changed',
        entityType: 'task',
        entityId: task.id,
        taskId: task.id,
        detailJson: { from: existing.status, to: task.status, expectedVersion },
      });
    }
    this.broadcast({ type: 'task:update', task });
    this.notifyTaskAssignee(task);
    if (task.status === 'done' && existing.status !== 'done') this.notifyTasksBlockedBy(task.id);
    if (task.status === 'assigned' && existing.status !== 'assigned' && task.assigneeId) {
      const cp = await this.generateAndStoreContextPackage(task);
      if (cp) task.context = { ...task.context, contextPackage: cp };
    }
    return json(task);
  }

  private createTaskReview(taskId: string, body: unknown, requesterAgentId?: string): Response {
    const task = this.getTask(taskId);
    if (!task) return json({ error: 'Task not found' }, 404);
    const parsed = CreateTaskReviewRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const requester = requesterAgentId ?? parsed.data.requesterAgentId;
    if (isHighRiskTask(task) && requester && parsed.data.reviewerAgentId === requester && !parsed.data.allowSelfReview) {
      return json({ error: 'High risk task requires a different reviewer' }, 400);
    }
    if (!isTaskTransitionAllowed(task.status, 'in_review')) {
      return json({ error: 'Invalid task status transition', from: task.status, to: 'in_review' }, 422);
    }
    const review = makeTaskReview(task.id, { ...parsed.data, requesterAgentId: requester });
    const updated = this.updateTask(task.id, {
      status: 'in_review',
      context: {
        ...task.context,
        reviewerAgentId: parsed.data.reviewerAgentId,
        evidence: review.evidence,
        acceptanceChecklist: review.checklist.map((item) => item.label),
        reviewIds: [...(task.context?.reviewIds ?? []), review.id],
        reviewNotes: [...(task.context?.reviewNotes ?? []), parsed.data.selfReviewReason ? `self-review allowed: ${parsed.data.selfReviewReason}` : parsed.data.comment ?? 'review requested'],
        reviews: [...(task.context?.reviews ?? []), review],
      },
    });
    if (!updated) return json({ error: 'Task not found' }, 404);
    if (updated.status !== task.status) {
      this.appendAuditLog({
        actorType: requester ? 'agent' : 'human',
        actorId: requester ?? task.creator.actorId,
        action: 'task.status_changed',
        entityType: 'task',
        entityId: updated.id,
        taskId: updated.id,
        detailJson: { from: task.status, to: updated.status, reason: 'review_requested' },
      });
    }
    this.broadcast({ type: 'task:update', task: updated });
    return json(review, 201);
  }

  private reviewDecision(reviewId: string, body: unknown, status: 'approved' | 'changes_requested', reviewerAgentId?: string): Response {
    const parsed = ReviewDecisionRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const task = this.listTasks().find((candidate) => candidate.context?.reviews?.some((review) => review.id === reviewId));
    if (!task) return json({ error: 'Review not found' }, 404);
    const review = task.context?.reviews?.find((candidate) => candidate.id === reviewId);
    const reviewer = reviewerAgentId ?? parsed.data.reviewerAgentId;
    if (reviewerAgentId && review?.reviewerAgentId && review.reviewerAgentId !== reviewerAgentId) return json({ error: 'Review is assigned to another agent' }, 403);
    const nextTaskStatus = status === 'approved' ? 'done' : 'changes_requested';
    if (!isTaskTransitionAllowed(task.status, nextTaskStatus)) {
      return json({ error: 'Invalid task status transition', from: task.status, to: nextTaskStatus }, 422);
    }
    const now = new Date().toISOString();
    const reviews = (task.context?.reviews ?? []).map((candidate) => candidate.id === reviewId
      ? {
        ...candidate,
        reviewerAgentId: reviewer ?? candidate.reviewerAgentId,
        status,
        comment: parsed.data.comment,
        checklist: candidate.checklist.map((item) => ({ ...item, checked: status === 'approved' ? true : item.checked })),
        updatedAt: now,
      }
      : candidate);
    const updated = this.updateTask(task.id, {
      status: nextTaskStatus,
      context: {
        ...task.context,
        reviewNotes: [...(task.context?.reviewNotes ?? []), `${status}: ${parsed.data.comment}`],
        reviews,
      },
    });
    if (!updated) return json({ error: 'Task not found' }, 404);
    if (updated.status !== task.status) {
      this.appendAuditLog({
        actorType: reviewer ? 'agent' : 'human',
        actorId: reviewer ?? task.creator.actorId,
        action: 'task.status_changed',
        entityType: 'task',
        entityId: updated.id,
        taskId: updated.id,
        detailJson: { from: task.status, to: updated.status, reason: status },
      });
    }
    this.broadcast({ type: 'task:update', task: updated });
    return json(reviews.find((candidate) => candidate.id === reviewId));
  }

  private patchGoal(goalId: string, body: unknown): Response {
    const parsed = PatchGoalBriefRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const goal = this.updateGoal(goalId, parsed.data);
    if (!goal) return json({ error: 'Goal not found' }, 404);
    this.broadcast({ type: 'goal:update', goal });
    return json(goal);
  }

  private deleteTask(taskId: string): Response {
    if (!this.getTask(taskId)) return json({ error: 'Task not found' }, 404);
    this.ctx.storage.sql.exec('DELETE FROM tasks WHERE id = ?', taskId);
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  private createTaskFromMessage(messageId: string, body: unknown): Response {
    const message = this.getMessage(messageId);
    if (!message) return json({ error: 'Message not found' }, 404);
    const parsed = MessageToTaskRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);

    const task = this.createTask({
      id: crypto.randomUUID(),
      channelId: message.channelId,
      messageId: message.id,
      title: message.content.slice(0, 200),
      status: 'backlog',
      creatorName: parsed.data.creatorName,
      creator: { actorType: parsed.data.creatorType, actorId: parsed.data.creatorId ?? parsed.data.creatorName },
      assigneeId: parsed.data.assigneeId,
      owner: parsed.data.assigneeId ? { actorType: 'agent', actorId: parsed.data.assigneeId } : undefined,
      type: 'feature',
      isBlocked: false,
      sourceChannelId: message.channelId,
      sourceThreadId: message.threadRootId,
      context: {
        ...parsed.data.context,
        sourceMessageIds: Array.from(new Set([...(parsed.data.context?.sourceMessageIds ?? []), message.id])),
      },
    });
    this.broadcast({ type: 'task:update', task });
    this.notifyTaskAssignee(task);
    return json(task, 201);
  }

  private createDecisionFromMessage(messageId: string, body: unknown): Response {
    const message = this.getMessage(messageId);
    if (!message) return json({ error: 'Message not found' }, 404);
    const payload = (body ?? {}) as Record<string, unknown>;
    const decision = this.writeDecision({
      id: crypto.randomUUID(),
      channelId: message.channelId,
      sourceThreadId: message.threadRootId ?? message.id,
      title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : message.content.slice(0, 120),
      status: 'proposed',
      problem: typeof payload.problem === 'string' && payload.problem.trim() ? payload.problem.trim() : message.content.slice(0, 500),
      decisionText: typeof payload.decisionText === 'string' && payload.decisionText.trim() ? payload.decisionText.trim() : message.content.slice(0, 500),
      alternatives: Array.isArray(payload.alternatives) ? payload.alternatives.filter((item): item is string => typeof item === 'string') : [],
      rationale: typeof payload.rationale === 'string' ? payload.rationale : undefined,
      consequences: Array.isArray(payload.consequences) ? payload.consequences.filter((item): item is string => typeof item === 'string') : [],
      participants: [],
      relatedDecisions: [],
    });
    this.appendAuditLog({
      actorType: 'human',
      actorId: 'user',
      action: 'decision.created',
      entityType: 'decision',
      entityId: decision.id,
      detailJson: { sourceThreadId: decision.sourceThreadId },
    });
    return json(decision, 201);
  }

  private createDocumentFromMessage(messageId: string, body: unknown): Response {
    const message = this.getMessage(messageId);
    if (!message) return json({ error: 'Message not found' }, 404);
    const payload = (body ?? {}) as Record<string, unknown>;
    const kind = typeof payload.kind === 'string' ? payload.kind : 'adr';
    const parsedKind = DocumentKindSchema.safeParse(kind);
    if (!parsedKind.success) return json({ error: 'Invalid document kind' }, 400);
    const document = this.writeDocument({
      id: crypto.randomUUID(),
      kind: parsedKind.data,
      title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : message.content.slice(0, 120),
      status: 'draft',
      content: typeof payload.content === 'string' ? payload.content : message.content,
      sourceThreadId: message.threadRootId ?? message.id,
      sourceChannelId: message.channelId,
      author: { actorType: 'human', actorId: 'user' },
      authorName: 'user',
      reviewers: [],
      relatedDecisions: Array.isArray(payload.relatedDecisions) ? payload.relatedDecisions.filter((item): item is string => typeof item === 'string') : [],
      relatedTasks: Array.isArray(payload.relatedTasks) ? payload.relatedTasks.filter((item): item is string => typeof item === 'string') : [],
    });
    this.appendAuditLog({
      actorType: 'human',
      actorId: 'user',
      action: 'document.created',
      entityType: 'document',
      entityId: document.id,
      detailJson: { sourceThreadId: document.sourceThreadId, kind: document.kind },
    });
    return json(document, 201);
  }

  private createGoalFromMessage(messageId: string, body: unknown): Response {
    const message = this.getMessage(messageId);
    if (!message) return json({ error: 'Message not found' }, 404);
    const parsed = MessageToGoalBriefRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const goal = this.createGoal({
      id: crypto.randomUUID(),
      channelId: message.channelId,
      sourceMessageId: message.id,
      requesterName: parsed.data.requesterName,
      objective: parsed.data.objective ?? message.content.slice(0, 240),
      background: parsed.data.background,
      successCriteria: parsed.data.successCriteria,
      constraints: parsed.data.constraints,
      assumptions: parsed.data.assumptions,
      risks: parsed.data.risks,
      status: 'draft',
    });
    this.broadcast({ type: 'goal:update', goal });
    return json(goal, 201);
  }

  private createTasksFromGoal(goalId: string, body: unknown): Response {
    const goal = this.getGoal(goalId);
    if (!goal) return json({ error: 'Goal not found' }, 404);
    const parsed = CreateGoalTasksRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const tasks = parsed.data.tasks.map((draft) => {
      const task = this.createTask({
        id: crypto.randomUUID(),
        channelId: goal.channelId,
        messageId: goal.sourceMessageId,
        title: draft.title,
        status: 'backlog',
        creatorName: parsed.data.creatorName,
        assigneeId: draft.assigneeId,
        owner: draft.assigneeId ? { actorType: 'agent', actorId: draft.assigneeId } : undefined,
        type: 'feature',
        acceptanceCriteria: draft.acceptanceCriteria.length > 0 ? draft.acceptanceCriteria : goal.successCriteria,
        constraints: goal.constraints,
        dependsOn: draft.dependencies,
        isBlocked: false,
        sourceChannelId: goal.channelId,
        sourceThreadId: goal.sourceMessageId,
        context: {
          goalId: goal.id,
          goalObjective: goal.objective,
          goal: goal.objective,
          background: goal.background.join('\n'),
          acceptanceCriteria: draft.acceptanceCriteria.length > 0 ? draft.acceptanceCriteria : goal.successCriteria,
          constraints: goal.constraints,
          assumptions: goal.assumptions,
          risks: goal.risks,
          dependencies: draft.dependencies,
          artifacts: draft.artifacts,
          sourceMessageIds: goal.sourceMessageId ? [goal.sourceMessageId] : undefined,
        },
      });
      this.broadcast({ type: 'task:update', task });
      this.notifyTaskAssignee(task);
      return task;
    });
    return json({ tasks }, 201);
  }

  private archiveGoal(goalId: string, ownerAgentId?: string): KnowledgeEntry | undefined {
    const goal = this.getGoal(goalId);
    if (!goal) return undefined;
    const tasks = this.listTasks({ channelId: goal.channelId }).filter((task) => task.context?.goalId === goal.id);
    const reviews = tasks.flatMap((task) => task.context?.reviews ?? []);
    const evidence = reviews.flatMap((review) => review.evidence);
    const body = [
      `# ${goal.objective}`,
      '',
      '## Success Criteria',
      ...goal.successCriteria.map((item) => `- ${item}`),
      '',
      '## Tasks',
      ...tasks.map((task) => `- [${task.status}] ${task.title}`),
      '',
      '## Review Evidence',
      ...(evidence.length > 0 ? evidence.map((item) => `- ${item}`) : ['- No review evidence recorded.']),
    ].join('\n');
    const entry = this.writeKnowledgeEntry({
      id: crypto.randomUUID(),
      kind: 'project_archive',
      title: `Archive: ${goal.objective}`.slice(0, 200),
      summary: `${tasks.length} tasks archived for goal ${goal.id}.`,
      body,
      tags: ['project_archive', goal.status, goal.channelId],
      sourceRefs: [`goal:${goal.id}`, ...tasks.map((task) => `task:${task.id}`), ...reviews.map((review) => `review:${review.id}`)],
      ownerAgentId,
      status: 'active',
    });
    this.broadcast({ type: 'knowledge:update', entry });
    return entry;
  }

  private startGoalAlignment(messageId: string, body: unknown): Response {
    const message = this.getMessage(messageId);
    if (!message) return json({ error: 'Message not found' }, 404);
    const parsed = StartGoalAlignmentRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const objective = parsed.data.objective ?? message.content.slice(0, 240);
    const recommendation = recommendAgentsForGoal(objective, this.listAgents());
    const questions = buildClarifyingQuestions(message);
    const riskLevel = inferGoalRiskLevel(message);
    const alignment = this.createGoalAlignment({
      id: crypto.randomUUID(),
      channelId: message.channelId,
      threadRootId: message.threadRootId ?? message.id,
      sourceMessageId: message.id,
      status: questions.length > 0 || riskLevel !== 'low' ? 'needs_clarification' : 'awaiting_confirmation',
      objective,
      questions,
      answers: [],
      successCriteria: ['A confirmed plan exists with clear task owners and acceptance criteria.'],
      constraints: riskLevel === 'high' ? ['Wait for explicit user confirmation before execution.'] : [],
      planSummary: buildPlanSummary(objective, recommendation, riskLevel),
      taskDrafts: buildTaskDrafts(objective, recommendation),
      recommendedAgentIds: recommendation.ownerAgentIds,
      reviewerAgentIds: recommendation.reviewerAgentIds,
      recommendationReasons: recommendation.reasons,
      gaps: recommendation.gaps,
      riskLevel,
    });
    this.broadcast({ type: 'goal-alignment:update', alignment });
    this.createMessage({
      id: crypto.randomUUID(),
      channelId: alignment.channelId,
      senderName: 'system',
      content: [
        `Goal alignment started by ${parsed.data.requesterName}: ${alignment.objective}`,
        alignment.planSummary,
        alignment.questions.length > 0 ? `Clarifying questions:\n${alignment.questions.map((question) => `- ${question}`).join('\n')}` : 'Plan is ready for confirmation.',
      ].filter(Boolean).join('\n\n'),
      threadRootId: alignment.threadRootId,
    });
    return json(alignment, 201);
  }

  private patchGoalAlignment(id: string, body: unknown): Response {
    const parsed = PatchGoalAlignmentRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const alignment = this.updateGoalAlignment(id, parsed.data);
    if (!alignment) return json({ error: 'Goal alignment not found' }, 404);
    this.broadcast({ type: 'goal-alignment:update', alignment });
    return json(alignment);
  }

  private cancelGoalAlignment(id: string): Response {
    const alignment = this.updateGoalAlignment(id, { status: 'cancelled' });
    if (!alignment) return json({ error: 'Goal alignment not found' }, 404);
    this.broadcast({ type: 'goal-alignment:update', alignment });
    return json(alignment);
  }

  private confirmGoalAlignment(id: string, body: unknown): Response {
    const parsed = ConfirmGoalAlignmentRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const alignment = this.getGoalAlignment(id);
    if (!alignment) return json({ error: 'Goal alignment not found' }, 404);
    if (alignment.status === 'cancelled') return json({ error: 'Goal alignment is cancelled' }, 409);
    const goal = alignment.goalId
      ? this.updateGoal(alignment.goalId, {
          objective: alignment.objective,
          successCriteria: alignment.successCriteria,
          constraints: alignment.constraints,
          status: 'confirmed',
        })
      : this.createGoal({
          id: crypto.randomUUID(),
          channelId: alignment.channelId,
          sourceMessageId: alignment.sourceMessageId,
          requesterName: parsed.data.requesterName,
          objective: alignment.objective,
          background: alignment.answers,
          successCriteria: alignment.successCriteria,
          constraints: alignment.constraints,
          assumptions: alignment.gaps,
          risks: alignment.riskLevel === 'low' ? [] : [`${alignment.riskLevel} risk plan; keep user confirmation explicit.`],
          status: 'confirmed',
        });
    if (!goal) return json({ error: 'Goal not found' }, 404);
    this.broadcast({ type: 'goal:update', goal });
    const tasks = alignment.taskDrafts.map((draft) => {
      const task = this.createTask({
        id: crypto.randomUUID(),
        channelId: alignment.channelId,
        messageId: alignment.sourceMessageId,
        title: draft.title,
        status: 'backlog',
        creatorName: parsed.data.requesterName,
        assigneeId: draft.assigneeId,
        owner: draft.assigneeId ? { actorType: 'agent', actorId: draft.assigneeId } : undefined,
        type: 'feature',
        acceptanceCriteria: (draft.acceptanceCriteria?.length ?? 0) > 0 ? draft.acceptanceCriteria : alignment.successCriteria,
        constraints: alignment.constraints,
        dependsOn: draft.dependencies,
        isBlocked: false,
        sourceChannelId: alignment.channelId,
        sourceThreadId: alignment.threadRootId,
        context: {
          goalId: goal.id,
          goalObjective: goal.objective,
          goal: goal.objective,
          background: alignment.planSummary,
          acceptanceCriteria: (draft.acceptanceCriteria?.length ?? 0) > 0 ? draft.acceptanceCriteria : alignment.successCriteria,
          constraints: alignment.constraints,
          assumptions: alignment.gaps,
          dependencies: draft.dependencies,
          artifacts: draft.artifacts,
          sourceMessageIds: [alignment.sourceMessageId],
        },
      });
      this.broadcast({ type: 'task:update', task });
      this.notifyTaskAssignee(task);
      return task;
    });
    const updated = this.updateGoalAlignment(alignment.id, { status: 'confirmed', goalId: goal.id });
    if (updated) this.broadcast({ type: 'goal-alignment:update', alignment: updated });
    this.createMessage({
      id: crypto.randomUUID(),
      channelId: alignment.channelId,
      senderName: 'system',
      content: `Goal plan confirmed: ${goal.objective}\nTasks created: ${tasks.map((task) => `#${task.id.slice(0, 6)} ${task.title}`).join('; ')}`,
      threadRootId: alignment.threadRootId,
    });
    return json({ alignment: updated ?? alignment, goal, tasks }, 201);
  }

  private async handleInternalAgentRequest(request: Request, url: URL): Promise<Response> {
    const match = url.pathname.match(/^\/internal\/agent\/([^/]+)(\/.*)$/);
    if (!match) return json({ error: 'Not found' }, 404);
    const agentId = decodeURIComponent(match[1]);
    const path = match[2];
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);

    const authResp = this.requireAgentAuth(request, agentId);
    if (authResp) return authResp;

    if (request.method === 'GET' && path === '/auth/whoami') return json({ agent });

    if (request.method === 'GET' && path === '/server/info') {
      return json({
        agent,
        channels: this.listChannels(),
        agents: this.listAgents(),
        version: createVersionInfo('cloudflare-hub', {
          version: this.env.CREWDEN_VERSION,
          commit: this.env.CREWDEN_COMMIT_SHA,
          build: this.env.CREWDEN_BUILD_ID,
        }),
      });
    }

    if (request.method === 'GET' && path === '/agents/resolve') {
      const parsed = InternalAgentResolveRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
      if (parsed.data.query && !parsed.data.role && (!parsed.data.capabilities || parsed.data.capabilities.length === 0)) {
        return json(resolveAgentReference(parsed.data.query, this.listAgents()));
      }
      return json(resolveAgents(this.listAgents(), {
        role: parsed.data.role,
        capabilities: parsed.data.capabilities,
        excludeAgentId: parsed.data.excludeAgentId,
        mustBeIdle: parsed.data.mustBeIdle,
        maxResults: parsed.data.maxResults,
      }));
    }

    const internalAgentPatchMatch = path.match(/^\/agents\/([^/]+)$/);
    if (internalAgentPatchMatch && request.method === 'PATCH') {
      return this.patchAgent(decodeURIComponent(internalAgentPatchMatch[1]), await request.json());
    }

    if (request.method === 'GET' && path === '/messages/check') {
      return json({
        channels: this.listChannels().map((channel) => {
          const latest = this.listRecentMessages(channel.id, 1)[0];
          return { channelId: channel.id, channelName: channel.name, count: latest ? 1 : 0, latestMessage: latest };
        }),
        dms: this.listDirectMessageThreads(agent.id).map((thread) => ({
          otherAgentId: thread.otherAgentId,
          count: 1,
          latestMessage: thread.lastMessage,
        })),
      });
    }

    if (request.method === 'GET' && path === '/messages/read') {
      const parsed = InternalMessageReadRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
      const channel = this.findChannel(parsed.data.channel);
      if (!channel) return json({ error: 'Channel not found' }, 404);
      return json(this.listRecentMessages(channel.id, parsed.data.limit));
    }

    if (request.method === 'POST' && path === '/messages/send') {
      return this.createInternalMessage(agent, request);
    }

    if (request.method === 'POST' && path === '/dms/send') {
      return this.createInternalDirectMessage(agent, request);
    }

    if (request.method === 'POST' && path === '/delegate') {
      return this.createInternalDelegation(agent, request);
    }

    if (request.method === 'GET' && path === '/tasks') {
      const parsed = InternalTaskListRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
      const channel = parsed.data.channel ? this.findChannel(parsed.data.channel) : undefined;
      if (parsed.data.channel && !channel) return json({ error: 'Channel not found' }, 404);
      return json(this.listTasks({
        channelId: channel?.id,
        status: parsed.data.status,
        assigneeId: parsed.data.all ? undefined : agent.id,
      }));
    }

    if (request.method === 'GET' && path === '/inbox') {
      const parsed = InternalInboxRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
      return json(this.buildInbox(agent, parsed.data.limit));
    }

    if (request.method === 'GET' && path === '/work') {
      const parsed = InternalInboxRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
      return json({ inbox: this.buildInbox(agent, parsed.data.limit), next: 'Work assigned tasks first, claim only matching open tasks, and report blockers with task block/escalate.' });
    }

    if (request.method === 'GET' && path === '/reviews') {
      const parsed = InternalReviewListRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
      const reviews = this.listTasks().flatMap((task) => (task.context?.reviews ?? []).map((review) => ({ ...review, task })));
      return json(reviews.filter((review) => parsed.data.all || review.reviewerAgentId === agent.id));
    }

    if (request.method === 'GET' && path === '/knowledge') {
      const parsed = SearchKnowledgeRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
      return json(this.searchKnowledge(parsed.data));
    }

    const internalKnowledgeMatch = path.match(/^\/knowledge\/([^/]+)$/);
    if (request.method === 'GET' && internalKnowledgeMatch) {
      const entry = this.getKnowledgeEntry(decodeURIComponent(internalKnowledgeMatch[1]));
      if (!entry) return json({ error: 'Knowledge entry not found' }, 404);
      return json(entry);
    }

    if (request.method === 'POST' && path === '/knowledge') {
      return this.createKnowledgeEntry({
        ...(await request.json().catch(() => ({})) as object),
        ownerAgentId: agent.id,
      });
    }

    if (request.method === 'GET' && path === '/goals') {
      const parsed = InternalGoalListRequestSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
      if (!parsed.success) return json({ error: 'Invalid query', issues: parsed.error.issues }, 400);
      const channel = parsed.data.channel ? this.findChannel(parsed.data.channel) : undefined;
      if (parsed.data.channel && !channel) return json({ error: 'Channel not found' }, 404);
      return json(this.listGoals({ channelId: channel?.id, status: parsed.data.status }));
    }

    if (request.method === 'POST' && path === '/goals/align') {
      const parsed = InternalGoalAlignRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      const sourceMessageId = url.searchParams.get('messageId') ?? '';
      if (!sourceMessageId) return json({ error: 'Missing messageId' }, 400);
      return this.startGoalAlignment(sourceMessageId, { ...parsed.data, requesterName: agent.displayName ?? agent.name });
    }

    if (request.method === 'POST' && path === '/goals') {
      const parsed = InternalGoalCreateRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      const channel = this.findChannel(parsed.data.channel);
      if (!channel) return json({ error: 'Channel not found' }, 404);
      const goal = this.createGoal({
        id: crypto.randomUUID(),
        channelId: channel.id,
        requesterName: agent.displayName ?? agent.name,
        objective: parsed.data.objective,
        background: parsed.data.background,
        successCriteria: parsed.data.successCriteria,
        constraints: parsed.data.constraints,
        assumptions: parsed.data.assumptions,
        risks: parsed.data.risks,
        status: 'draft',
      });
      this.broadcast({ type: 'goal:update', goal });
      return json(goal, 201);
    }

    const goalMatch = path.match(/^\/goals\/([^/]+)$/);
    if (request.method === 'GET' && goalMatch) {
      const goal = this.getGoal(decodeURIComponent(goalMatch[1]));
      if (!goal) return json({ error: 'Goal not found' }, 404);
      return json({ goal, tasks: this.listTasks({ channelId: goal.channelId }).filter((task) => task.context?.goalId === goal.id) });
    }

    const goalTasksMatch = path.match(/^\/goals\/([^/]+)\/tasks$/);
    if (request.method === 'POST' && goalTasksMatch) {
      const goal = this.getGoal(decodeURIComponent(goalTasksMatch[1]));
      if (!goal) return json({ error: 'Goal not found' }, 404);
      const parsed = InternalGoalCreateTasksRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      const tasks = parsed.data.tasks.map((draft) => {
        const task = this.createTask({
          id: crypto.randomUUID(),
          channelId: goal.channelId,
          messageId: goal.sourceMessageId,
          title: draft.title,
          status: 'backlog',
          creatorName: parsed.data.creatorName,
          creator: { actorType: 'agent', actorId: agent.id },
          assigneeId: draft.assigneeId,
          owner: draft.assigneeId ? { actorType: 'agent', actorId: draft.assigneeId } : undefined,
          type: 'feature',
          acceptanceCriteria: draft.acceptanceCriteria.length > 0 ? draft.acceptanceCriteria : goal.successCriteria,
          constraints: goal.constraints,
          dependsOn: draft.dependencies,
          isBlocked: false,
          sourceChannelId: goal.channelId,
          sourceThreadId: goal.sourceMessageId,
          context: {
            goalId: goal.id,
            goalObjective: goal.objective,
            goal: goal.objective,
            background: goal.background.join('\n'),
            acceptanceCriteria: draft.acceptanceCriteria.length > 0 ? draft.acceptanceCriteria : goal.successCriteria,
            constraints: goal.constraints,
            assumptions: goal.assumptions,
            risks: goal.risks,
            dependencies: draft.dependencies,
            artifacts: draft.artifacts,
            sourceMessageIds: goal.sourceMessageId ? [goal.sourceMessageId] : undefined,
          },
        });
        this.broadcast({ type: 'task:update', task });
        this.notifyTaskAssignee(task);
        return task;
      });
      return json({ tasks }, 201);
    }

    const alignmentMatch = path.match(/^\/goal-alignments\/([^/]+)$/);
    if (request.method === 'GET' && alignmentMatch) {
      const alignment = this.getGoalAlignment(decodeURIComponent(alignmentMatch[1]));
      if (!alignment) return json({ error: 'Goal alignment not found' }, 404);
      return json(alignment);
    }

    if (request.method === 'POST' && alignmentMatch) {
      const parsed = InternalGoalAlignmentPatchRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      const alignment = this.updateGoalAlignment(decodeURIComponent(alignmentMatch[1]), parsed.data);
      if (!alignment) return json({ error: 'Goal alignment not found' }, 404);
      this.broadcast({ type: 'goal-alignment:update', alignment });
      return json(alignment);
    }

    const alignmentConfirmMatch = path.match(/^\/goal-alignments\/([^/]+)\/confirm$/);
    if (request.method === 'POST' && alignmentConfirmMatch) {
      return this.confirmGoalAlignment(decodeURIComponent(alignmentConfirmMatch[1]), { requesterName: agent.displayName ?? agent.name });
    }

    const internalGoalArchiveMatch = path.match(/^\/goals\/([^/]+)\/archive$/);
    if (request.method === 'POST' && internalGoalArchiveMatch) {
      const entry = this.archiveGoal(decodeURIComponent(internalGoalArchiveMatch[1]), agent.id);
      if (!entry) return json({ error: 'Goal not found' }, 404);
      return json(entry, 201);
    }

    if (request.method === 'GET' && path === '/reminders') {
      return json(this.listReminders(agent.id));
    }

    if (request.method === 'POST' && path === '/reminders') {
      const parsed = CreateReminderRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      const channel = this.findChannel(parsed.data.channelId);
      if (!channel) return json({ error: 'Channel not found' }, 404);
      const reminder = this.createReminder({
        id: crypto.randomUUID(),
        agentId: agent.id,
        channelId: channel.id,
        message: parsed.data.message,
        triggerAt: parsed.data.triggerAt,
        status: 'pending',
      });
      this.broadcast({ type: 'reminder:update', reminder });
      return json(reminder, 201);
    }

    const reminderCancelMatch = path.match(/^\/reminders\/([^/]+)\/cancel$/);
    if (request.method === 'POST' && reminderCancelMatch) {
      const existing = this.getReminder(decodeURIComponent(reminderCancelMatch[1]));
      if (!existing || existing.agentId !== agent.id) return json({ error: 'Reminder not found' }, 404);
      const reminder = this.updateReminder(existing.id, { status: 'cancelled' });
      if (reminder) this.broadcast({ type: 'reminder:update', reminder });
      return json(reminder);
    }

    const taskMatch = path.match(/^\/tasks\/([^/]+)$/);
    if (request.method === 'GET' && taskMatch) {
      const task = this.getTask(decodeURIComponent(taskMatch[1]));
      if (!task) return json({ error: 'Task not found' }, 404);
      if (task.assigneeId && task.assigneeId !== agent.id) return json({ error: 'Task is assigned to another agent' }, 403);
      return json(task);
    }

    const internalTaskReviewsMatch = path.match(/^\/tasks\/([^/]+)\/reviews$/);
    if (request.method === 'POST' && internalTaskReviewsMatch) {
      return this.createTaskReview(decodeURIComponent(internalTaskReviewsMatch[1]), {
        ...(await request.json().catch(() => ({})) as object),
        requesterAgentId: agent.id,
      }, agent.id);
    }

    const internalReviewApproveMatch = path.match(/^\/reviews\/([^/]+)\/approve$/);
    if (request.method === 'POST' && internalReviewApproveMatch) {
      return this.reviewDecision(decodeURIComponent(internalReviewApproveMatch[1]), {
        ...(await request.json().catch(() => ({})) as object),
        reviewerAgentId: agent.id,
      }, 'approved', agent.id);
    }

    const internalReviewChangesMatch = path.match(/^\/reviews\/([^/]+)\/request-changes$/);
    if (request.method === 'POST' && internalReviewChangesMatch) {
      return this.reviewDecision(decodeURIComponent(internalReviewChangesMatch[1]), {
        ...(await request.json().catch(() => ({})) as object),
        reviewerAgentId: agent.id,
      }, 'changes_requested', agent.id);
    }

    const taskUpdateMatch = path.match(/^\/tasks\/([^/]+)\/update$/);
    if (request.method === 'POST' && taskUpdateMatch) {
      const existing = this.getTask(decodeURIComponent(taskUpdateMatch[1]));
      if (!existing) return json({ error: 'Task not found' }, 404);
      if (existing.assigneeId && existing.assigneeId !== agent.id) return json({ error: 'Task is assigned to another agent' }, 403);
      const parsed = InternalTaskUpdateRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      if (parsed.data.status && !isTaskTransitionAllowed(existing.status, parsed.data.status)) {
        return json({ error: 'Invalid task status transition', from: existing.status, to: parsed.data.status }, 422);
      }
      const dependencyError = this.validateTaskDependencies(existing.id, parsed.data.context?.blockedByTaskIds);
      if (dependencyError) return json({ error: dependencyError }, 422);
      if (parsed.data.status === 'in_progress') {
        const blockersError = this.validateBlockersComplete({ ...existing, ...parsed.data });
        if (blockersError) return json({ error: blockersError }, 422);
      }
      const task = this.updateTask(existing.id, parsed.data);
      if (!task) return json({ error: 'Task not found' }, 404);
      if (parsed.data.status && parsed.data.status !== existing.status) {
        this.appendAuditLog({
          actorType: 'agent',
          actorId: agent.id,
          action: 'task.status_changed',
          entityType: 'task',
          entityId: task.id,
          taskId: task.id,
          agentId: agent.id,
          detailJson: { from: existing.status, to: task.status },
        });
      }
      this.broadcast({ type: 'task:update', task });
      return json(task);
    }

    const taskClaimMatch = path.match(/^\/tasks\/([^/]+)\/claim$/);
    if (request.method === 'POST' && taskClaimMatch) {
      const existing = this.getTask(decodeURIComponent(taskClaimMatch[1]));
      if (!existing) return json({ error: 'Task not found' }, 404);
      if (existing.assigneeId && existing.assigneeId !== agent.id) return json({ error: 'Task is assigned to another agent' }, 409);
      const shouldAcknowledge = !existing.assigneeId;
      const task = this.updateTask(existing.id, {
        assigneeId: agent.id,
        owner: { actorType: 'agent', actorId: agent.id },
        status: existing.status === 'backlog' || existing.status === 'ready' ? 'assigned' : existing.status,
        context: appendProgress(existing, agent.id, 'claimed', `Claimed by ${agent.displayName ?? agent.name}`),
      });
      if (!task) return json({ error: 'Task not found' }, 404);
      if (task.status !== existing.status) {
        this.appendAuditLog({
          actorType: 'agent',
          actorId: agent.id,
          action: 'task.status_changed',
          entityType: 'task',
          entityId: task.id,
          taskId: task.id,
          agentId: agent.id,
          detailJson: { from: existing.status, to: task.status, reason: 'claim' },
        });
      }
      this.broadcast({ type: 'task:update', task });
      if (shouldAcknowledge) this.createTaskClaimAcknowledgement(task, agent);
      return json(task);
    }

    const taskProgressMatch = path.match(/^\/tasks\/([^/]+)\/progress$/);
    if (request.method === 'POST' && taskProgressMatch) {
      const existing = this.getTask(decodeURIComponent(taskProgressMatch[1]));
      if (!existing) return json({ error: 'Task not found' }, 404);
      if (existing.assigneeId && existing.assigneeId !== agent.id) return json({ error: 'Task is assigned to another agent' }, 403);
      const parsed = InternalTaskProgressRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      const task = this.updateTask(existing.id, { context: appendProgress(existing, agent.id, 'heartbeat', parsed.data.detail) });
      if (!task) return json({ error: 'Task not found' }, 404);
      this.broadcast({ type: 'task:update', task });
      return json(task);
    }

    const taskBlockMatch = path.match(/^\/tasks\/([^/]+)\/block$/);
    if (request.method === 'POST' && taskBlockMatch) {
      const existing = this.getTask(decodeURIComponent(taskBlockMatch[1]));
      if (!existing) return json({ error: 'Task not found' }, 404);
      if (existing.assigneeId && existing.assigneeId !== agent.id) return json({ error: 'Task is assigned to another agent' }, 403);
      const parsed = InternalTaskBlockRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      const context = appendProgress(existing, agent.id, 'blocked', `${parsed.data.reason}; needs: ${parsed.data.needs}`);
      const task = this.updateTask(existing.id, {
        isBlocked: true,
        blockedReason: parsed.data.reason,
        context: { ...context, blockedReason: parsed.data.reason, blockedNeeds: parsed.data.needs },
      });
      if (!task) return json({ error: 'Task not found' }, 404);
      this.broadcast({ type: 'task:update', task });
      return json(task);
    }

    const taskEscalateMatch = path.match(/^\/tasks\/([^/]+)\/escalate$/);
    if (request.method === 'POST' && taskEscalateMatch) {
      const existing = this.getTask(decodeURIComponent(taskEscalateMatch[1]));
      if (!existing) return json({ error: 'Task not found' }, 404);
      const parsed = InternalTaskEscalateRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      const context = appendProgress(existing, agent.id, 'escalated', parsed.data.reason);
      const task = this.updateTask(existing.id, { context: { ...context, escalatedReason: parsed.data.reason } });
      if (!task) return json({ error: 'Task not found' }, 404);
      this.broadcast({ type: 'task:update', task });
      const message = this.createMessage({
        id: crypto.randomUUID(),
        channelId: existing.channelId,
        senderName: agent.displayName ?? agent.name,
        agentId: agent.id,
        content: `Escalation for task "${existing.title}": ${parsed.data.reason}`,
        threadRootId: existing.messageId,
      });
      if (message.threadRootId) {
        const thread = this.getThread(message.threadRootId);
        if (thread) this.broadcast({ type: 'thread:message:new', root: thread.root, message });
      } else {
        this.broadcast({ type: 'message:new', message });
      }
      return json(task);
    }

    const taskHandoffMatch = path.match(/^\/tasks\/([^/]+)\/handoff$/);
    if (request.method === 'POST' && taskHandoffMatch) {
      const existing = this.getTask(decodeURIComponent(taskHandoffMatch[1]));
      if (!existing) return json({ error: 'Task not found' }, 404);
      if (existing.assigneeId && existing.assigneeId !== agent.id) return json({ error: 'Task is assigned to another agent' }, 403);
      const parsed = InternalTaskHandoffRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
      const target = this.findAgentByNameOrId(parsed.data.to);
      if (!target) return json({ error: 'Target agent not found' }, 404);
      const nextNote = [
        `from ${agent.displayName ?? agent.name}: ${parsed.data.notes}`,
        parsed.data.nextStep ? `next: ${parsed.data.nextStep}` : undefined,
      ].filter(Boolean).join('\n');
      const task = this.updateTask(existing.id, {
        assigneeId: target.id,
        context: {
          ...existing.context,
          goal: parsed.data.goal ?? existing.context?.goal,
          previousAgentId: agent.id,
          handoffNotes: [...(existing.context?.handoffNotes ?? []), nextNote],
        },
      });
      if (!task) return json({ error: 'Task not found' }, 404);
      this.broadcast({ type: 'task:update', task });
      this.notifyTaskAssignee(task);
      return json(task);
    }

    return json({ error: 'Not found' }, 404);
  }

  private async createInternalMessage(agent: Agent, request: Request): Promise<Response> {
    const parsed = InternalMessageSendRequestSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const channel = this.findChannel(parsed.data.channel);
    if (!channel) return json({ error: 'Channel not found' }, 404);
    let threadRootId = parsed.data.threadRootId;
    if (threadRootId) {
      const thread = this.getThread(threadRootId);
      if (!thread) return json({ error: 'Thread root not found' }, 404);
      if (thread.root.channelId !== channel.id) return json({ error: 'Thread root belongs to another channel' }, 400);
      threadRootId = thread.root.id;
    }
    const message = this.createMessage({
      id: crypto.randomUUID(),
      channelId: channel.id,
      senderName: agent.displayName ?? agent.name,
      agentId: agent.id,
      content: parsed.data.content,
      threadRootId,
    });
    if (message.threadRootId) {
      const thread = this.getThread(message.threadRootId);
      if (thread) this.broadcast({ type: 'thread:message:new', root: thread.root, message });
    } else {
      this.broadcast({ type: 'message:new', message });
    }
    return json(message, 201);
  }

  private async createInternalDirectMessage(agent: Agent, request: Request): Promise<Response> {
    const parsed = InternalDmSendRequestSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const target = this.findAgentByNameOrId(parsed.data.to);
    if (!target) return json({ error: 'Target agent not found' }, 404);
    const dm = this.createDirectMessage({
      id: crypto.randomUUID(),
      fromAgentId: agent.id,
      toAgentId: target.id,
      content: parsed.data.content,
    });
    this.broadcast({ type: 'dm:new', dm });
    this.deliverDirectMessage(target, dm);
    return json(dm, 201);
  }

  private async createInternalDelegation(agent: Agent, request: Request): Promise<Response> {
    const parsed = InternalAgentDelegateRequestSchema.safeParse(await request.json());
    if (!parsed.success) return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    const delegation = this.delegateAgent({
      fromAgentId: agent.id,
      toAgentId: parsed.data.to,
      content: parsed.data.content,
      startIfInactive: parsed.data.startIfInactive,
    });
    return json(delegation, delegation.status === 'failed' ? 202 : 201);
  }

  private createUserDirectMessage(agentId: string, otherId: string, body: unknown): Response {
    const target = this.getAgent(agentId);
    if (!target) return json({ error: 'Agent not found' }, 404);
    const parsed = CreateDirectMessageRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    }

    const dm = this.createDirectMessage({
      id: crypto.randomUUID(),
      fromAgentId: parsed.data.fromAgentId ?? otherId,
      toAgentId: target.id,
      content: parsed.data.content,
    });
    this.broadcast({ type: 'dm:new', dm });
    this.deliverDirectMessage(target, dm);
    return json(dm, 201);
  }

  private createUserDelegation(fromAgentId: string, toAgentId: string, body: unknown): Response {
    const from = this.getAgent(fromAgentId);
    if (!from) return json({ error: 'Agent not found' }, 404);
    const parsed = CreateAgentDelegationRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    }
    const delegation = this.delegateAgent({
      fromAgentId: from.id,
      toAgentId,
      content: parsed.data.content,
      startIfInactive: parsed.data.startIfInactive,
    });
    return json(delegation, delegation.status === 'failed' ? 202 : 201);
  }

  private createAgent(body: unknown): Response {
    const parsed = CreateAgentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    }
    const payload = parsed.data;

    const agent: Agent = {
      id: crypto.randomUUID(),
      name: payload.name,
      displayName: payload.displayName,
      description: payload.description,
      runtime: payload.runtime,
      model: payload.model,
      systemPrompt: payload.systemPrompt,
      envVars: payload.envVars,
      organization: payload.organization,
      machineId: payload.machineId,
      status: 'inactive',
      autoStart: false,
      createdAt: new Date().toISOString(),
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO agents
       (id, name, display_name, description, runtime, model, system_prompt, env_vars, organization, machine_id, status, auto_start, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      agent.id,
      agent.name,
      agent.displayName ?? null,
      agent.description ?? null,
      agent.runtime,
      agent.model ?? null,
      agent.systemPrompt ?? null,
      agent.envVars ? JSON.stringify(agent.envVars) : null,
      agent.organization ? JSON.stringify(agent.organization) : null,
      agent.machineId ?? null,
      agent.status,
      agent.autoStart ? 1 : 0,
      agent.createdAt
    );
    return json(agent, 201);
  }

  private patchAgent(agentId: string, body: unknown): Response {
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);
    const parsed = PatchAgentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
    }
    const runtimeError = this.validateAgentRuntimePatch(agent, parsed.data);
    if (runtimeError) return json({ error: runtimeError.error }, runtimeError.status);
    const updated = this.updateAgent(agentId, parsed.data);
    if (updated) {
      this.broadcast({ type: 'agent:update', agent: updated });
      this.broadcast({ type: 'agent:updated', agent: updated });
    }
    return json(updated);
  }

  private deleteAgent(agentId: string): Response {
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);
    if (agent.status === 'working') {
      return json({ error: 'Cannot delete agent while it is working. Stop the agent first.' }, 409);
    }
    this.ctx.storage.sql.exec('DELETE FROM agents WHERE id = ?', agentId);
    this.broadcast({ type: 'agent:deleted', agentId });
    return new Response(null, { status: 204 });
  }

  private validateAgentRuntimePatch(agent: Agent, patch: Partial<Agent>): { status: 400 | 409; error: string } | undefined {
    if (!patch.runtime && !patch.machineId) return undefined;
    if (patch.runtime && patch.runtime !== agent.runtime && ['starting', 'running', 'working'].includes(agent.status)) {
      return { status: 409, error: `Cannot change runtime while agent is ${agent.status}. Stop the agent first.` };
    }
    const runtime = patch.runtime ?? agent.runtime;
    const machineId = patch.machineId ?? agent.machineId;
    if (!machineId) return undefined;
    const machine = this.getMachine(machineId);
    if (!machine) return { status: 400, error: `Machine ${machineId} not found` };
    if (!machine.runtimes.includes(runtime)) return { status: 400, error: `Machine does not support runtime ${runtime}` };
    return undefined;
  }

  private startAgent(agentId: string): Response {
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);
    const machineId = this.resolveStartMachineId(agent);
    if (!machineId) return json({ error: 'No connected machine available for agent runtime' }, 503);

    const sent = this.sendToDaemon(machineId, {
      type: 'agent:start',
      agentId,
      config: this.toAgentRuntimeConfig(agent),
      launchId: crypto.randomUUID(),
      inboxSummary: this.buildOpenTaskSummary(agent),
    });
    if (!sent) return json({ error: 'Machine not connected' }, 503);

    const updated = this.updateAgent(agentId, { machineId, status: 'starting', autoStart: true });
    if (updated) this.broadcast({ type: 'agent:update', agent: updated });
    return json(updated);
  }

  private stopAgent(agentId: string): Response {
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);
    if (agent.machineId) this.sendToDaemon(agent.machineId, { type: 'agent:stop', agentId });
    const updated = this.updateAgent(agentId, { status: 'inactive', autoStart: false });
    if (updated) this.broadcast({ type: 'agent:update', agent: updated });
    return json(updated);
  }

  private async readAgentWorkspace(agentId: string, relPath: string): Promise<Response> {
    const agent = this.getAgent(agentId);
    if (!agent) return json({ error: 'Agent not found' }, 404);
    if (isUnsafeWorkspacePath(relPath)) return json({ error: 'Path traversal is not allowed' }, 403);

    const machineId = this.resolveStartMachineId(agent);
    if (!machineId) return json({ error: 'No connected machine available for agent workspace' }, 503);

    const result = await this.readWorkspace(machineId, agent.id, relPath);
    if (result.type === 'error') return json({ error: result.error }, result.status ?? 500);
    return json(result);
  }

  private listChannels(): Channel[] {
    return this.ctx.storage.sql.exec<Row>('SELECT id, name, created_at FROM channels ORDER BY created_at').toArray().map(toChannel);
  }

  private getChannel(id: string): Channel | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT id, name, created_at FROM channels WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toChannel(row) : undefined;
  }

  private createChannel(id: string, name: string): Channel {
    const channel: Channel = { id, name, createdAt: new Date().toISOString() };
    this.ctx.storage.sql.exec('INSERT INTO channels (id, name, created_at) VALUES (?, ?, ?)', channel.id, channel.name, channel.createdAt);
    return channel;
  }

  private deleteChannel(id: string): void {
    this.ctx.storage.sql.exec('DELETE FROM messages WHERE channel_id = ?', id);
    this.ctx.storage.sql.exec('DELETE FROM tasks WHERE channel_id = ?', id);
    this.ctx.storage.sql.exec('DELETE FROM goals WHERE channel_id = ?', id);
    this.ctx.storage.sql.exec('DELETE FROM goal_alignments WHERE channel_id = ?', id);
    this.ctx.storage.sql.exec('DELETE FROM reminders WHERE channel_id = ?', id);
    this.ctx.storage.sql.exec('DELETE FROM decisions WHERE channel_id = ?', id);
    this.ctx.storage.sql.exec('DELETE FROM documents WHERE source_channel_id = ?', id);
    this.ctx.storage.sql.exec('DELETE FROM channels WHERE id = ?', id);
  }

  private getMessage(id: string): Message | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM messages WHERE id = ? LIMIT 1', id).toArray()[0];
    if (!row) return undefined;
    const message = toMessage(row);
    if (message.threadRootId) return message;
    return this.withThreadSummary(message);
  }

  private listMessages(channelId: string): Message[] {
    const all = this.ctx.storage.sql
      .exec<Row>('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at', channelId)
      .toArray()
      .map(toMessage);
    return all.filter((message) => !message.threadRootId).map((message) => this.withThreadSummary(message, all));
  }

  private getThread(messageId: string): { root: Message; replies: Message[]; linkedDecisions?: Decision[]; linkedDocuments?: Document[] } | undefined {
    const message = this.getMessage(messageId);
    if (!message) return undefined;
    const rootId = message.threadRootId ?? message.id;
    const rootRow = this.ctx.storage.sql.exec<Row>('SELECT * FROM messages WHERE id = ? LIMIT 1', rootId).toArray()[0];
    if (!rootRow) return undefined;
    const root = toMessage(rootRow);
    const replies = this.ctx.storage.sql
      .exec<Row>('SELECT * FROM messages WHERE thread_root_id = ? ORDER BY created_at', root.id)
      .toArray()
      .map(toMessage);
    const linkedDecisions = this.ctx.storage.sql
      .exec<Row>('SELECT * FROM decisions WHERE source_thread_id = ? ORDER BY updated_at DESC', root.id)
      .toArray()
      .map(toDecision);
    const linkedDocuments = this.ctx.storage.sql
      .exec<Row>('SELECT * FROM documents WHERE source_thread_id = ? ORDER BY updated_at DESC', root.id)
      .toArray()
      .map(toDocument);
    return { root: this.withThreadSummary(root, [root, ...replies]), replies, linkedDecisions, linkedDocuments };
  }

  private withThreadSummary(message: Message, channelMessages?: Message[]): Message {
    const candidates = channelMessages ?? this.ctx.storage.sql
      .exec<Row>('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at', message.channelId)
      .toArray()
      .map(toMessage);
    const replies = candidates.filter((candidate) => candidate.threadRootId === message.id);
    if (replies.length === 0) return message;
    return {
      ...message,
      replyCount: replies.length,
      latestReplyAt: replies.at(-1)?.createdAt,
    };
  }

  private listRecentMessages(channelId: string, limit: number): Message[] {
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?', channelId, limit)
      .toArray()
      .map(toMessage)
      .reverse();
  }

  private searchMessages(query: string, limit: number) {
    const needle = query.toLowerCase();
    const channelMap = new Map(this.listChannels().map((channel) => [channel.id, channel.name]));
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM messages ORDER BY created_at DESC LIMIT 1000')
      .toArray()
      .map(toMessage)
      .filter((message) => message.content.toLowerCase().includes(needle))
      .slice(0, limit)
      .map((message) => ({ ...message, channelName: channelMap.get(message.channelId) ?? message.channelId }));
  }

  private findChannel(value: string): Channel | undefined {
    const byId = this.getChannel(value);
    if (byId) return byId;
    return this.listChannels().find((channel) => channel.name === value);
  }

  private listTasks(filter: { channelId?: string; status?: TaskStatus; assigneeId?: string } = {}): Task[] {
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM tasks ORDER BY created_at')
      .toArray()
      .map(toTask)
      .filter((task) =>
        (!filter.channelId || task.channelId === filter.channelId) &&
        (!filter.status || task.status === filter.status) &&
        (!filter.assigneeId || task.assigneeId === filter.assigneeId)
      );
  }

  private getTask(id: string): Task | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM tasks WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toTask(row) : undefined;
  }

  private buildInbox(agent: Agent, limit: number): AgentInboxItem[] {
    const items: AgentInboxItem[] = [];
    for (const task of this.listTasks()) {
      if (task.status === 'done') continue;
      for (const review of task.context?.reviews ?? []) {
        if (review.status === 'requested' && review.reviewerAgentId === agent.id) {
          items.push({
            id: `review_request:${review.id}`,
            kind: 'review_request',
            agentId: agent.id,
            channelId: task.channelId,
            messageId: task.messageId,
            taskId: task.id,
            goalId: task.context?.goalId,
            priority: isHighRiskTask(task) ? 'high' : 'normal',
            summary: `Review requested: ${task.title}`,
            createdAt: review.createdAt,
          });
        }
      }
      if (task.assigneeId === agent.id) {
        items.push({
          id: `assigned_task:${task.id}`,
          kind: task.context?.blockedReason ? 'blocked_escalation' : 'assigned_task',
          agentId: agent.id,
          channelId: task.channelId,
          messageId: task.messageId,
          taskId: task.id,
          goalId: task.context?.goalId,
          priority: task.context?.blockedReason ? 'high' : 'normal',
          summary: task.context?.blockedReason ? `Blocked task: ${task.title} (${task.context.blockedReason})` : `Assigned task: ${task.title}`,
          createdAt: task.updatedAt,
        });
      } else if (!task.assigneeId && matchesAgentCapability(agent, task)) {
        items.push({
          id: `claimable_task:${task.id}`,
          kind: 'claimable_task',
          agentId: agent.id,
          channelId: task.channelId,
          messageId: task.messageId,
          taskId: task.id,
          goalId: task.context?.goalId,
          priority: 'normal',
          summary: `Claimable task matching your role/capability: ${task.title}`,
          createdAt: task.createdAt,
        });
      }
    }
    for (const reminder of this.listReminders(agent.id).filter((candidate) => candidate.status === 'pending')) {
      items.push({
        id: `reminder:${reminder.id}`,
        kind: 'reminder',
        agentId: agent.id,
        channelId: reminder.channelId,
        priority: 'normal',
        summary: `Reminder: ${reminder.message}`,
        dueAt: reminder.triggerAt,
        createdAt: reminder.createdAt,
      });
    }
    for (const thread of this.listDirectMessageThreads(agent.id).slice(0, 10)) {
      items.push({
        id: `dm:${thread.lastMessage.id}`,
        kind: 'dm',
        agentId: agent.id,
        priority: 'normal',
        summary: `DM from ${thread.otherAgentId}: ${thread.lastMessage.content.slice(0, 120)}`,
        createdAt: thread.lastMessage.createdAt,
      });
    }
    return items.sort(compareInboxItems).slice(0, limit);
  }

  private listGoals(filter: { channelId?: string; status?: GoalBriefStatus } = {}): GoalBrief[] {
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM goals ORDER BY created_at')
      .toArray()
      .map(toGoal)
      .filter((goal) =>
        (!filter.channelId || goal.channelId === filter.channelId) &&
        (!filter.status || goal.status === filter.status)
      );
  }

  private getGoal(id: string): GoalBrief | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM goals WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toGoal(row) : undefined;
  }

  private listGoalAlignments(filter: { channelId?: string; status?: GoalAlignmentStatus } = {}): GoalAlignment[] {
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM goal_alignments ORDER BY created_at')
      .toArray()
      .map(toGoalAlignment)
      .filter((alignment) =>
        (!filter.channelId || alignment.channelId === filter.channelId) &&
        (!filter.status || alignment.status === filter.status)
      );
  }

  private getGoalAlignment(id: string): GoalAlignment | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM goal_alignments WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toGoalAlignment(row) : undefined;
  }

  private listReminders(agentId?: string): Reminder[] {
    const rows = this.ctx.storage.sql.exec<Row>('SELECT * FROM reminders ORDER BY trigger_at').toArray().map(toReminder);
    return rows.filter((reminder) => !agentId || reminder.agentId === agentId);
  }

  private getReminder(id: string): Reminder | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM reminders WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toReminder(row) : undefined;
  }

  private searchKnowledge(filter: { query?: string; kind?: KnowledgeKind; tags?: string[]; limit?: number } = {}): KnowledgeSearchResult[] {
    const query = (filter.query ?? '').trim().toLowerCase();
    const tags = filter.tags ?? [];
    return this.ctx.storage.sql.exec<Row>('SELECT * FROM knowledge_entries ORDER BY updated_at DESC').toArray()
      .map(toKnowledgeEntry)
      .map((entry) => ({ entry, score: scoreKnowledge(entry, query), reason: query ? `Matched "${query}"` : 'Recent knowledge' }))
      .filter((result) => (!filter.kind || result.entry.kind === filter.kind) && tags.every((tag) => result.entry.tags.includes(tag)))
      .filter((result) => !query || (result.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || new Date(b.entry.updatedAt).getTime() - new Date(a.entry.updatedAt).getTime())
      .slice(0, filter.limit ?? 20);
  }

  private getKnowledgeEntry(id: string): KnowledgeEntry | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM knowledge_entries WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toKnowledgeEntry(row) : undefined;
  }

  private listDecisions(filter: { channelId?: string; status?: DecisionStatus } = {}): Decision[] {
    return this.ctx.storage.sql.exec<Row>('SELECT * FROM decisions ORDER BY updated_at DESC').toArray()
      .map(toDecision)
      .filter((decision) =>
        (!filter.channelId || decision.channelId === filter.channelId) &&
        (!filter.status || decision.status === filter.status)
      );
  }

  private getDecision(id: string): Decision | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM decisions WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toDecision(row) : undefined;
  }

  private listDocuments(filter: { sourceChannelId?: string; kind?: DocumentKind; status?: DocumentStatus } = {}): Document[] {
    return this.ctx.storage.sql.exec<Row>('SELECT * FROM documents ORDER BY updated_at DESC').toArray()
      .map(toDocument)
      .filter((document) =>
        (!filter.sourceChannelId || document.sourceChannelId === filter.sourceChannelId) &&
        (!filter.kind || document.kind === filter.kind) &&
        (!filter.status || document.status === filter.status)
      );
  }

  private getDocument(id: string): Document | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM documents WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toDocument(row) : undefined;
  }

  private createMessage(message: NewMessage): Message {
    const created: Message = {
      ...message,
      actorType: message.actorType ?? (message.agentId ? 'agent' : 'human'),
      actorId: message.actorId ?? message.agentId ?? message.senderName,
      createdAt: new Date().toISOString(),
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (id, channel_id, sender_name, content, agent_id, actor_type, actor_id, thread_root_id, mentions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.channelId,
      created.senderName,
      created.content,
      created.agentId ?? null,
      created.actorType,
      created.actorId,
      created.threadRootId ?? null,
      created.mentions ? JSON.stringify(created.mentions) : null,
      created.createdAt
    );
    return created;
  }

  private createTaskClaimAcknowledgement(task: Task, agent: Agent): void {
    const message = this.createMessage({
      id: crypto.randomUUID(),
      channelId: task.channelId,
      senderName: agent.displayName ?? agent.name,
      agentId: agent.id,
      content: `@user I have claimed task #${task.id} "${task.title}" and I am starting now. I will post progress or blockers here.`,
      threadRootId: task.messageId,
      mentions: [{ type: 'user', id: 'user', label: 'user' }],
    });
    if (message.threadRootId) {
      const thread = this.getThread(message.threadRootId);
      if (thread) this.broadcast({ type: 'thread:message:new', root: thread.root, message });
    } else {
      this.broadcast({ type: 'message:new', message });
    }
  }

  private parseMentions(content: string): Mention[] | undefined {
    const mentions = new Map<string, Mention>();
    if (/@user\b/.test(content)) mentions.set('user:user', { type: 'user', id: 'user', label: 'user' });
    for (const agent of this.listAgents()) {
      const labels = [agent.displayName, agent.name].filter(Boolean) as string[];
      for (const label of labels) {
        if (content.includes(`@${label}`)) {
          mentions.set(`agent:${agent.id}`, { type: 'agent', id: agent.id, label });
          break;
        }
      }
    }
    return mentions.size ? [...mentions.values()] : undefined;
  }

  private createTask(task: NewTask): Task {
    const now = new Date().toISOString();
    const owner = task.owner ?? (task.assigneeId ? { actorType: 'agent' as const, actorId: task.assigneeId } : undefined);
    const created: Task = {
      ...task,
      title: task.title.slice(0, 200),
      status: normalizeTaskStatus(task.status),
      type: task.type ?? 'feature',
      creator: task.creator ?? { actorType: 'human', actorId: task.creatorName },
      owner,
      assigneeId: task.assigneeId ?? (owner?.actorType === 'agent' ? owner.actorId : undefined),
      isBlocked: task.isBlocked ?? false,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO tasks (id, channel_id, message_id, title, status, type, creator_name, creator_type, creator_id, assignee_id, owner_type, owner_id, reviewer_type, reviewer_id, acceptance_criteria, definition_of_done, constraints, depends_on, is_blocked, blocked_reason, source_channel_id, source_thread_id, context, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.channelId,
      created.messageId ?? null,
      created.title,
      created.status,
      created.type,
      created.creatorName,
      created.creator.actorType,
      created.creator.actorId,
      created.assigneeId ?? null,
      created.owner?.actorType ?? null,
      created.owner?.actorId ?? null,
      created.reviewer?.actorType ?? null,
      created.reviewer?.actorId ?? null,
      created.acceptanceCriteria ? JSON.stringify(created.acceptanceCriteria) : null,
      created.definitionOfDone ? JSON.stringify(created.definitionOfDone) : null,
      created.constraints ? JSON.stringify(created.constraints) : null,
      created.dependsOn ? JSON.stringify(created.dependsOn) : null,
      created.isBlocked ? 1 : 0,
      created.blockedReason ?? null,
      created.sourceChannelId ?? null,
      created.sourceThreadId ?? null,
      created.context ? JSON.stringify(created.context) : null,
      created.version,
      created.createdAt,
      created.updatedAt
    );
    return created;
  }

  private createGoal(goal: Omit<GoalBrief, 'createdAt' | 'updatedAt'>): GoalBrief {
    const now = new Date().toISOString();
    const created: GoalBrief = { ...goal, createdAt: now, updatedAt: now };
    this.ctx.storage.sql.exec(
      `INSERT INTO goals (id, channel_id, source_message_id, requester_name, objective, background, success_criteria, constraints, assumptions, risks, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.channelId,
      created.sourceMessageId ?? null,
      created.requesterName,
      created.objective,
      JSON.stringify(created.background),
      JSON.stringify(created.successCriteria),
      JSON.stringify(created.constraints),
      JSON.stringify(created.assumptions),
      JSON.stringify(created.risks),
      created.status,
      created.createdAt,
      created.updatedAt
    );
    return created;
  }

  private createGoalAlignment(alignment: Omit<GoalAlignment, 'createdAt' | 'updatedAt'>): GoalAlignment {
    const now = new Date().toISOString();
    const created: GoalAlignment = { ...alignment, createdAt: now, updatedAt: now };
    this.ctx.storage.sql.exec(
      `INSERT INTO goal_alignments (id, channel_id, thread_root_id, source_message_id, goal_id, status, objective, questions, answers, success_criteria, constraints, plan_summary, task_drafts, recommended_agent_ids, reviewer_agent_ids, recommendation_reasons, gaps, risk_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.channelId,
      created.threadRootId,
      created.sourceMessageId,
      created.goalId ?? null,
      created.status,
      created.objective,
      JSON.stringify(created.questions),
      JSON.stringify(created.answers),
      JSON.stringify(created.successCriteria),
      JSON.stringify(created.constraints),
      created.planSummary ?? null,
      JSON.stringify(created.taskDrafts),
      JSON.stringify(created.recommendedAgentIds),
      JSON.stringify(created.reviewerAgentIds),
      JSON.stringify(created.recommendationReasons),
      JSON.stringify(created.gaps),
      created.riskLevel,
      created.createdAt,
      created.updatedAt
    );
    return created;
  }

  private createReminder(reminder: Omit<Reminder, 'createdAt'>): Reminder {
    const created: Reminder = { ...reminder, createdAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `INSERT INTO reminders (id, agent_id, channel_id, message, trigger_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.agentId,
      created.channelId,
      created.message,
      created.triggerAt,
      created.status,
      created.createdAt
    );
    return created;
  }

  private writeKnowledgeEntry(entry: Omit<KnowledgeEntry, 'createdAt' | 'updatedAt'>): KnowledgeEntry {
    const now = new Date().toISOString();
    const created: KnowledgeEntry = { ...entry, createdAt: now, updatedAt: now };
    this.ctx.storage.sql.exec(
      `INSERT INTO knowledge_entries (id, kind, title, summary, body, tags, source_refs, owner_agent_id, reviewer_agent_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.kind,
      created.title,
      created.summary,
      created.body,
      JSON.stringify(created.tags),
      JSON.stringify(created.sourceRefs),
      created.ownerAgentId ?? null,
      created.reviewerAgentId ?? null,
      created.status,
      created.createdAt,
      created.updatedAt,
    );
    return created;
  }

  private writeDecision(input: Omit<Decision, 'createdAt' | 'updatedAt'>): Decision {
    const now = new Date().toISOString();
    const created: Decision = { ...input, createdAt: now, updatedAt: now };
    this.ctx.storage.sql.exec(
      `INSERT INTO decisions (id, channel_id, source_thread_id, title, status, problem, alternatives, decision_text, rationale, consequences, participants, related_decisions, superseded_by, accepted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.channelId,
      created.sourceThreadId ?? null,
      created.title,
      created.status,
      created.problem,
      created.alternatives ? JSON.stringify(created.alternatives) : null,
      created.decisionText,
      created.rationale ?? null,
      created.consequences ? JSON.stringify(created.consequences) : null,
      created.participants ? JSON.stringify(created.participants) : null,
      created.relatedDecisions ? JSON.stringify(created.relatedDecisions) : null,
      created.supersededBy ?? null,
      created.acceptedAt ?? null,
      created.createdAt,
      created.updatedAt,
    );
    return created;
  }

  private writeDocument(input: Omit<Document, 'createdAt' | 'updatedAt'>): Document {
    const now = new Date().toISOString();
    const created: Document = { ...input, createdAt: now, updatedAt: now };
    this.ctx.storage.sql.exec(
      `INSERT INTO documents (id, kind, title, status, content, source_thread_id, source_channel_id, author_type, author_id, author_name, reviewers, related_decisions, related_tasks, superseded_by, approved_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.kind,
      created.title,
      created.status,
      created.content,
      created.sourceThreadId ?? null,
      created.sourceChannelId,
      created.author.actorType,
      created.author.actorId,
      created.authorName,
      created.reviewers ? JSON.stringify(created.reviewers) : null,
      created.relatedDecisions ? JSON.stringify(created.relatedDecisions) : null,
      created.relatedTasks ? JSON.stringify(created.relatedTasks) : null,
      created.supersededBy ?? null,
      created.approvedAt ?? null,
      created.createdAt,
      created.updatedAt,
    );
    return created;
  }

  private updateReminder(id: string, patch: Partial<Pick<Reminder, 'status'>>): Reminder | undefined {
    const existing = this.getReminder(id);
    if (!existing) return undefined;
    const updated: Reminder = { ...existing, status: patch.status ?? existing.status };
    this.ctx.storage.sql.exec('UPDATE reminders SET status = ? WHERE id = ?', updated.status, id);
    return updated;
  }

  private updateKnowledgeEntry(id: string, patch: Partial<Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>>): KnowledgeEntry | undefined {
    const existing = this.getKnowledgeEntry(id);
    if (!existing) return undefined;
    const updated: KnowledgeEntry = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `UPDATE knowledge_entries
       SET kind = ?, title = ?, summary = ?, body = ?, tags = ?, source_refs = ?, owner_agent_id = ?, reviewer_agent_id = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      updated.kind,
      updated.title,
      updated.summary,
      updated.body,
      JSON.stringify(updated.tags),
      JSON.stringify(updated.sourceRefs),
      updated.ownerAgentId ?? null,
      updated.reviewerAgentId ?? null,
      updated.status,
      updated.updatedAt,
      id,
    );
    return updated;
  }

  private updateDecision(id: string, patch: Partial<Omit<Decision, 'id' | 'createdAt'>>): Decision | undefined {
    const existing = this.getDecision(id);
    if (!existing) return undefined;
    const updated: Decision = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `UPDATE decisions
       SET channel_id = ?, source_thread_id = ?, title = ?, status = ?, problem = ?, alternatives = ?, decision_text = ?, rationale = ?, consequences = ?, participants = ?, related_decisions = ?, superseded_by = ?, accepted_at = ?, created_at = ?, updated_at = ?
       WHERE id = ?`,
      updated.channelId,
      updated.sourceThreadId ?? null,
      updated.title,
      updated.status,
      updated.problem,
      updated.alternatives ? JSON.stringify(updated.alternatives) : null,
      updated.decisionText,
      updated.rationale ?? null,
      updated.consequences ? JSON.stringify(updated.consequences) : null,
      updated.participants ? JSON.stringify(updated.participants) : null,
      updated.relatedDecisions ? JSON.stringify(updated.relatedDecisions) : null,
      updated.supersededBy ?? null,
      updated.acceptedAt ?? null,
      updated.createdAt,
      updated.updatedAt,
      id,
    );
    return updated;
  }

  private updateDocument(id: string, patch: Partial<Omit<Document, 'id' | 'createdAt'>>): Document | undefined {
    const existing = this.getDocument(id);
    if (!existing) return undefined;
    const updated: Document = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `UPDATE documents
       SET kind = ?, title = ?, status = ?, content = ?, source_thread_id = ?, source_channel_id = ?, author_type = ?, author_id = ?, author_name = ?, reviewers = ?, related_decisions = ?, related_tasks = ?, superseded_by = ?, approved_at = ?, created_at = ?, updated_at = ?
       WHERE id = ?`,
      updated.kind,
      updated.title,
      updated.status,
      updated.content,
      updated.sourceThreadId ?? null,
      updated.sourceChannelId,
      updated.author.actorType,
      updated.author.actorId,
      updated.authorName,
      updated.reviewers ? JSON.stringify(updated.reviewers) : null,
      updated.relatedDecisions ? JSON.stringify(updated.relatedDecisions) : null,
      updated.relatedTasks ? JSON.stringify(updated.relatedTasks) : null,
      updated.supersededBy ?? null,
      updated.approvedAt ?? null,
      updated.createdAt,
      updated.updatedAt,
      id,
    );
    return updated;
  }

  private appendAuditLog(entry: Omit<AuditLog, 'id' | 'createdAt' | 'actorId'> & { id?: string; actorId?: string }): AuditLog {
    const created: AuditLog = {
      ...entry,
      id: entry.id ?? crypto.randomUUID(),
      actorId: entry.actorId ?? entry.actorType,
      createdAt: new Date().toISOString(),
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, task_id, agent_id, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.actorType,
      created.actorId ?? null,
      created.action,
      created.entityType,
      created.entityId,
      created.taskId ?? null,
      created.agentId ?? null,
      JSON.stringify(created.detailJson),
      created.createdAt,
    );
    return created;
  }

  private triggerDueReminders(now = new Date()): void {
    const due = this.listReminders().filter((reminder) => reminder.status === 'pending' && reminder.triggerAt <= now.toISOString());
    for (const reminder of due) {
      const latest = this.getReminder(reminder.id);
      if (!latest || latest.status !== 'pending') continue;
      const agent = this.getAgent(reminder.agentId);
      const message = this.createMessage({
        id: crypto.randomUUID(),
        channelId: reminder.channelId,
        agentId: reminder.agentId,
        senderName: agent?.displayName ?? agent?.name ?? reminder.agentId,
        content: reminder.message,
      });
      this.broadcast({ type: 'message:new', message });
      const updated = this.updateReminder(reminder.id, { status: 'triggered' });
      if (updated) this.broadcast({ type: 'reminder:update', reminder: updated });
    }
  }

  private updateTask(id: string, patch: TaskPatch): Task | undefined {
    const existing = this.getTask(id);
    if (!existing) return undefined;
    const owner = patch.owner ?? (patch.assigneeId ? { actorType: 'agent' as const, actorId: patch.assigneeId } : undefined);
    const updated: Task = {
      ...existing,
      ...patch,
      status: patch.status ? normalizeTaskStatus(patch.status) : existing.status,
      owner: owner ?? patch.owner ?? existing.owner,
      assigneeId: patch.assigneeId ?? (owner?.actorType === 'agent' ? owner.actorId : existing.assigneeId),
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.ctx.storage.sql.exec(
      `UPDATE tasks
       SET status = ?, assignee_id = ?, owner_type = ?, owner_id = ?, reviewer_type = ?, reviewer_id = ?,
           acceptance_criteria = ?, definition_of_done = ?, constraints = ?, depends_on = ?,
           is_blocked = ?, blocked_reason = ?, context = ?, version = ?, updated_at = ?
       WHERE id = ?`,
      updated.status,
      updated.assigneeId ?? null,
      updated.owner?.actorType ?? null,
      updated.owner?.actorId ?? null,
      updated.reviewer?.actorType ?? null,
      updated.reviewer?.actorId ?? null,
      updated.acceptanceCriteria ? JSON.stringify(updated.acceptanceCriteria) : null,
      updated.definitionOfDone ? JSON.stringify(updated.definitionOfDone) : null,
      updated.constraints ? JSON.stringify(updated.constraints) : null,
      updated.dependsOn ? JSON.stringify(updated.dependsOn) : null,
      updated.isBlocked ? 1 : 0,
      updated.blockedReason ?? null,
      updated.context ? JSON.stringify(updated.context) : null,
      updated.version,
      updated.updatedAt,
      id,
    );
    return updated;
  }

  private addContextPackageRef(taskId: string, refType: string, refId: string, refUpdatedAt: string): void {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO context_package_refs (task_id, ref_type, ref_id, ref_updated_at) VALUES (?, ?, ?, ?)',
      taskId, refType, refId, refUpdatedAt,
    );
  }

  private removeContextPackageRefsForTask(taskId: string): void {
    this.ctx.storage.sql.exec('DELETE FROM context_package_refs WHERE task_id = ?', taskId);
  }

  private findTaskIdsByRef(refType: string, refId: string): string[] {
    const cursor = this.ctx.storage.sql.exec('SELECT task_id FROM context_package_refs WHERE ref_type = ? AND ref_id = ?', refType, refId);
    return Array.from(cursor).map((row) => String(row.task_id));
  }

  private markContextPackagesStale(refType: string, refId: string): number {
    const taskIds = this.findTaskIdsByRef(refType, refId);
    for (const taskId of taskIds) {
      const task = this.getTask(taskId);
      if (task?.context?.contextPackage && !task.context.contextPackage.stale) {
        task.context.contextPackage.stale = true;
        task.context.contextPackage.staleReason = `${refType} updated: ${refId}`;
        this.updateTask(taskId, { context: task.context });
      }
    }
    return taskIds.length;
  }

  private updateGoal(id: string, patch: Partial<Pick<GoalBrief, 'objective' | 'background' | 'successCriteria' | 'constraints' | 'assumptions' | 'risks' | 'status'>>): GoalBrief | undefined {
    const existing = this.getGoal(id);
    if (!existing) return undefined;
    const updated: GoalBrief = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `UPDATE goals
       SET objective = ?, background = ?, success_criteria = ?, constraints = ?, assumptions = ?, risks = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      updated.objective,
      JSON.stringify(updated.background),
      JSON.stringify(updated.successCriteria),
      JSON.stringify(updated.constraints),
      JSON.stringify(updated.assumptions),
      JSON.stringify(updated.risks),
      updated.status,
      updated.updatedAt,
      id,
    );
    return updated;
  }

  private updateGoalAlignment(id: string, patch: Partial<Omit<GoalAlignment, 'id' | 'channelId' | 'threadRootId' | 'sourceMessageId' | 'createdAt' | 'updatedAt'>>): GoalAlignment | undefined {
    const existing = this.getGoalAlignment(id);
    if (!existing) return undefined;
    const updated: GoalAlignment = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `UPDATE goal_alignments
       SET goal_id = ?, status = ?, objective = ?, questions = ?, answers = ?, success_criteria = ?, constraints = ?, plan_summary = ?, task_drafts = ?, recommended_agent_ids = ?, reviewer_agent_ids = ?, recommendation_reasons = ?, gaps = ?, risk_level = ?, updated_at = ?
       WHERE id = ?`,
      updated.goalId ?? null,
      updated.status,
      updated.objective,
      JSON.stringify(updated.questions),
      JSON.stringify(updated.answers),
      JSON.stringify(updated.successCriteria),
      JSON.stringify(updated.constraints),
      updated.planSummary ?? null,
      JSON.stringify(updated.taskDrafts),
      JSON.stringify(updated.recommendedAgentIds),
      JSON.stringify(updated.reviewerAgentIds),
      JSON.stringify(updated.recommendationReasons),
      JSON.stringify(updated.gaps),
      updated.riskLevel,
      updated.updatedAt,
      id,
    );
    return updated;
  }

  private createAgentActivity(activity: Omit<AgentActivity, 'createdAt'>): AgentActivity {
    const created: AgentActivity = { ...activity, createdAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `INSERT INTO activities (id, agent_id, type, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      created.id,
      created.agentId,
      created.type,
      created.detail ?? null,
      created.createdAt
    );
    this.truncateAgentActivities(created.agentId, 500);
    return created;
  }

  private createDirectMessage(dm: Omit<DirectMessage, 'createdAt'>): DirectMessage {
    const created: DirectMessage = { ...dm, createdAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `INSERT INTO direct_messages (id, from_agent_id, to_agent_id, content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      created.id,
      created.fromAgentId,
      created.toAgentId,
      created.content,
      created.createdAt
    );
    return created;
  }

  private createAgentDelegation(delegation: Omit<AgentDelegation, 'createdAt'>): AgentDelegation {
    const created: AgentDelegation = { ...delegation, createdAt: new Date().toISOString() };
    this.ctx.storage.sql.exec(
      `INSERT INTO agent_delegations (id, from_agent_id, to_agent_id, content, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      created.id,
      created.fromAgentId,
      created.toAgentId,
      created.content,
      created.status,
      created.error ?? null,
      created.createdAt
    );
    return created;
  }

  private getOrCreateAgentToken(agentId: string): string {
    const existing = this.ctx.storage.sql.exec<Row>('SELECT * FROM agent_tokens WHERE agent_id = ? LIMIT 1', agentId).toArray()[0];
    if (existing?.token) return String(existing.token);
    const token = `xox_agent_${crypto.randomUUID().replaceAll('-', '')}`;
    this.ctx.storage.sql.exec(
      'INSERT INTO agent_tokens (agent_id, token, created_at) VALUES (?, ?, ?)',
      agentId,
      token,
      new Date().toISOString(),
    );
    return token;
  }

  private requireAgentAuth(request: Request, agentId: string): Response | undefined {
    if (request.headers.get('X-Agent-Id') !== agentId) return unauthorized('agent id mismatch');
    const provided = getBearerToken(request.headers.get('Authorization'));
    if (!provided) return unauthorized('missing bearer token');
    const expected = this.getOrCreateAgentToken(agentId);
    if (!timingSafeEqualStr(provided, expected)) return unauthorized('invalid token');
    return undefined;
  }

  private toAgentRuntimeConfig(agent: Agent) {
    return {
      ...toRuntimeConfig(agent),
      envVars: agent.envVars,
      agentToken: this.getOrCreateAgentToken(agent.id),
    };
  }

  private updateAgentDelegation(delegation: AgentDelegation, status: AgentDelegation['status'], error?: string): AgentDelegation {
    this.ctx.storage.sql.exec(
      'UPDATE agent_delegations SET status = ?, error = ? WHERE id = ?',
      status,
      error ?? null,
      delegation.id,
    );
    const updated = { ...delegation, status, error };
    this.broadcast({ type: 'agent:delegation', delegation: updated });
    return updated;
  }

  private listAgentDelegations(agentId: string): AgentDelegation[] {
    return this.ctx.storage.sql
      .exec<Row>(
        `SELECT * FROM agent_delegations
         WHERE from_agent_id = ? OR to_agent_id = ?
         ORDER BY created_at DESC`,
        agentId,
        agentId,
      )
      .toArray()
      .map(toAgentDelegation);
  }

  private listDirectMessages(agentId: string, otherId: string): DirectMessage[] {
    return this.ctx.storage.sql
      .exec<Row>(
        `SELECT * FROM direct_messages
         WHERE (from_agent_id = ? AND to_agent_id = ?)
            OR (from_agent_id = ? AND to_agent_id = ?)
         ORDER BY created_at`,
        agentId,
        otherId,
        otherId,
        agentId,
      )
      .toArray()
      .map(toDirectMessage);
  }

  private listDirectMessageThreads(agentId: string): DirectMessageThread[] {
    const rows = this.ctx.storage.sql
      .exec<Row>(
        `SELECT * FROM direct_messages
         WHERE from_agent_id = ? OR to_agent_id = ?
         ORDER BY created_at DESC`,
        agentId,
        agentId,
      )
      .toArray()
      .map(toDirectMessage);
    const seen = new Set<string>();
    const threads: DirectMessageThread[] = [];
    for (const dm of rows) {
      const otherAgentId = dm.fromAgentId === agentId ? dm.toAgentId : dm.fromAgentId;
      if (seen.has(otherAgentId)) continue;
      seen.add(otherAgentId);
      threads.push({ otherAgentId, lastMessage: dm });
    }
    return threads;
  }

  private listAgentActivities(agentId: string, limit: number): AgentActivity[] {
    return this.ctx.storage.sql
      .exec<Row>('SELECT * FROM activities WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?', agentId, limit)
      .toArray()
      .map(toAgentActivity);
  }

  private truncateAgentActivities(agentId: string, keep: number): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM activities
       WHERE agent_id = ?
         AND id NOT IN (
           SELECT id FROM activities
           WHERE agent_id = ?
           ORDER BY created_at DESC
           LIMIT ?
         )`,
      agentId,
      agentId,
      keep
    );
  }

  private listAgents(): Agent[] {
    return this.ctx.storage.sql.exec<Row>('SELECT * FROM agents ORDER BY created_at').toArray().map(toAgent);
  }

  private getAgent(id: string): Agent | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM agents WHERE id = ? LIMIT 1', id).toArray()[0];
    return row ? toAgent(row) : undefined;
  }

  private findAgentByNameOrId(value: string): Agent | undefined {
    return resolveAgentReference(value, this.listAgents()).match;
  }

  private updateAgent(id: string, patch: Partial<Agent>): Agent | undefined {
    const existing = this.getAgent(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.ctx.storage.sql.exec(
      `UPDATE agents
       SET name = ?, display_name = ?, description = ?, runtime = ?, model = ?,
           system_prompt = ?, env_vars = ?, organization = ?, machine_id = ?, status = ?, auto_start = ?, created_at = ?
       WHERE id = ?`,
      updated.name,
      updated.displayName ?? null,
      updated.description ?? null,
      updated.runtime,
      updated.model ?? null,
      updated.systemPrompt ?? null,
      updated.envVars ? JSON.stringify(updated.envVars) : null,
      updated.organization ? JSON.stringify(updated.organization) : null,
      updated.machineId ?? null,
      updated.status,
      updated.autoStart ? 1 : 0,
      updated.createdAt,
      id
    );
    return updated;
  }

  private delegateAgent(input: { fromAgentId: string; toAgentId: string; content: string; startIfInactive?: boolean }): AgentDelegation {
    const target = this.findAgentByNameOrId(input.toAgentId);
    if (!target) {
      const failed = this.createAgentDelegation({
        id: crypto.randomUUID(),
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
        content: input.content,
        status: 'failed',
        error: JSON.stringify({
          message: 'Target agent not found',
          resolve: resolveAgentReference(input.toAgentId, this.listAgents()),
        }),
      });
      this.broadcast({ type: 'agent:delegation', delegation: failed });
      return failed;
    }

    const queued = this.createAgentDelegation({
      id: crypto.randomUUID(),
      fromAgentId: input.fromAgentId,
      toAgentId: target.id,
      content: input.content,
      status: 'queued',
    });
    this.broadcast({ type: 'agent:delegation', delegation: queued });

    const dm = this.createDirectMessage({
      id: crypto.randomUUID(),
      fromAgentId: input.fromAgentId,
      toAgentId: target.id,
      content: input.content,
    });
    this.broadcast({ type: 'dm:new', dm });

    if (isAgentActive(target.status) && target.machineId) {
      const sent = this.sendToDaemon(target.machineId, {
        type: 'agent:deliver',
        agentId: target.id,
        seq: Date.now(),
        channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
        config: this.toAgentRuntimeConfig(target),
        message: toDirectMessageDelivery(dm),
      });
      return this.updateAgentDelegation(queued, sent ? 'delivered' : 'failed', sent ? undefined : 'Machine not connected');
    }

    if (input.startIfInactive === false) {
      return queued;
    }

    const machineId = this.resolveStartMachineId(target);
    if (!machineId) {
      return this.updateAgentDelegation(queued, 'failed', 'No connected machine available for agent runtime');
    }

    const sent = this.sendToDaemon(machineId, {
      type: 'agent:start',
      agentId: target.id,
      config: this.toAgentRuntimeConfig(target),
      launchId: crypto.randomUUID(),
      wakeMessage: toDirectMessageDelivery(dm),
    });
    if (!sent) {
      return this.updateAgentDelegation(queued, 'failed', 'Machine not connected');
    }
    const updated = this.updateAgent(target.id, { machineId, status: 'starting' });
    if (updated) this.broadcast({ type: 'agent:update', agent: updated });
    return this.updateAgentDelegation(queued, 'started');
  }

  private async getSingleTask(taskId: string): Promise<Response> {
    const task = this.getTask(taskId);
    if (!task) return json({ error: 'Task not found' }, 404);
    if (task.context?.contextPackage?.stale) {
      const freshCp = await this.generateAndStoreContextPackage(task);
      if (freshCp) {
        const fresh = this.getTask(taskId);
        if (fresh) return json(fresh);
      }
    }
    return json(task);
  }

  private async regenerateContextPackage(taskId: string): Promise<Response> {
    const task = this.getTask(taskId);
    if (!task) return json({ error: 'Task not found' }, 404);
    if (!task.assigneeId) return json({ error: 'Task has no assignee' }, 422);
    const cp = await this.generateAndStoreContextPackage(task);
    return cp ? json(cp) : json({ error: 'Failed to generate context package' }, 500);
  }

  private async generateAndStoreContextPackage(task: Task): Promise<import('@crewden/shared').ContextPackage | undefined> {
    if (!task.assigneeId) return undefined;
    try {
      const cp = await buildContextPackage(task, task.assigneeId, {
        getDecision: async (id: string) => {
          const all = this.listDecisions({ channelId: task.channelId });
          return all.find((d) => d.id === id);
        },
        getDocument: async (id: string) => {
          const all = this.listDocuments({ sourceChannelId: task.channelId });
          return all.find((d) => d.id === id);
        },
        getThreadSummary: async () => undefined,
        getTask: async (taskId: string) => this.getTask(taskId),
        getAgent: async (agentId: string) => this.getAgent(agentId),
        getAgentPermissions: async () => undefined,
      });
      this.removeContextPackageRefsForTask(task.id);
      const now = new Date().toISOString();
      const decisionIds = task.context?.relatedDecisionIds ?? [];
      const documentIds = task.context?.relatedDocumentIds ?? [];
      for (const id of decisionIds) {
        this.addContextPackageRef(task.id, 'decision', id, now);
      }
      for (const id of documentIds) {
        this.addContextPackageRef(task.id, 'document', id, now);
      }
      this.updateTask(task.id, {
        context: { ...task.context, contextPackage: cp },
      });
      return cp;
    } catch (err) {
      console.error('[ctx-pkg] buildContextPackage failed for task', task.id, ':', err);
      return undefined;
    }
  }

  private notifyTaskAssignee(task: Task): void {
    if (!task.assigneeId || task.status === 'done') return;
    if (this.hasOpenDependencies(task)) return;
    const target = this.findAgentByNameOrId(task.assigneeId);
    if (!target) return;
    const message = toTaskDelivery(task);
    const inboxSummary = this.buildOpenTaskSummary(target);

    if (isAgentActive(target.status) && target.machineId) {
      this.sendToDaemon(target.machineId, {
        type: 'agent:deliver',
        agentId: target.id,
        seq: Date.now(),
        channelId: message.channelId,
        config: this.toAgentRuntimeConfig(target),
        message,
        inboxSummary,
      });
      return;
    }

    if (!target.autoStart) return;
    const machineId = this.resolveStartMachineId(target);
    if (!machineId) return;
    const sent = this.sendToDaemon(machineId, {
      type: 'agent:start',
      agentId: target.id,
      config: this.toAgentRuntimeConfig(target),
      launchId: crypto.randomUUID(),
      wakeMessage: message,
      inboxSummary,
    });
    if (!sent) return;
    const updated = this.updateAgent(target.id, { machineId, status: 'starting' });
    if (updated) this.broadcast({ type: 'agent:update', agent: updated });
  }

  private notifyTasksBlockedBy(blockerTaskId: string): void {
    for (const task of this.listTasks()) {
      if (task.context?.blockedByTaskIds?.includes(blockerTaskId)) this.notifyTaskAssignee(task);
    }
  }

  private hasOpenDependencies(task: Task): boolean {
    for (const blockerId of task.context?.blockedByTaskIds ?? []) {
      const blocker = this.getTask(blockerId);
      if (!blocker || blocker.status !== 'done') return true;
    }
    return false;
  }

  private validateTaskDependencies(taskId: string, blockedByTaskIds: string[] | undefined): string | undefined {
    if (!blockedByTaskIds?.length) return undefined;
    if (blockedByTaskIds.includes(taskId)) return 'Circular task dependency';
    for (const blockerId of blockedByTaskIds) {
      const blocker = this.getTask(blockerId);
      if (!blocker) return 'Unknown task dependency';
      if (this.hasDependencyPath(blockerId, taskId, new Set([taskId]))) return 'Circular task dependency';
    }
    return undefined;
  }

  private validateBlockersComplete(task: { dependsOn?: string[]; context?: { blockedByTaskIds?: string[] } }): string | undefined {
    const blockerIds = [...new Set([...(task.dependsOn ?? []), ...(task.context?.blockedByTaskIds ?? [])])];
    for (const blockerId of blockerIds) {
      const blocker = this.getTask(blockerId);
      if (!blocker) return 'Unknown task dependency';
      if (blocker.status !== 'done') return 'Task dependency is not done';
    }
    return undefined;
  }

  private hasDependencyPath(fromTaskId: string, targetTaskId: string, visited: Set<string>): boolean {
    if (fromTaskId === targetTaskId) return true;
    if (visited.has(fromTaskId)) return false;
    visited.add(fromTaskId);
    const task = this.getTask(fromTaskId);
    for (const blockerId of task?.context?.blockedByTaskIds ?? []) {
      if (this.hasDependencyPath(blockerId, targetTaskId, visited)) return true;
    }
    return false;
  }

  private buildOpenTaskSummary(agent: Agent): string | undefined {
    const tasks = this.listTasks();
    const assignedTasks = tasks
      .filter((task) => task.status !== 'done' && task.status !== 'cancelled' && task.assigneeId === agent.id)
      .slice(0, 20);
    const claimableTasks = tasks
      .filter((task) => task.status !== 'done' && task.status !== 'cancelled' && !task.assigneeId && matchesAgentCapability(agent, task))
      .slice(0, Math.max(0, 20 - assignedTasks.length));
    if (assignedTasks.length === 0 && claimableTasks.length === 0) return undefined;
    const sections: string[] = [];
    if (assignedTasks.length > 0) {
      sections.push(
        'Open tasks assigned to you:',
        ...assignedTasks.map(formatTaskSummaryLine)
      );
    }
    if (claimableTasks.length > 0) {
      if (sections.length > 0) sections.push('');
      sections.push(
        'Claimable unassigned tasks matching your role/capability:',
        ...claimableTasks.map(formatTaskSummaryLine)
      );
    }
    return [
      ...sections,
      '',
      'Use `crewden task read <taskId> --context`, `crewden task claim <taskId>`, `crewden task update <taskId> --status assigned|in_progress|in_review|changes_requested|qa|done|cancelled`, `crewden task block <taskId> --reason "..." --needs "..."`, and `crewden task handoff <taskId> --to agentName --notes "..."` to manage them.',
    ].join('\n');
  }

  private deliverDirectMessage(target: Agent, dm: DirectMessage): void {
    const machineId = this.resolveStartMachineId(target);
    if (!machineId || target.status === 'inactive') return;
    this.sendToDaemon(machineId, {
      type: 'agent:deliver',
      agentId: target.id,
      seq: Date.now(),
      channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
      config: this.toAgentRuntimeConfig(target),
      message: {
        id: dm.id,
        channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
        channelName: `DM from ${dm.fromAgentId}`,
        senderName: dm.fromAgentId,
        content: dm.content,
        createdAt: dm.createdAt,
      },
    });
  }

  private listMachines(): Machine[] {
    return this.ctx.storage.sql.exec<Row>('SELECT * FROM machines ORDER BY connected_at').toArray().map(toMachine);
  }

  private getMachine(machineId: string): Machine | undefined {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM machines WHERE id = ? LIMIT 1', machineId).toArray()[0];
    return row ? toMachine(row) : undefined;
  }

  private upsertMachine(machine: Machine): Machine {
    this.ctx.storage.sql.exec(
      `INSERT INTO machines (id, hostname, os, daemon_version, runtimes, runtime_versions, status, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         hostname = excluded.hostname,
         os = excluded.os,
         daemon_version = excluded.daemon_version,
         runtimes = excluded.runtimes,
         runtime_versions = excluded.runtime_versions,
         status = excluded.status,
         connected_at = excluded.connected_at`,
      machine.id,
      machine.hostname,
      machine.os,
      machine.daemonVersion,
      JSON.stringify(machine.runtimes),
      JSON.stringify(machine.runtimeVersions),
      machine.status,
      machine.connectedAt
    );
    return machine;
  }

  private setMachineOffline(machineId: string): Machine | undefined {
    this.ctx.storage.sql.exec("UPDATE machines SET status = 'offline' WHERE id = ?", machineId);
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM machines WHERE id = ? LIMIT 1', machineId).toArray()[0];
    return row ? toMachine(row) : undefined;
  }

  private mergeMachines(targetMachineId: string, duplicateIds: string[]): void {
    for (const id of duplicateIds) {
      this.ctx.storage.sql.exec('UPDATE agents SET machine_id = ? WHERE machine_id = ?', targetMachineId, id);
      this.ctx.storage.sql.exec('DELETE FROM machines WHERE id = ?', id);
    }
  }

  private resolveStartMachineId(agent: Agent): string | undefined {
    return resolveStartMachineId({
      agent,
      machines: this.listMachines(),
      connectedMachineIds: this.connectedMachineIds(),
    });
  }

  private reconcileReadyAgents(machineId: string, runtimes: RuntimeId[], runningAgents: Set<string>): void {
    const supportedRuntimes = new Set<RuntimeId>(runtimes);
    for (const agent of this.listAgents()) {
      if (!agent.autoStart || !supportedRuntimes.has(agent.runtime)) continue;
      if (agent.machineId && agent.machineId !== machineId) continue;

      if (runningAgents.has(agent.id)) {
        const updated = this.updateAgent(agent.id, { machineId, status: 'running' });
        if (updated) this.broadcast({ type: 'agent:update', agent: updated });
        continue;
      }

      const sent = this.sendToDaemon(machineId, {
        type: 'agent:start',
        agentId: agent.id,
        config: this.toAgentRuntimeConfig(agent),
        launchId: crypto.randomUUID(),
        inboxSummary: this.buildOpenTaskSummary(agent),
      });
      if (!sent) continue;
      const updated = this.updateAgent(agent.id, { machineId, status: 'starting' });
      if (updated) this.broadcast({ type: 'agent:update', agent: updated });
    }
  }

  private markMachineAgentsInactive(machineId: string): void {
    const volatileStatuses = new Set(['starting', 'running', 'working', 'idle']);
    for (const agent of this.listAgents()) {
      if (agent.machineId !== machineId || !volatileStatuses.has(agent.status)) continue;
      const updated = this.updateAgent(agent.id, { status: 'inactive' });
      if (updated) this.broadcast({ type: 'agent:update', agent: updated });
    }
  }

  private connectedMachineIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
      if (attachment?.kind === 'daemon') ids.add(attachment.machineId);
    }
    return ids;
  }

  private sendToDaemon(machineId: string, message: ServerToDaemon): boolean {
    const ws = this.ctx.getWebSockets().find((candidate) => {
      const attachment = candidate.deserializeAttachment() as SocketAttachment | undefined;
      return attachment?.kind === 'daemon' && attachment.machineId === machineId;
    });
    if (!ws) return false;
    ws.send(JSON.stringify(message));
    return true;
  }

  private readWorkspace(machineId: string, agentId: string, relPath: string): Promise<WorkspaceEntry | WorkspaceError> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.workspaceReads.delete(requestId);
        resolve({ type: 'error', error: 'Workspace read timed out', status: 504 });
      }, 5000);
      this.workspaceReads.set(requestId, { resolve, timeout });
      const sent = this.sendToDaemon(machineId, { type: 'workspace:read', agentId, requestId, relPath });
      if (!sent) {
        clearTimeout(timeout);
        this.workspaceReads.delete(requestId);
        resolve({ type: 'error', error: 'Machine not connected', status: 503 });
      }
    });
  }

  private resolveWorkspaceRead(requestId: string, result: WorkspaceEntry | WorkspaceError): boolean {
    const pending = this.workspaceReads.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    this.workspaceReads.delete(requestId);
    pending.resolve(result);
    return true;
  }

  private broadcast(event: BrowserEvent): void {
    const raw = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
      if (attachment?.kind === 'browser') ws.send(raw);
    }
  }

}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function unauthorized(reason: string): Response {
  return json({ error: 'Unauthorized', reason }, 401);
}

function getBearerToken(header: string | null): string | undefined {
  const match = (header ?? '').match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

function isUnsafeWorkspacePath(value: string): boolean {
  return value.startsWith('/') || value.split(/[\\/]+/).some((part) => part === '..');
}

export async function requireBrowserAuth(request: Request, env: Env): Promise<Response | null> {
  const expected = env.WEB_AUTH_TOKEN;
  if (!expected) return unauthorized('WEB_AUTH_TOKEN not configured');
  const header = request.headers.get('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized('missing bearer token');
  const provided = match[1].trim();
  if (!provided) return unauthorized('missing bearer token');
  if (!timingSafeEqualStr(provided, expected)) return unauthorized('invalid token');
  return null;
}

export async function requireBrowserAuthForWs(url: URL, env: Env): Promise<Response | null> {
  const expected = env.WEB_AUTH_TOKEN;
  if (!expected) return new Response('Unauthorized', { status: 401 });
  const provided = url.searchParams.get('token') ?? '';
  if (!provided) return new Response('Unauthorized', { status: 401 });
  if (!timingSafeEqualStr(provided, expected)) return new Response('Unauthorized', { status: 401 });
  return null;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ab.byteLength; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

function toChannel(row: Row): Channel {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
  };
}

function toMessage(row: Row): Message {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    senderName: String(row.sender_name),
    content: String(row.content),
    agentId: row.agent_id ? String(row.agent_id) : undefined,
    actorType: String(row.actor_type ?? (row.agent_id ? 'agent' : 'human')) as ActorType,
    actorId: String(row.actor_id ?? row.agent_id ?? row.sender_name),
    threadRootId: row.thread_root_id ? String(row.thread_root_id) : undefined,
    mentions: row.mentions ? JSON.parse(String(row.mentions)) as Message['mentions'] : undefined,
    createdAt: String(row.created_at),
  };
}

function toAgentActivity(row: Row): AgentActivity {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    type: String(row.type) as AgentActivity['type'],
    detail: row.detail ? String(row.detail) : undefined,
    createdAt: String(row.created_at),
  };
}

function toDirectMessage(row: Row): DirectMessage {
  return {
    id: String(row.id),
    fromAgentId: String(row.from_agent_id),
    toAgentId: String(row.to_agent_id),
    content: String(row.content),
    createdAt: String(row.created_at),
  };
}

function toAgentDelegation(row: Row): AgentDelegation {
  return {
    id: String(row.id),
    fromAgentId: String(row.from_agent_id),
    toAgentId: String(row.to_agent_id),
    content: String(row.content),
    status: String(row.status) as AgentDelegation['status'],
    error: row.error ? String(row.error) : undefined,
    createdAt: String(row.created_at),
  };
}

function toTask(row: Row): Task {
  const context = row.context ? JSON.parse(String(row.context)) as Task['context'] : undefined;
  const ownerId = row.owner_id ? String(row.owner_id) : row.assignee_id ? String(row.assignee_id) : undefined;
  const reviewerId = row.reviewer_id ? String(row.reviewer_id) : context?.reviewerAgentId;
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    messageId: row.message_id ? String(row.message_id) : undefined,
    title: String(row.title),
    status: normalizeTaskStatus(String(row.status)),
    type: String(row.type ?? 'feature') as Task['type'],
    creatorName: String(row.creator_name),
    creator: {
      actorType: String(row.creator_type ?? 'human') as ActorType,
      actorId: String(row.creator_id ?? row.creator_name),
    },
    assigneeId: row.assignee_id ? String(row.assignee_id) : undefined,
    owner: ownerId ? { actorType: String(row.owner_type ?? 'agent') as ActorType, actorId: ownerId } : undefined,
    reviewer: reviewerId ? { actorType: String(row.reviewer_type ?? 'agent') as ActorType, actorId: reviewerId } : undefined,
    acceptanceCriteria: parseStringArray(row.acceptance_criteria),
    definitionOfDone: parseStringArray(row.definition_of_done),
    constraints: parseStringArray(row.constraints),
    dependsOn: parseStringArray(row.depends_on),
    isBlocked: Boolean(Number(row.is_blocked ?? 0)),
    blockedReason: row.blocked_reason ? String(row.blocked_reason) : context?.blockedReason,
    sourceChannelId: row.source_channel_id ? String(row.source_channel_id) : undefined,
    sourceThreadId: row.source_thread_id ? String(row.source_thread_id) : undefined,
    context,
    version: Number(row.version ?? 1),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseStringArray(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined;
}

function normalizeTaskStatus(status: string): TaskStatus {
  if (status === 'todo') return 'backlog';
  if (status === 'blocked') return 'in_progress';
  return status as TaskStatus;
}

function toGoal(row: Row): GoalBrief {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    sourceMessageId: row.source_message_id ? String(row.source_message_id) : undefined,
    requesterName: String(row.requester_name),
    objective: String(row.objective),
    background: JSON.parse(String(row.background)) as string[],
    successCriteria: JSON.parse(String(row.success_criteria)) as string[],
    constraints: JSON.parse(String(row.constraints)) as string[],
    assumptions: JSON.parse(String(row.assumptions)) as string[],
    risks: JSON.parse(String(row.risks)) as string[],
    status: String(row.status) as GoalBriefStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toGoalAlignment(row: Row): GoalAlignment {
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    threadRootId: String(row.thread_root_id),
    sourceMessageId: String(row.source_message_id),
    goalId: row.goal_id ? String(row.goal_id) : undefined,
    status: String(row.status) as GoalAlignmentStatus,
    objective: String(row.objective),
    questions: JSON.parse(String(row.questions)) as string[],
    answers: JSON.parse(String(row.answers)) as string[],
    successCriteria: JSON.parse(String(row.success_criteria)) as string[],
    constraints: JSON.parse(String(row.constraints)) as string[],
    planSummary: row.plan_summary ? String(row.plan_summary) : undefined,
    taskDrafts: JSON.parse(String(row.task_drafts)) as GoalAlignment['taskDrafts'],
    recommendedAgentIds: JSON.parse(String(row.recommended_agent_ids)) as string[],
    reviewerAgentIds: JSON.parse(String(row.reviewer_agent_ids)) as string[],
    recommendationReasons: JSON.parse(String(row.recommendation_reasons)) as Record<string, string>,
    gaps: JSON.parse(String(row.gaps)) as string[],
    riskLevel: String(row.risk_level) as GoalAlignment['riskLevel'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function buildTaskDrafts(objective: string, recommendation: ReturnType<typeof recommendAgentsForGoal>): GoalAlignment['taskDrafts'] {
  const owner = recommendation.ownerAgentIds[0];
  const reviewer = recommendation.reviewerAgentIds[0];
  return [
    {
      title: `Plan: ${objective}`.slice(0, 200),
      assigneeId: owner,
      role: 'owner',
      acceptanceCriteria: ['Scope, milestones, and handoff points are clear.'],
    },
    {
      title: `Review acceptance for: ${objective}`.slice(0, 200),
      assigneeId: reviewer,
      role: 'reviewer',
      dependencies: owner ? [`Owner plan from ${owner}`] : [],
      acceptanceCriteria: ['Review notes and acceptance risks are documented.'],
    },
  ];
}

function buildPlanSummary(objective: string, recommendation: ReturnType<typeof recommendAgentsForGoal>, riskLevel: GoalAlignment['riskLevel']): string {
  const owners = recommendation.ownerAgentIds.length > 0 ? recommendation.ownerAgentIds.join(', ') : 'No owner match';
  const reviewers = recommendation.reviewerAgentIds.length > 0 ? recommendation.reviewerAgentIds.join(', ') : 'No reviewer match';
  return `Draft plan for "${objective}". Owners: ${owners}. Reviewers: ${reviewers}. Risk: ${riskLevel}.`;
}

function matchesAgentCapability(agent: Agent, task: Task): boolean {
  const haystack = [
    task.title,
    task.context?.goal,
    task.context?.goalObjective,
    task.context?.background,
    ...(task.context?.acceptanceCriteria ?? []),
    ...(task.context?.artifacts ?? []),
  ].filter(Boolean).join(' ').toLowerCase();
  const capabilities = [
    agent.name,
    agent.displayName,
    agent.description,
    ...(agent.organization?.roles ?? []),
    ...(agent.organization?.capabilities ?? []),
    ...(agent.organization?.responsibilities ?? []),
  ].filter(Boolean).map((item) => item!.toLowerCase());
  return capabilities.some((capability) => capability.length >= 3 && (haystack.includes(capability) || capability.split(/\W+/).some((part) => part.length >= 4 && haystack.includes(part))));
}

function formatTaskSummaryLine(task: Task): string {
  const goal = task.context?.goal ? ` goal: ${task.context.goal}` : '';
  return `- ${task.id} [${task.status}] #${task.channelId}: ${task.title}${goal}`;
}

function compareInboxItems(a: AgentInboxItem, b: AgentInboxItem): number {
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
  return rank[a.priority] - rank[b.priority] || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function appendProgress(task: Task, agentId: string, type: TaskProgressEventType, detail: string): Task['context'] {
  const event = {
    id: crypto.randomUUID(),
    taskId: task.id,
    agentId,
    type,
    detail,
    createdAt: new Date().toISOString(),
  };
  return {
    ...task.context,
    claimedByAgentId: type === 'claimed' ? agentId : task.context?.claimedByAgentId,
    progressEvents: [...(task.context?.progressEvents ?? []), event].slice(-20),
  };
}

function makeTaskReview(taskId: string, data: { requesterAgentId?: string; reviewerAgentId?: string; evidence: string[]; checklist: Array<string | { label: string; checked: boolean }>; comment?: string }): TaskReview {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    taskId,
    requesterAgentId: data.requesterAgentId,
    reviewerAgentId: data.reviewerAgentId,
    status: 'requested',
    evidence: data.evidence,
    checklist: data.checklist.map((item) => typeof item === 'string' ? { label: item, checked: false } : item),
    comment: data.comment,
    createdAt: now,
    updatedAt: now,
  };
}

function isHighRiskTask(task: { context?: { risks?: string[] } }): boolean {
  return (task.context?.risks ?? []).some((risk) => /high|production|payment|legal|privacy|credential|高风险|上线|支付|隐私/.test(risk.toLowerCase()));
}

function actorFromPatch(actorType: ActorType | undefined, actorId: string | undefined): { actorType: ActorType; actorId: string } | undefined {
  return actorId ? { actorType: actorType ?? 'agent', actorId } : undefined;
}

function toReminder(row: Row): Reminder {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    channelId: String(row.channel_id),
    message: String(row.message),
    triggerAt: String(row.trigger_at),
    status: String(row.status) as ReminderStatus,
    createdAt: String(row.created_at),
  };
}

function toKnowledgeEntry(row: Row): KnowledgeEntry {
  return {
    id: String(row.id),
    kind: String(row.kind) as KnowledgeKind,
    title: String(row.title),
    summary: String(row.summary),
    body: String(row.body),
    tags: JSON.parse(String(row.tags)) as string[],
    sourceRefs: JSON.parse(String(row.source_refs)) as string[],
    ownerAgentId: row.owner_agent_id ? String(row.owner_agent_id) : undefined,
    reviewerAgentId: row.reviewer_agent_id ? String(row.reviewer_agent_id) : undefined,
    status: String(row.status) as KnowledgeStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toDecision(row: Row): Decision {
  const status = String(row.status);
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    sourceThreadId: row.source_thread_id ? String(row.source_thread_id) : undefined,
    title: String(row.title),
    status: (status === 'accepted' || status === 'deprecated' || status === 'superseded' ? status : 'proposed') as DecisionStatus,
    problem: String(row.problem),
    alternatives: parseStringArray(row.alternatives),
    decisionText: String(row.decision_text),
    rationale: row.rationale ? String(row.rationale) : undefined,
    consequences: parseStringArray(row.consequences),
    participants: row.participants ? JSON.parse(String(row.participants)) as Decision['participants'] : undefined,
    relatedDecisions: parseStringArray(row.related_decisions),
    supersededBy: row.superseded_by ? String(row.superseded_by) : undefined,
    acceptedAt: row.accepted_at ? String(row.accepted_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toDocument(row: Row): Document {
  const status = String(row.status);
  return {
    id: String(row.id),
    kind: String(row.kind) as DocumentKind,
    title: String(row.title),
    status: (status === 'in_review' || status === 'approved' || status === 'deprecated' || status === 'superseded' ? status : 'draft') as DocumentStatus,
    content: String(row.content),
    sourceThreadId: row.source_thread_id ? String(row.source_thread_id) : undefined,
    sourceChannelId: String(row.source_channel_id),
    author: {
      actorType: String(row.author_type) as ActorType,
      actorId: String(row.author_id),
    },
    authorName: String(row.author_name),
    reviewers: row.reviewers ? JSON.parse(String(row.reviewers)) as Document['reviewers'] : undefined,
    relatedDecisions: parseStringArray(row.related_decisions),
    relatedTasks: parseStringArray(row.related_tasks),
    supersededBy: row.superseded_by ? String(row.superseded_by) : undefined,
    approvedAt: row.approved_at ? String(row.approved_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function scoreKnowledge(entry: KnowledgeEntry, query: string): number {
  if (!query) return 1;
  let score = 0;
  if (entry.title.toLowerCase().includes(query)) score += 8;
  if (entry.summary.toLowerCase().includes(query)) score += 5;
  if (entry.body.toLowerCase().includes(query)) score += 2;
  score += entry.tags.filter((tag) => tag.toLowerCase().includes(query)).length * 4;
  return score;
}

function toDirectMessageDelivery(dm: DirectMessage) {
  return {
    id: dm.id,
    channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
    channelName: `DM from ${dm.fromAgentId}`,
    senderName: dm.fromAgentId,
    content: dm.content,
    createdAt: dm.createdAt,
  };
}

function toTaskDelivery(task: Task) {
  return {
    id: `task:${task.id}:${task.updatedAt}`,
    channelId: `task:${task.id}`,
    channelName: `Task ${task.id}`,
    senderName: 'task-board',
    content: [
      `Task assigned or updated: ${task.title}`,
      `Task ID: ${task.id}`,
      `Status: ${task.status}`,
      `Channel: ${task.channelId}`,
      task.context?.goal ? `Goal: ${task.context.goal}` : undefined,
      task.context?.background ? `Background: ${task.context.background}` : undefined,
      task.context?.handoffNotes?.length ? `Latest handoff: ${task.context.handoffNotes.at(-1)}` : undefined,
      '',
      'Use `crewden task read <taskId> --context` for details, `crewden task update <taskId> --status assigned|in_progress|in_review|changes_requested|qa|done|cancelled` when you make progress, and `crewden task block <taskId> --reason "..." --needs "..."` for blockers.',
    ].filter(Boolean).join('\n'),
    createdAt: task.updatedAt,
  };
}

function toAgent(row: Row): Agent {
  return {
    id: String(row.id),
    name: String(row.name),
    displayName: row.display_name ? String(row.display_name) : undefined,
    description: row.description ? String(row.description) : undefined,
    runtime: String(row.runtime) as RuntimeId,
    model: row.model ? String(row.model) : undefined,
    systemPrompt: row.system_prompt ? String(row.system_prompt) : undefined,
    envVars: row.env_vars ? JSON.parse(String(row.env_vars)) as Record<string, string> : undefined,
    organization: row.organization ? JSON.parse(String(row.organization)) as Agent['organization'] : undefined,
    machineId: row.machine_id ? String(row.machine_id) : undefined,
    status: String(row.status) as Agent['status'],
    autoStart: Boolean(Number(row.auto_start ?? 0)),
    createdAt: String(row.created_at),
  };
}

function toMachine(row: Row): Machine {
  return {
    id: String(row.id),
    hostname: String(row.hostname),
    os: String(row.os),
    daemonVersion: String(row.daemon_version),
    runtimes: JSON.parse(String(row.runtimes)) as RuntimeId[],
    runtimeVersions: JSON.parse(String(row.runtime_versions)) as Record<string, string>,
    status: String(row.status) as Machine['status'],
    connectedAt: String(row.connected_at),
  };
}
