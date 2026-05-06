import type { Agent, Channel, Task } from '../api.js';

type Props = {
  tasks: Task[];
  channels: Channel[];
  agents: Agent[];
};

export function InboxPanel({ tasks, channels, agents }: Props) {
  const items = tasks
    .filter((task) => task.status !== 'done' && task.status !== 'cancelled')
    .filter((task) => task.isBlocked || task.status === 'in_review' || task.status === 'changes_requested' || task.status === 'qa' || Boolean(task.assigneeId))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#fbfbf7', padding: 16, fontFamily: "'Courier New', monospace" }}>
      <div style={{ display: 'grid', gap: 10 }}>
        {items.length === 0 ? (
          <div style={{ border: '2px dashed #999', padding: 18, fontSize: 12, textAlign: 'center' }}>[ INBOX EMPTY ]</div>
        ) : items.map((task) => {
          const channel = channels.find((item) => item.id === task.channelId);
          const assignee = task.assigneeId ? agents.find((item) => item.id === task.assigneeId) : undefined;
          const state = task.isBlocked ? 'task_blocked' : task.status;
          return (
            <div key={task.id} style={{ border: '2px solid #000', background: '#fff', padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 12 }}>{task.title}</span>
                <span style={stateBadgeStyle(state)}>{state}</span>
              </div>
              <div style={{ fontSize: 11, color: '#555' }}>
                #{channel?.name ?? task.channelId}{assignee ? ` · ${assignee.displayName ?? assignee.name}` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function stateBadgeStyle(state: string): React.CSSProperties {
  return {
    border: '1px solid #999',
    background: state === 'task_blocked' ? '#ffe8e8' : state === 'in_review' ? '#e8f0ff' : state === 'qa' ? '#eaf8ff' : '#efefef',
    color: '#333',
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 5px',
    textTransform: 'uppercase',
  };
}
