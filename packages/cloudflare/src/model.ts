import type {
  ActorType,
  Agent,
  AgentActivity,
  AgentDelegation,
  AgentInboxItem,
  Decision,
  DecisionStatus,
  DirectMessage,
  Document,
  DocumentKind,
  DocumentStatus,
  GoalAlignment,
  GoalAlignmentStatus,
  GoalBrief,
  GoalBriefStatus,
  KnowledgeEntry,
  KnowledgeKind,
  KnowledgeStatus,
  Machine,
  Reminder,
  ReminderStatus,
  RuntimeId,
  Task,
  TaskProgressEventType,
  TaskReview,
} from '@crewden/shared';

type Row = Record<string, unknown>;

export function parseStringArray(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : undefined;
}

export function toAgentActivity(row: Row): AgentActivity {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    type: String(row.type) as AgentActivity['type'],
    detail: row.detail ? String(row.detail) : undefined,
    createdAt: String(row.created_at),
  };
}

export function toDirectMessage(row: Row): DirectMessage {
  return {
    id: String(row.id),
    fromAgentId: String(row.from_agent_id),
    toAgentId: String(row.to_agent_id),
    content: String(row.content),
    createdAt: String(row.created_at),
  };
}

export function toAgentDelegation(row: Row): AgentDelegation {
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

export function toGoal(row: Row): GoalBrief {
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

export function toGoalAlignment(row: Row): GoalAlignment {
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

export function buildTaskDrafts(objective: string, recommendation: { ownerAgentIds: string[]; reviewerAgentIds: string[] }): GoalAlignment['taskDrafts'] {
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

export function buildPlanSummary(objective: string, recommendation: { ownerAgentIds: string[]; reviewerAgentIds: string[] }, riskLevel: GoalAlignment['riskLevel']): string {
  const owners = recommendation.ownerAgentIds.length > 0 ? recommendation.ownerAgentIds.join(', ') : 'No owner match';
  const reviewers = recommendation.reviewerAgentIds.length > 0 ? recommendation.reviewerAgentIds.join(', ') : 'No reviewer match';
  return `Draft plan for "${objective}". Owners: ${owners}. Reviewers: ${reviewers}. Risk: ${riskLevel}.`;
}

export function matchesAgentCapability(agent: Agent, task: Task): boolean {
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

export function formatTaskSummaryLine(task: Task): string {
  const goal = task.context?.goal ? ` goal: ${task.context.goal}` : '';
  return `- ${task.id} [${task.status}] #${task.channelId}: ${task.title}${goal}`;
}

export function compareInboxItems(a: AgentInboxItem, b: AgentInboxItem): number {
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
  return rank[a.priority] - rank[b.priority] || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

export function appendProgress(task: Task, agentId: string, type: TaskProgressEventType, detail: string): Task['context'] {
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

export function makeTaskReview(taskId: string, data: { requesterAgentId?: string; reviewerAgentId?: string; evidence: string[]; checklist: Array<string | { label: string; checked: boolean }>; comment?: string }): TaskReview {
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

export function isHighRiskTask(task: { context?: { risks?: string[] } }): boolean {
  return (task.context?.risks ?? []).some((risk) => /high|production|payment|legal|privacy|credential|高风险|上线|支付|隐私/.test(risk.toLowerCase()));
}

export function actorFromPatch(actorType: ActorType | undefined, actorId: string | undefined): { actorType: ActorType; actorId: string } | undefined {
  return actorId ? { actorType: actorType ?? 'agent', actorId } : undefined;
}

export function toReminder(row: Row): Reminder {
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

export function toKnowledgeEntry(row: Row): KnowledgeEntry {
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

export function toDecision(row: Row): Decision {
  const status = String(row.status);
  return {
    id: String(row.id),
    channelId: String(row.channel_id),
    sourceThreadId: row.source_thread_id ? String(row.source_thread_id) : undefined,
    title: String(row.title),
    status: (status === 'accepted' || status === 'deprecated' || status === 'superseded' ? status : 'proposed') as DecisionStatus,
    problem: String(row.problem),
    alternatives: parseStringArray(row.alternatives as string | null),
    decisionText: String(row.decision_text),
    rationale: row.rationale ? String(row.rationale) : undefined,
    consequences: parseStringArray(row.consequences as string | null),
    participants: row.participants ? JSON.parse(String(row.participants)) as Decision['participants'] : undefined,
    relatedDecisions: parseStringArray(row.related_decisions as string | null),
    supersededBy: row.superseded_by ? String(row.superseded_by) : undefined,
    acceptedAt: row.accepted_at ? String(row.accepted_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toDocument(row: Row): Document {
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
    relatedDecisions: parseStringArray(row.related_decisions as string | null),
    relatedTasks: parseStringArray(row.related_tasks as string | null),
    supersededBy: row.superseded_by ? String(row.superseded_by) : undefined,
    approvedAt: row.approved_at ? String(row.approved_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function scoreKnowledge(entry: KnowledgeEntry, query: string): number {
  if (!query) return 1;
  let score = 0;
  if (entry.title.toLowerCase().includes(query)) score += 8;
  if (entry.summary.toLowerCase().includes(query)) score += 5;
  if (entry.body.toLowerCase().includes(query)) score += 2;
  score += entry.tags.filter((tag) => tag.toLowerCase().includes(query)).length * 4;
  return score;
}

export function toDirectMessageDelivery(dm: DirectMessage) {
  return {
    id: dm.id,
    channelId: `dm:${dm.fromAgentId}:${dm.toAgentId}`,
    channelName: `DM from ${dm.fromAgentId}`,
    senderName: dm.fromAgentId,
    content: dm.content,
    createdAt: dm.createdAt,
  };
}

export function toTaskDelivery(task: Task) {
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

export function toAgent(row: Row): Agent {
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

export function toMachine(row: Row): Machine {
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
