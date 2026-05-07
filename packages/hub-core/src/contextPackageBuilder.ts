import type { ContextPackage, ContextSection, Decision, Document, Task, Agent, AgentPermissions } from '@crewden/shared';

export function estimateTokens(text: string | string[] | undefined): number {
  if (!text) return 0;
  const content = Array.isArray(text) ? text.join(' ') : text;
  if (!content) return 0;
  const englishChars = (content.match(/[a-zA-Z0-9\s]/g) || []).length;
  const cjkChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = content.length - englishChars - cjkChars;
  return Math.ceil(englishChars / 4 + cjkChars / 2 + otherChars / 3);
}

export type ContextPackageDataSources = {
  getDecision: (id: string) => Promise<Decision | undefined>;
  getDocument: (id: string) => Promise<Document | undefined>;
  getThreadSummary: (threadId: string) => Promise<{ summaryContent?: string; title?: string } | undefined>;
  getTask: (taskId: string) => Promise<Task | undefined>;
  getAgent: (agentId: string) => Promise<Agent | undefined>;
  getAgentPermissions: (agentId: string) => Promise<AgentPermissions | undefined>;
};

function formatTaskDefinition(task: Task): string {
  const parts = [`Title: ${task.title}`];
  if (task.context?.goalObjective) parts.push(`Goal: ${task.context.goalObjective}`);
  if (task.context?.background) parts.push(`Background: ${task.context.background}`);
  return parts.join('\n');
}

function formatConstraints(task: Task): string {
  const parts: string[] = [];
  const criteria = task.acceptanceCriteria ?? task.context?.acceptanceCriteria;
  if (criteria?.length) {
    parts.push('Acceptance Criteria:');
    parts.push(...criteria.map((item) => `- ${item}`));
  }
  const constraints = task.constraints ?? task.context?.constraints;
  if (constraints?.length) {
    parts.push('Constraints:');
    parts.push(...constraints.map((item) => `- ${item}`));
  }
  const dod = task.definitionOfDone;
  if (dod?.length) {
    parts.push('Definition of Done:');
    parts.push(...dod.map((item) => `- ${item}`));
  }
  return parts.join('\n');
}

export async function buildContextPackage(
  task: Task,
  agentId: string,
  sources: ContextPackageDataSources,
): Promise<ContextPackage> {
  const sections: ContextSection[] = [];

  sections.push({
    priority: 1,
    source: 'task',
    title: `Task: ${task.title}`,
    content: formatTaskDefinition(task),
    tokenEstimate: estimateTokens(task.title + (task.context?.goalObjective ?? '') + (task.context?.background ?? '')),
  });

  const constraintsContent = formatConstraints(task);
  if (constraintsContent) {
    sections.push({
      priority: 2,
      source: 'task',
      title: 'Constraints & Acceptance Criteria',
      content: constraintsContent,
      tokenEstimate: estimateTokens(constraintsContent),
    });
  }

  const decisionIds = task.context?.relatedDecisionIds ?? [];
  for (const decisionId of decisionIds) {
    const decision = await sources.getDecision(decisionId);
    if (decision) {
      const content = `Problem: ${decision.problem}\nDecision: ${decision.decisionText}\nRationale: ${decision.rationale ?? 'N/A'}`;
      sections.push({
        priority: 3,
        source: 'decision',
        title: `Decision: ${decision.title}`,
        content,
        tokenEstimate: estimateTokens(content),
      });
    }
  }

  const documentIds = task.context?.relatedDocumentIds ?? [];
  for (const documentId of documentIds) {
    const doc = await sources.getDocument(documentId);
    if (doc) {
      const preview = doc.content.length > 500 ? `${doc.content.slice(0, 500)}...` : doc.content;
      const content = `Kind: ${doc.kind}\nStatus: ${doc.status}\nPreview: ${preview}`;
      sections.push({
        priority: 3,
        source: 'document',
        title: `Document: ${doc.title}`,
        content,
        tokenEstimate: estimateTokens(content),
      });
    }
  }

  if (task.sourceThreadId) {
    const summary = await sources.getThreadSummary(task.sourceThreadId);
    if (summary?.summaryContent) {
      sections.push({
        priority: 4,
        source: 'thread_summary',
        title: `Thread Summary: ${summary.title ?? task.sourceThreadId}`,
        content: summary.summaryContent,
        tokenEstimate: estimateTokens(summary.summaryContent),
      });
    }
  }

  const dependsOn = task.dependsOn ?? task.context?.blockedByTaskIds ?? [];
  for (const parentId of dependsOn) {
    const parentTask = await sources.getTask(parentId);
    const lastProgress = parentTask?.context?.progressEvents?.at(-1);
    const summaryContent = lastProgress?.detail ?? parentTask?.context?.handoffNotes?.join('\n');
    if (summaryContent) {
      sections.push({
        priority: 5,
        source: 'parent_task_result',
        title: `Parent Task Result: ${parentTask?.title ?? parentId}`,
        content: summaryContent,
        tokenEstimate: estimateTokens(summaryContent),
      });
    }
  }

  sections.sort((a, b) => a.priority - b.priority);

  const permissions = await sources.getAgentPermissions(agentId);
  const agentMaxTokens = permissions?.maxContextTokens ?? 100000;

  return applyTokenBudget(sections, agentMaxTokens, task.id);
}

function applyTokenBudget(sections: ContextSection[], agentMaxTokens: number, taskId: string): ContextPackage {
  let totalTokens = 0;
  const kept: ContextSection[] = [];
  let truncationApplied = false;

  for (const section of sections) {
    if (totalTokens + section.tokenEstimate <= agentMaxTokens) {
      kept.push(section);
      totalTokens += section.tokenEstimate;
    } else {
      const remaining = agentMaxTokens - totalTokens;
      if (remaining > 100) {
        const ratio = remaining / section.tokenEstimate;
        const truncatedContent = section.content.slice(0, Math.ceil(section.content.length * ratio));
        kept.push({
          ...section,
          content: `${truncatedContent}\n[truncated]`,
          tokenEstimate: remaining,
        });
        totalTokens += remaining;
      }
      truncationApplied = true;
      break;
    }
  }

  return {
    taskId,
    generatedAt: new Date().toISOString(),
    sections: kept,
    totalTokens,
    agentMaxTokens,
    truncationApplied,
  };
}
