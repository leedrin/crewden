import { useMemo, useState } from 'react';
import type React from 'react';
import type { Agent, Channel, Task, TaskStatus } from '../api.js';
import { createTask, deleteTask, patchTask } from '../api.js';

type Props = {
  tasks: Task[];
  channels: Channel[];
  agents: Agent[];
  onTaskUpdated: (task: Task) => void;
  onTaskDeleted: (taskId: string) => void;
};

type BoardColumnId = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  spec_needed: 'Needs Spec',
  ready: 'Ready',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  in_review: 'In Review',
  changes_requested: 'Changes Requested',
  qa: 'QA',
  done: 'Done',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: '#fff',
  spec_needed: '#fde68a',
  ready: '#d9f99d',
  assigned: '#bbf7d0',
  in_progress: '#FFD700',
  in_review: '#bae6fd',
  changes_requested: '#fecaca',
  qa: '#ddd6fe',
  done: '#86efac',
  cancelled: '#e5e7eb',
};

const ALL_STATUSES = Object.keys(STATUS_LABELS) as TaskStatus[];
const COLUMNS: Array<{ id: BoardColumnId; label: string; statuses: TaskStatus[]; defaultStatus: TaskStatus; color: string }> = [
  { id: 'backlog', label: 'Backlog', statuses: ['backlog', 'spec_needed'], defaultStatus: 'backlog', color: '#fff' },
  { id: 'todo', label: 'Todo', statuses: ['ready'], defaultStatus: 'ready', color: '#d9f99d' },
  { id: 'in_progress', label: 'In Progress', statuses: ['assigned', 'in_progress'], defaultStatus: 'assigned', color: '#FFD700' },
  { id: 'review', label: 'Review', statuses: ['in_review', 'changes_requested', 'qa'], defaultStatus: 'in_review', color: '#bae6fd' },
  { id: 'done', label: 'Done', statuses: ['done', 'cancelled'], defaultStatus: 'done', color: '#86efac' },
];

