import type {
  ActorType,
  Agent,
  AgentInboxItem,
  DirectMessage,
  GoalAlignment,
  Task,
  TaskProgressEventType,
  TaskReview,
} from '@crewden/shared';

export type AgentRecommendationLite = {
  ownerAgentIds: string[];
  reviewerAgentIds: string[];
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function dedupe(strings: string[]): string[] {
  return Array.from(new Set(strings));
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeTaskSignal(task: Task): string {
  return [
    task.title,
    task.context?.goal,
    task.context?.goalObjective,
    task.context?.background,
    ...(task.context?.acceptanceCriteria ?? []),
    ...(task.context?.artifacts ?? []),
  ]
    .map(safeText)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function normalizeAgentSignal(agent: Agent): string[] {
  return [
    agent.name,
    agent.displayName,
    agent.description,
    ...(agent.organization?.roles ?? []),
    ...(agent.organization?.capabilities ?? []),
    ...(agent.organization?.responsibilities ?? []),
  ]
    .map(safeText)
    .filter(Boolean)
    .map((item) => item.toLowerCase());
}

function hasCapabilityOverlap(taskSignal: string, capability: string): boolean {
  if (!capability) return false;
  if (capability.length >= 3 && taskSignal.includes(capability)) return true;
  return tokenize(capability).some((part) => part.length >= 4 && taskSignal.includes(part));
}

export function matchesAgentCapability(agent: Agent, task: Task): boolean {
  const taskSignal = normalizeTaskSignal(task);
  const capabilities = normalizeAgentSignal(agent);
  return capabilities.some((capability) => hasCapabilityOverlap(taskSignal, capability));
}

export function formatTaskSummaryLine(task: Task): string {
  const goal = task.context?.goal ? ` goal: ${task.context.goal}` : '';
  return `- ${task.id} [${task.status}] #${task.channelId}: ${task.title}${goal}`;
}

export function compareInboxItems(a: AgentInboxItem, b: AgentInboxItem): number {
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
  return rank[a.priority] - rank[b.priority] || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

export function buildTaskDrafts(objective: string, recommendation: AgentRecommendationLite): GoalAlignment['taskDrafts'] {
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

export function buildPlanSummary(
  objective: string,
  recommendation: AgentRecommendationLite,
  riskLevel: GoalAlignment['riskLevel'],
): string {
  const owners = recommendation.ownerAgentIds.length > 0 ? recommendation.ownerAgentIds.join(', ') : 'No owner match';
  const reviewers = recommendation.reviewerAgentIds.length > 0 ? recommendation.reviewerAgentIds.join(', ') : 'No reviewer match';
  return `Draft plan for "${objective}". Owners: ${owners}. Reviewers: ${reviewers}. Risk: ${riskLevel}.`;
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

export function makeTaskReview(
  taskId: string,
  data: {
    requesterAgentId?: string;
    reviewerAgentId?: string;
    evidence: string[];
    checklist: Array<string | { label: string; checked: boolean }>;
    comment?: string;
  },
): TaskReview {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    taskId,
    requesterAgentId: data.requesterAgentId,
    reviewerAgentId: data.reviewerAgentId,
    status: 'requested',
    evidence: data.evidence,
    checklist: data.checklist.map((item) => (typeof item === 'string' ? { label: item, checked: false } : item)),
    comment: data.comment,
    createdAt: now,
    updatedAt: now,
  };
}

export function isHighRiskTask(task: { context?: { risks?: string[] } }): boolean {
  return (task.context?.risks ?? []).some((risk) =>
    /high|production|payment|legal|privacy|credential|高风险|上线|支付|隐私/.test(risk.toLowerCase()),
  );
}

export function actorFromPatch(
  actorType: ActorType | undefined,
  actorId: string | undefined,
): { actorType: ActorType; actorId: string } | undefined {
  return actorId ? { actorType: actorType ?? 'agent', actorId } : undefined;
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
    ]
      .filter(Boolean)
      .join('\n'),
    createdAt: task.updatedAt,
  };
}

export function pickOwnerCandidate(recommendation: AgentRecommendationLite): string | undefined {
  return recommendation.ownerAgentIds[0];
}

export function pickReviewerCandidate(recommendation: AgentRecommendationLite): string | undefined {
  return recommendation.reviewerAgentIds[0];
}

export function summarizeRecommendation(recommendation: AgentRecommendationLite): string {
  const owners = recommendation.ownerAgentIds.length > 0 ? recommendation.ownerAgentIds.join(', ') : 'none';
  const reviewers = recommendation.reviewerAgentIds.length > 0 ? recommendation.reviewerAgentIds.join(', ') : 'none';
  return `owners=${owners}; reviewers=${reviewers}`;
}

export function collectTaskSignals(task: Task): string[] {
  return dedupe(
    [
      task.title,
      task.context?.goal,
      task.context?.goalObjective,
      task.context?.background,
      ...(task.context?.acceptanceCriteria ?? []),
      ...(task.context?.constraints ?? []),
      ...(task.context?.artifacts ?? []),
    ]
      .map(safeText)
      .filter(Boolean),
  );
}

export function collectAgentSignals(agent: Agent): string[] {
  return dedupe(
    [
      agent.name,
      agent.displayName,
      agent.description,
      ...(agent.organization?.roles ?? []),
      ...(agent.organization?.capabilities ?? []),
      ...(agent.organization?.responsibilities ?? []),
    ]
      .map(safeText)
      .filter(Boolean),
  );
}

export function computeCapabilityOverlap(agent: Agent, task: Task): { signal: string; matched: boolean }[] {
  const taskSignal = normalizeTaskSignal(task);
  return collectAgentSignals(agent).map((signal) => ({
    signal,
    matched: hasCapabilityOverlap(taskSignal, signal.toLowerCase()),
  }));
}

export function summarizeInbox(items: AgentInboxItem[]): {
  total: number;
  urgent: number;
  high: number;
  normal: number;
  low: number;
} {
  return items.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.priority] += 1;
      return acc;
    },
    { total: 0, urgent: 0, high: 0, normal: 0, low: 0 },
  );
}
