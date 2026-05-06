import type { MessageIntent } from '@crewden/shared';

export function classifyMessageIntent(message: Pick<{ content: string }, 'content'>): MessageIntent {
  const content = message.content.trim().toLowerCase();
  if (!content) return 'chat';

  const goalVerbs = [
    '帮我做',
    '实现',
    '调研',
    '规划',
    '推进',
    '完成',
    '安排',
    '从需求到',
    '方案',
    'roadmap',
    'mvp',
    'build',
    'ship',
    'plan',
    'research',
    'implement',
  ];
  const multiStepHints = [
    '从',
    '到',
    '方案',
    '计划',
    '规划',
    '拆解',
    '协作',
    '多步',
    'review',
    '测试',
    '验收',
    'roadmap',
    'mvp',
    'end to end',
  ];
  const taskHints = [
    'review',
    '修复',
    '改一下',
    '看下',
    '查一下',
    '更新',
    '创建',
    '删除',
    'rename',
    'fix',
    'update',
  ];

  const hasGoalVerb = goalVerbs.some((hint) => content.includes(hint));
  const hasMultiStepHint = multiStepHints.some((hint) => content.includes(hint));
  if (hasGoalVerb && (hasMultiStepHint || content.length > 36)) return 'goal';
  if (taskHints.some((hint) => content.includes(hint))) return 'task';
  return 'chat';
}