export function TaskBoard({ tasks, channels, agents, onTaskUpdated, onTaskDeleted }: Props) {
  const [view, setView] = useState<'board' | 'list'>(() => (typeof window !== 'undefined' && window.innerWidth < 760 ? 'list' : 'board'));
  const [channelId, setChannelId] = useState('');
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [collapsed, setCollapsed] = useState<Set<BoardColumnId>>(() => new Set());
  const [detailFilters, setDetailFilters] = useState<Record<BoardColumnId, TaskStatus | ''>>({
    backlog: '',
    todo: '',
    in_progress: '',
    review: '',
    done: '',
  });

  const visibleTasks = useMemo(
    () => tasks.filter((task) => !channelId || task.channelId === channelId),
    [tasks, channelId],
  );

  async function handleCreate() {
    const trimmed = title.trim();
    if (!trimmed) return;
    const task = await createTask({
      title: trimmed,
      channelId: channelId || 'general',
      assigneeId: assigneeId || undefined,
      creatorName: 'user',
      status: assigneeId ? 'assigned' : 'backlog',
    });
    onTaskUpdated(task);
    setTitle('');
  }

  async function handleStatus(task: Task, status: TaskStatus) {
    if (task.status === status) return;
    onTaskUpdated(await patchTask(task.id, { status, expectedVersion: task.version }));
  }

  async function handleDrop(taskId: string, column: BoardColumnId) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const nextStatus = resolveDropStatus(task.status, column);
    await handleStatus(task, nextStatus);
  }

  async function handleDelete(task: Task) {
    await deleteTask(task.id);
    onTaskDeleted(task.id);
  }

  function toggleColumn(columnId: BoardColumnId) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(columnId)) next.delete(columnId);
      else next.add(columnId);
      return next;
    });
  }

  return (
    <div style={shellStyle}>
      <div style={toolbarStyle}>
        <strong style={{ fontSize: 15, marginRight: 8 }}>TASKS</strong>
        <Segmented value={view} onChange={setView} />
        <select value={channelId} onChange={(event) => setChannelId(event.target.value)} style={selectStyle}>
          <option value="">all channels</option>
          {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
        </select>
        <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} style={selectStyle}>
          <option value="">unassigned</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName ?? agent.name}</option>)}
        </select>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') handleCreate(); }}
          placeholder="New task"
          style={inputStyle}
        />
        <button onClick={handleCreate} style={buttonStyle('#FF4D8D', '#fff')}>ADD</button>
      </div>

      {view === 'board' ? (
        <div style={boardStyle}>
          {COLUMNS.map((column) => {
            const columnTasks = visibleTasks.filter((task) => column.statuses.includes(task.status));
            const filteredTasks = detailFilters[column.id]
              ? columnTasks.filter((task) => task.status === detailFilters[column.id])
              : columnTasks;
            const isCollapsed = collapsed.has(column.id);
            return (
              <section
                key={column.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleDrop(event.dataTransfer.getData('text/task-id'), column.id);
                }}
                style={{
                  minWidth: isCollapsed ? 52 : 220,
                  width: isCollapsed ? 52 : undefined,
                  transition: 'width 120ms ease',
                }}
              >
                <ColumnHeader
                  column={column}
                  count={columnTasks.length}
                  collapsed={isCollapsed}
                  filter={detailFilters[column.id]}
                  onFilter={(status) => setDetailFilters((current) => ({ ...current, [column.id]: status }))}
                  onToggle={() => toggleColumn(column.id)}
                />
                {!isCollapsed ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {filteredTasks.map((task) => (
                      <TaskCard key={task.id} task={task} agents={agents} channels={channels} onStatus={handleStatus} onDelete={handleDelete} />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {visibleTasks.map((task) => (
            <TaskCard key={task.id} task={task} agents={agents} channels={channels} onStatus={handleStatus} onDelete={handleDelete} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function resolveDropStatus(from: TaskStatus, columnId: BoardColumnId): TaskStatus {
  if (columnId === 'in_progress' && from === 'changes_requested') return 'in_progress';
  return COLUMNS.find((column) => column.id === columnId)?.defaultStatus ?? from;
}

function TaskCard({ task, agents, channels, onStatus, onDelete, compact = false }: {
  task: Task;
  agents: Agent[];
  channels: Channel[];
  onStatus: (task: Task, status: TaskStatus) => void;
  onDelete: (task: Task) => void;
  compact?: boolean;
}) {
  const assignee = agents.find((agent) => agent.id === task.assigneeId);
  const claimedBy = agents.find((agent) => agent.id === task.context?.claimedByAgentId);
  const channel = channels.find((candidate) => candidate.id === task.channelId);
  const lastProgress = task.context?.progressEvents?.at(-1);
  const latestReview = task.context?.reviews?.at(-1);
  const reviewer = agents.find((agent) => agent.id === (task.reviewer?.actorId ?? latestReview?.reviewerAgentId ?? task.context?.reviewerAgentId));
  const blocked = task.isBlocked || Boolean(task.blockedReason ?? task.context?.blockedReason);
  return (
    <article
      draggable
      onDragStart={(event) => event.dataTransfer.setData('text/task-id', task.id)}
      style={{
        border: '2px solid #000',
        background: blocked ? '#fff0f4' : '#fff',
        padding: 10,
        marginBottom: compact ? 8 : 0,
        boxShadow: '3px 3px 0 #000',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <strong style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.4, wordBreak: 'break-word' }}>{task.title}</strong>
        <button title="Delete task" onClick={() => onDelete(task)} style={iconButtonStyle}>x</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', fontSize: 11 }}>
        <Badge color={STATUS_COLORS[task.status]}>{STATUS_LABELS[task.status]}</Badge>
        <span>#{channel?.name ?? task.channelId}</span>
        <span>{assignee ? `@${assignee.displayName ?? assignee.name}` : '@unassigned'}</span>
        {claimedBy ? <span style={{ fontWeight: 700 }}>CLAIMED: @{claimedBy.displayName ?? claimedBy.name}</span> : null}
        {reviewer ? <span>REVIEW: @{reviewer.displayName ?? reviewer.name}</span> : null}
        {task.context?.goalObjective ? <span style={{ fontWeight: 700 }}>GOAL: {task.context.goalObjective}</span> : null}
      </div>
      {blocked ? (
        <div style={{ marginTop: 8, border: '2px solid #9f1239', background: '#ffe4ec', padding: 7, fontSize: 11, lineHeight: 1.35 }}>
          <strong>BLOCKED</strong>
          <div>{task.blockedReason ?? task.context?.blockedReason}</div>
          {task.context?.blockedNeeds ? <div>Needs: {task.context.blockedNeeds}</div> : null}
        </div>
      ) : lastProgress ? (
        <div style={{ marginTop: 8, border: '1.5px solid #000', background: '#f6f6ee', padding: 7, fontSize: 11, lineHeight: 1.35 }}>
          <strong>{lastProgress.type.toUpperCase()}</strong>
          <div>{lastProgress.detail}</div>
        </div>
      ) : null}
      {(task.acceptanceCriteria?.length ?? task.context?.acceptanceCriteria?.length) ? (
        <div style={{ marginTop: 8, border: '1.5px dashed #777', padding: 7, fontSize: 11, lineHeight: 1.35 }}>
          <strong>ACCEPTANCE</strong>
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {(task.acceptanceCriteria ?? task.context?.acceptanceCriteria ?? []).slice(0, 3).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ) : null}
      {(task.context?.relatedDecisionIds?.length || task.context?.relatedDocumentIds?.length) ? (
        <div style={{ marginTop: 8, border: '1.5px dashed #334155', padding: 7, fontSize: 11, lineHeight: 1.35, background: '#f8fafc' }}>
          <strong>REFERENCES</strong>
          {task.context?.relatedDecisionIds?.length ? (
            <div>Decisions: {task.context.relatedDecisionIds.join(', ')}</div>
          ) : null}
          {task.context?.relatedDocumentIds?.length ? (
            <div>Documents: {task.context.relatedDocumentIds.join(', ')}</div>
          ) : null}
        </div>
      ) : null}
      {latestReview || task.context?.evidence?.length || task.context?.acceptanceChecklist?.length ? (
        <div style={{ marginTop: 8, border: '2px solid #000', background: latestReview?.status === 'approved' ? '#dcfce7' : '#e0f2fe', padding: 7, fontSize: 11, lineHeight: 1.35 }}>
          <strong>{latestReview?.status === 'approved' ? 'ACCEPTED' : 'REVIEW'}</strong>
          <div>Status: {latestReview?.status ?? 'requested'}</div>
          {reviewer ? <div>Reviewer: @{reviewer.displayName ?? reviewer.name}</div> : null}
          <div>Evidence: {(latestReview?.evidence ?? task.context?.evidence ?? []).length}</div>
          <div>Checklist: {(latestReview?.checklist ?? task.context?.acceptanceChecklist ?? []).length}</div>
          {latestReview?.comment ? <div>Note: {latestReview.comment}</div> : null}
        </div>
      ) : null}
      <select
        value={task.status}
        onChange={(event) => onStatus(task, event.target.value as TaskStatus)}
        style={{ ...selectStyle, width: '100%', marginTop: 10, height: 30 }}
      >
        {ALL_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
      </select>
    </article>
  );
}

function ColumnHeader({ column, count, collapsed, filter, onFilter, onToggle }: {
  column: (typeof COLUMNS)[number];
  count: number;
  collapsed: boolean;
  filter: TaskStatus | '';
  onFilter: (status: TaskStatus | '') => void;
  onToggle: () => void;
}) {
  return (
    <div style={{ border: '2px solid #000', background: column.color, padding: collapsed ? 6 : '7px 9px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <strong style={{ fontSize: 12, writingMode: collapsed ? 'vertical-rl' : undefined }}>{column.label}</strong>
        <button title={collapsed ? 'Expand column' : 'Collapse column'} onClick={onToggle} style={iconButtonStyle}>{collapsed ? '+' : '-'}</button>
      </div>
      {!collapsed ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
          <span style={{ fontSize: 11, fontWeight: 700 }}>{count}</span>
          <select value={filter} onChange={(event) => onFilter(event.target.value as TaskStatus | '')} style={{ ...selectStyle, flex: 1, minWidth: 0, height: 26, fontSize: 11 }}>
            <option value="">all</option>
            {column.statuses.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
          </select>
        </div>
      ) : null}
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ border: '1.5px solid #000', background: color, padding: '1px 5px', fontWeight: 700 }}>{children}</span>;
}

function Segmented({ value, onChange }: { value: 'board' | 'list'; onChange: (value: 'board' | 'list') => void }) {
  return (
    <div style={{ display: 'flex', border: '2px solid #000', height: 32 }}>
      {(['board', 'list'] as const).map((item) => (
        <button key={item} onClick={() => onChange(item)} style={{
          width: 58,
          border: 'none',
          borderRight: item === 'board' ? '2px solid #000' : 'none',
          background: value === item ? '#000' : '#fff',
          color: value === item ? '#FFD700' : '#000',
          fontFamily: "'Courier New', monospace",
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
        }}>{item.toUpperCase()}</button>
      ))}
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: '#fafaf5',
  fontFamily: "'Courier New', monospace",
};

const toolbarStyle: React.CSSProperties = {
  minHeight: 58,
  padding: '10px 16px',
  borderBottom: '2px solid #000',
  background: '#fff',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const boardStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))',
  gap: 12,
  padding: 16,
};

const inputStyle: React.CSSProperties = {
  minWidth: 180,
  flex: '1 1 260px',
  height: 32,
  border: '2px solid #000',
  padding: '0 10px',
  fontFamily: "'Courier New', monospace",
  fontSize: 13,
};

const selectStyle: React.CSSProperties = {
  height: 32,
  border: '2px solid #000',
  background: '#fff',
  fontFamily: "'Courier New', monospace",
  fontSize: 12,
};

function buttonStyle(background: string, color: string): React.CSSProperties {
  return {
    height: 32,
    border: '2px solid #000',
    background,
    color,
    padding: '0 12px',
    fontFamily: "'Courier New', monospace",
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  };
}

const iconButtonStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  border: '1.5px solid #000',
  background: '#fff',
  fontFamily: "'Courier New', monospace",
  fontWeight: 700,
  cursor: 'pointer',
  flexShrink: 0,
};
