import type { Agent, GoalAlignmentRiskLevel, Message } from '@crewden/shared';
import { classifyMessageIntent } from './intentClassifier.js';
export { classifyMessageIntent } from './intentClassifier.js';

export type GoalAgentRecommendation = {
  ownerAgentIds: string[];
  reviewerAgentIds: string[];
  reasons: Record<string, string>;
  gaps: string[];
};

export function inferGoalRiskLevel(message: Pick<Message, 'content'>): GoalAlignmentRiskLevel {
  const content = message.content.toLowerCase();
  const highRiskHints = ['付款', '支付', '删除', '上线', '发布', 'deploy', 'production', 'billing', 'legal', '法律', '合同', '财务'];
  const mediumRiskHints = ['用户数据', '权限', '账号', 'token', '凭据', 'credential', '隐私', 'privacy'];
  if (highRiskHints.some((hint) => content.includes(hint))) return 'high';
  if (mediumRiskHints.some((hint) => content.includes(hint))) return 'medium';
  return 'low';
}

export function buildClarifyingQuestions(message: Pick<Message, 'content'>): string[] {
  const content = message.content.toLowerCase();
  const questions: string[] = [];
  if (!/(成功|验收|指标|标准|success|acceptance|done)/.test(content)) {
    questions.push('What does success look like for this goal?');
  }
  if (!/(截止|时间|今天|明天|本周|deadline|by\s|before)/.test(content)) {
    questions.push('Is there a deadline or priority constraint?');
  }
  if (!/(@|产品|工程|测试|设计|agent|pm|engineer|qa|designer)/.test(content)) {
    questions.push('Which roles or agents should be involved?');
  }
  return questions.slice(0, 3);
}

export function recommendAgentsForGoal(objective: string, agents: Agent[]): GoalAgentRecommendation {
  const active = agents.filter((agent) => agent.organization?.availability !== 'unavailable');
  const ownerKeywords = ['product', 'pm', '产品', 'manager', '规划', '需求', 'owner'];
  const engineerKeywords = ['engineer', '工程', '开发', 'implementation', 'code', '技术'];
  const reviewerKeywords = ['qa', 'test', '测试', 'review', '验收', 'quality'];

  const owners = pickByKeywords(active, ownerKeywords, objective);
  const engineers = pickByKeywords(active, engineerKeywords, objective);
  const reviewers = pickByKeywords(active, reviewerKeywords, objective);
  const ownerAgentIds = uniqueIds([...owners, ...engineers]).slice(0, 3);
  const reviewerAgentIds = uniqueIds(reviewers).filter((id) => !ownerAgentIds.includes(id)).slice(0, 2);
  const reasons: Record<string, string> = {};
  for (const agent of active) {
    if (ownerAgentIds.includes(agent.id)) {
      reasons[agent.id] = `${agent.displayName ?? agent.name} matches the goal's planning or delivery responsibilities.`;
    } else if (reviewerAgentIds.includes(agent.id)) {
      reasons[agent.id] = `${agent.displayName ?? agent.name} matches review, test, or acceptance responsibilities.`;
    }
  }

  const gaps: string[] = [];
  if (ownerAgentIds.length === 0) gaps.push('No owner agent matched product/planning or engineering responsibilities.');
  if (reviewerAgentIds.length === 0) gaps.push('No reviewer agent matched QA/review responsibilities.');
  return { ownerAgentIds, reviewerAgentIds, reasons, gaps };
}

function pickByKeywords(agents: Agent[], keywords: string[], objective: string): Agent[] {
  const normalizedObjective = objective.toLowerCase();
  return agents.filter((agent) => {
    const fields = [
      agent.name,
      agent.displayName,
      agent.description,
      agent.organization?.department,
      ...(agent.organization?.roles ?? []),
      ...(agent.organization?.capabilities ?? []),
      ...(agent.organization?.responsibilities ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return keywords.some((keyword) => fields.includes(keyword) || normalizedObjective.includes(keyword) && fields.includes('general'));
  });
}

function uniqueIds(agents: Agent[]): string[] {
  return Array.from(new Set(agents.map((agent) => agent.id)));
}
