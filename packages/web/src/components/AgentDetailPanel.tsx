import { useEffect, useState } from 'react';
import type { Agent, AgentActivity, DirectMessage, DirectMessageThread, Machine, Reminder, Task } from '../api.js';
import { cancelReminder, createAgentReminder, deleteAgent, getAgentDirectMessages, getAgentDmThreads, patchAgent, sendAgentDirectMessage, startAgent, stopAgent } from '../api.js';
import { WorkspaceBrowser } from './WorkspaceBrowser.js';

type Props = {
  agent: Agent;
  agents: Agent[];
  machines: Machine[];
  activities: AgentActivity[];
  reminders: Reminder[];
  tasks: Task[];
  onReminderUpdated: (reminder: Reminder) => void;
  onAgentUpdated: (agent: Agent) => void;
  onAgentDeleted: (agentId: string) => void;
  onClose: () => void;
};

type Tab = 'profile' | 'dms' | 'reminders' | 'workspace' | 'activity';

const FONT = "'Courier New', monospace";

const ACTIVITY_META: Record<AgentActivity['type'], { label: string; color: string }> = {
  thinking: { label: 'THINKING', color: '#FFD700' },
  working: { label: 'WORKING', color: '#ff9800' },
  output: { label: 'OUTPUT', color: '#2196f3' },
  idle: { label: 'IDLE', color: '#9e9e9e' },
  sending: { label: 'SENDING MESSAGE', color: '#00c853' },
  error: { label: 'ERROR', color: '#f44336' },
};

export function AgentDetailPanel({ agent, agents, machines, activities, reminders, tasks, onReminderUpdated, onAgentUpdated, onAgentDeleted, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('profile');

  return (
    <div className="right-panel right-panel-detail" style={{
      width: 360,
      background: '#fafaf5',
      borderLeft: '2px solid #000',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      fontFamily: FONT,
    }}>
      <div style={{
        height: 48,
        padding: '0 10px',
        borderBottom: '2px solid #000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#fff',
        flexShrink: 0,
        gap: 8,
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.displayName ?? agent.name}
        </span>
        <button onClick={onClose} style={buttonStyle('#000', '#FFD700')}>X</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: '2px solid #000', background: '#fff' }}>
        <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>PROFILE</TabButton>
        <TabButton active={tab === 'dms'} onClick={() => setTab('dms')}>DMS</TabButton>
        <TabButton active={tab === 'reminders'} onClick={() => setTab('reminders')}>REMIND</TabButton>
        <TabButton active={tab === 'workspace'} onClick={() => setTab('workspace')}>FILES</TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>LOG</TabButton>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        {tab === 'profile' ? <Profile agent={agent} machines={machines} tasks={tasks} onAgentUpdated={onAgentUpdated} onAgentDeleted={onAgentDeleted} /> : null}
        {tab === 'dms' ? <DirectMessages agent={agent} agents={agents} /> : null}
        {tab === 'reminders' ? <Reminders agent={agent} reminders={reminders} onReminderUpdated={onReminderUpdated} /> : null}
        {tab === 'workspace' ? <WorkspaceBrowser agentId={agent.id} /> : null}
        {tab === 'activity' ? <ActivityTimeline activities={activities} /> : null}
      </div>
    </div>
  );
}

function Profile({ agent, machines, tasks, onAgentUpdated, onAgentDeleted }: {
  agent: Agent;
  machines: Machine[];
  tasks: Task[];
  onAgentUpdated: (agent: Agent) => void;
  onAgentDeleted: (agentId: string) => void;
}) {
  const [runtime, setRuntime] = useState(agent.runtime);
  const [displayName, setDisplayName] = useState(agent.displayName ?? '');
  const [description, setDescription] = useState(agent.description ?? '');
  const [model, setModel] = useState(agent.model ?? '');
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt ?? '');
  const [envVarsText, setEnvVarsText] = useState(formatEnvVars(agent.envVars));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [deleting, setDeleting] = useState(false);
  const [operating, setOperating] = useState(false);

  useEffect(() => {
    setRuntime(agent.runtime);
    setDisplayName(agent.displayName ?? '');
    setDescription(agent.description ?? '');
    setModel(agent.model ?? '');
    setSystemPrompt(agent.systemPrompt ?? '');
    setEnvVarsText(formatEnvVars(agent.envVars));
    setError(undefined);
    setDeleteError(undefined);
    setDeleteOpen(false);
  }, [agent.id, agent.runtime, agent.displayName, agent.description, agent.model, agent.systemPrompt, agent.envVars]);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const updated = await patchAgent(agent.id, {
        runtime: runtime !== agent.runtime ? runtime : undefined,
        displayName: displayName.trim() || undefined,
        description: description.trim() || undefined,
        model: model.trim() || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        envVars: parseEnvVars(envVarsText),
      });
      onAgentUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SAVE FAILED');
    } finally {
      setSaving(false);
    }
  };
  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await deleteAgent(agent.id);
      onAgentDeleted(agent.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'DELETE FAILED');
    } finally {
      setDeleting(false);
    }
  };
  const machine = agent.machineId ? machines.find((item) => item.id === agent.machineId) : undefined;
  const machineLabel = formatMachineLabel(agent.machineId, machine);
  const busy = ['starting', 'running', 'working'].includes(agent.status);
  const canStart = ['inactive', 'error'].includes(agent.status);
  const canStop = ['starting', 'running', 'working', 'idle'].includes(agent.status);

  const toggleAutoStart = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const updated = await patchAgent(agent.id, { autoStart: !agent.autoStart });
      onAgentUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AUTO START UPDATE FAILED');
    } finally {
      setSaving(false);
    }
  };

  const handleStart = async () => {
    setOperating(true);
    setError(undefined);
    try {
      const updated = await startAgent(agent.id);
      onAgentUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'START FAILED');
    } finally {
      setOperating(false);
    }
  };

  const handleStop = async () => {
    setOperating(true);
    setError(undefined);
    try {
      const updated = await stopAgent(agent.id);
      onAgentUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'STOP FAILED');
    } finally {
      setOperating(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <WorkSummary agent={agent} tasks={tasks} />
      <div style={{ border: '2px solid #000', background: '#fff', display: 'grid', gridTemplateColumns: '58px 1fr' }}>
        <div style={{ height: 58, background: '#FFD700', borderRight: '2px solid #000', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 20 }}>
          {(agent.displayName ?? agent.name).slice(0, 2).toUpperCase()}
        </div>
        <div style={{ padding: 8, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflowWrap: 'anywhere' }}>{agent.name}</div>
          <div style={{ marginTop: 4, fontSize: 11, color: '#555' }}>{agent.runtime.toUpperCase()} / {agent.status.toUpperCase()}</div>
        </div>
      </div>
      <div style={{ border: '2px solid #000', background: '#fff', padding: 9, display: 'grid', gap: 8 }}>
        <strong style={{ fontSize: 12 }}>RUNTIME CONTROL</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleStart} disabled={!canStart || operating} style={buttonStyle('#000', '#FFD700')}>
            {operating && canStart ? 'STARTING' : 'START'}
          </button>
          <button onClick={handleStop} disabled={!canStop || operating} style={buttonStyle('#fff', '#000')}>
            {operating && canStop ? 'STOPPING' : 'STOP'}
          </button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700 }}>
          <input type="checkbox" checked={Boolean(agent.autoStart)} disabled={saving || operating} onChange={toggleAutoStart} />
          AUTO START
        </label>
      </div>
      <RuntimeSelect
        value={runtime}
        machine={machine}
        busy={busy}
        onChange={setRuntime}
      />
      <Field label="DISPLAY" value={displayName} onChange={setDisplayName} />
      <Field label="DESCRIPTION" value={description} onChange={setDescription} multiline />
      <Field label="MODEL" value={model} onChange={setModel} />
      <Field label="SYSTEM" value={systemPrompt} onChange={setSystemPrompt} multiline />
      <Field label="ENV" value={envVarsText} onChange={setEnvVarsText} multiline />
      <ReadonlyRows rows={[
        ['MACHINE', machineLabel],
        ['CREATED', formatDate(agent.createdAt)],
      ]} />
      {error ? <div style={{ fontSize: 11, color: '#b00020', fontWeight: 700 }}>{error}</div> : null}
      <button onClick={save} disabled={saving} style={buttonStyle('#000', '#FFD700')}>
        {saving ? 'SAVING' : 'SAVE'}
      </button>
      <button onClick={() => setDeleteOpen(true)} style={buttonStyle('#fff', '#b00020')}>
        DELETE AGENT
      </button>
      {deleteOpen ? (
        <DeleteAgentDialog
          agent={agent}
          error={deleteError}
          deleting={deleting}
          onCancel={() => {
            if (deleting) return;
            setDeleteOpen(false);
            setDeleteError(undefined);
          }}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

function DeleteAgentDialog({ agent, error, deleting, onCancel, onConfirm }: {
  agent: Agent;
  error?: string;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isWorking = agent.status === 'working';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Delete agent confirmation"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
        padding: 16,
      }}
    >
      <div style={{ width: 'min(380px, 100%)', border: '2px solid #000', background: '#fff', boxShadow: '4px 4px 0 #000', fontFamily: FONT }}>
        <div style={{ borderBottom: '2px solid #000', padding: '10px 12px', fontWeight: 700, fontSize: 13 }}>
          DELETE AGENT
        </div>
        <div style={{ padding: 12, display: 'grid', gap: 10, fontSize: 12, lineHeight: 1.45 }}>
          <div>
            Delete <strong>{agent.displayName ?? agent.name}</strong>? This cannot be undone. The agent will be removed from the agent list.
          </div>
          {isWorking ? (
            <div style={{ border: '2px solid #b00020', background: '#ffe8e8', color: '#b00020', padding: 8, fontWeight: 700 }}>
              WARNING: THIS AGENT IS WORKING. STOP IT BEFORE DELETING.
            </div>
          ) : null}
          {error ? <div style={{ color: '#b00020', fontWeight: 700 }}>{error}</div> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onCancel} disabled={deleting} style={buttonStyle('#fff', '#000')}>CANCEL</button>
            <button onClick={onConfirm} disabled={deleting} style={buttonStyle('#b00020', '#fff')}>{deleting ? 'DELETING' : 'DELETE'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatMachineLabel(machineId?: string, machine?: Machine): string {
  if (!machineId) return '-';
  const displayName = machine?.hostname?.trim();
  return displayName ? `${displayName} (${machineId})` : machineId;
}

function RuntimeSelect({ value, machine, busy, onChange }: { value: string; machine?: Machine; busy: boolean; onChange: (value: string) => void }) {
  const runtimes = ['claude', 'codex', 'opencode', 'pi', 'gemini'];
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 11, fontWeight: 700 }}>
      RUNTIME
      <select
        aria-label="RUNTIME"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={busy}
        style={inputStyle}
      >
        {runtimes.map((runtime) => {
          const unsupported = Boolean(machine && !machine.runtimes.includes(runtime));
          return (
            <option key={runtime} value={runtime} disabled={unsupported}>
              {runtime.toUpperCase()}{unsupported ? ' (UNSUPPORTED)' : ''}
            </option>
          );
        })}
      </select>
      {busy ? <span style={{ color: '#b00020' }}>STOP AGENT BEFORE CHANGING RUNTIME</span> : null}
    </label>
  );
}

function WorkSummary({ agent, tasks }: { agent: Agent; tasks: Task[] }) {
  const openAssigned = tasks.filter((task) => task.assigneeId === agent.id && task.status !== 'done' && task.status !== 'cancelled');
  const blocked = openAssigned.filter((task) => task.isBlocked || task.blockedReason || task.context?.blockedReason);
  const claimable = tasks.filter((task) => !task.assigneeId && task.status !== 'done' && task.status !== 'cancelled' && matchesAgentTask(agent, task)).slice(0, 5);
  return (
    <div style={{ border: '2px solid #000', background: '#fff', padding: 9, display: 'grid', gap: 7 }}>
      <strong style={{ fontSize: 12 }}>WORK SUMMARY</strong>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
        <span>ASSIGNED {openAssigned.length}</span>
        <span>CLAIMABLE {claimable.length}</span>
        <span style={{ color: blocked.length ? '#b00020' : '#555' }}>BLOCKED {blocked.length}</span>
      </div>
      {[...blocked, ...openAssigned.filter((task) => !(task.isBlocked || task.blockedReason || task.context?.blockedReason)).slice(0, 3), ...claimable].slice(0, 5).map((task) => (
        <div key={task.id} style={{ borderTop: '1px solid #ddd', paddingTop: 5, fontSize: 11 }}>
          <strong>{task.isBlocked || task.blockedReason || task.context?.blockedReason ? 'BLOCKED' : task.assigneeId ? 'ASSIGNED' : 'CLAIMABLE'}</strong> {task.title}
          {task.blockedReason || task.context?.blockedReason ? <div style={{ color: '#b00020' }}>{task.blockedReason ?? task.context?.blockedReason}</div> : null}
        </div>
      ))}
    </div>
  );
}

function matchesAgentTask(agent: Agent, task: Task): boolean {
  const haystack = [task.title, task.context?.goal, task.context?.goalObjective, task.context?.background].filter(Boolean).join(' ').toLowerCase();
  const fields = [
    agent.name,
    agent.displayName,
    agent.description,
    ...(agent.organization?.roles ?? []),
    ...(agent.organization?.capabilities ?? []),
    ...(agent.organization?.responsibilities ?? []),
  ].filter(Boolean).map((item) => item!.toLowerCase());
  return fields.some((field) => field.length >= 3 && (haystack.includes(field) || field.split(/\W+/).some((part) => part.length >= 4 && haystack.includes(part))));
}

function DirectMessages({ agent, agents }: { agent: Agent; agents: Agent[] }) {
  const [threads, setThreads] = useState<DirectMessageThread[]>([]);
  const [selectedOtherId, setSelectedOtherId] = useState('user');
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [draft, setDraft] = useState('');
  const otherAgentIds = new Set(threads.map((thread) => thread.otherAgentId));
  const recipientOptions = [
    { id: 'user', label: 'User' },
    ...agents
      .filter((item) => item.id !== agent.id)
      .map((item) => ({ id: item.id, label: formatAgentLabel(item, item.id) })),
    ...Array.from(otherAgentIds)
      .filter((id) => id !== 'user' && id !== agent.id && !agents.some((item) => item.id === id))
      .map((id) => ({ id, label: id })),
  ];

  const loadThreads = async (selectFirst = false) => {
    const data = await getAgentDmThreads(agent.id);
    setThreads(data);
    if (selectFirst && data.length > 0) setSelectedOtherId(data[0].otherAgentId);
  };

  const loadMessages = async (otherId: string) => {
    if (!otherId.trim()) {
      setMessages([]);
      return;
    }
    setMessages(await getAgentDirectMessages(agent.id, otherId.trim()));
  };

  useEffect(() => {
    setSelectedOtherId('user');
    setMessages([]);
    loadThreads(true);
  }, [agent.id]);

  useEffect(() => {
    loadMessages(selectedOtherId);
  }, [agent.id, selectedOtherId]);

  const send = async () => {
    const content = draft.trim();
    const otherId = selectedOtherId.trim() || 'user';
    if (!content) return;
    const sent = await sendAgentDirectMessage(agent.id, otherId, content);
    setDraft('');
    setSelectedOtherId(otherId);
    setMessages((prev) => [...prev, sent]);
    await loadThreads();
  };
  const displayParticipant = (agentId: string) => {
    if (agentId === 'user') return 'User';
    if (agentId === agent.id) return formatAgentLabel(agent, agentId);
    return formatAgentLabel(agents.find((item) => item.id === agentId), agentId);
  };
  const visibleThreads = threads.filter((thread) => thread.otherAgentId !== 'user');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
        <select
          aria-label="DM recipient"
          value={selectedOtherId}
          onChange={(event) => setSelectedOtherId(event.target.value)}
          style={inputStyle}
        >
          {recipientOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
        <button onClick={() => loadMessages(selectedOtherId)} style={buttonStyle('#fff', '#000')}>OPEN</button>
      </div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        <button onClick={() => setSelectedOtherId('user')} style={threadButtonStyle(selectedOtherId === 'user')}>User</button>
        {visibleThreads.map((thread) => (
          <button key={thread.otherAgentId} onClick={() => setSelectedOtherId(thread.otherAgentId)} style={threadButtonStyle(selectedOtherId === thread.otherAgentId)}>
            {displayParticipant(thread.otherAgentId)}
          </button>
        ))}
      </div>
      <div style={{ border: '2px solid #000', background: '#fff', minHeight: 260, maxHeight: 360, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 ? <EmptyBox label="[ NO DIRECT MESSAGES ]" /> : null}
        {messages.map((message) => (
          <div key={message.id} style={{
            alignSelf: message.fromAgentId === agent.id ? 'flex-end' : 'flex-start',
            maxWidth: '88%',
            border: '2px solid #000',
            background: message.fromAgentId === agent.id ? '#FFD700' : '#fafaf5',
            padding: 8,
            fontSize: 11,
            overflowWrap: 'anywhere',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{displayParticipant(message.fromAgentId)}</div>
            <div>{message.content}</div>
            <div style={{ marginTop: 5, color: '#555', fontSize: 10 }}>{formatTime(message.createdAt)}</div>
          </div>
        ))}
      </div>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} style={{ ...inputStyle, minHeight: 74, resize: 'vertical' }} />
      <button onClick={send} style={buttonStyle('#000', '#FFD700')}>SEND DM</button>
    </div>
  );
}

function formatAgentLabel(agent: Agent | undefined, fallbackId: string): string {
  if (!agent) return fallbackId;
  return agent.displayName?.trim() || agent.name;
}

function Reminders({ agent, reminders, onReminderUpdated }: { agent: Agent; reminders: Reminder[]; onReminderUpdated: (reminder: Reminder) => void }) {
  const [message, setMessage] = useState('');
  const [triggerAt, setTriggerAt] = useState('');
  const [channelId, setChannelId] = useState('general');
  const [error, setError] = useState<string | undefined>();

  const create = async () => {
    setError(undefined);
    if (!message.trim() || !triggerAt) return;
    try {
      const iso = new Date(triggerAt).toISOString();
      const reminder = await createAgentReminder(agent.id, { channelId: channelId.trim() || 'general', message: message.trim(), triggerAt: iso });
      setMessage('');
      setTriggerAt('');
      onReminderUpdated(reminder);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CREATE FAILED');
    }
  };

  const cancel = async (id: string) => {
    const updated = await cancelReminder(id);
    onReminderUpdated(updated);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ border: '2px dashed #000', background: '#fff', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 18 }}>BEL</div>
        <input value={message} onChange={(event) => setMessage(event.target.value)} style={inputStyle} placeholder="message" />
        <input value={triggerAt} onChange={(event) => setTriggerAt(event.target.value)} style={inputStyle} type="datetime-local" />
        <input value={channelId} onChange={(event) => setChannelId(event.target.value)} style={inputStyle} placeholder="channel" />
        {error ? <div style={{ fontSize: 11, color: '#b00020', fontWeight: 700 }}>{error}</div> : null}
        <button onClick={create} style={buttonStyle('#000', '#FFD700')}>ADD REMINDER</button>
      </div>
      {reminders.length === 0 ? <EmptyBox label="[ NO PENDING REMINDERS ]" /> : null}
      {reminders.map((reminder) => (
        <div key={reminder.id} style={{ border: '2px solid #000', background: '#fff', padding: 8, display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{formatDate(reminder.triggerAt)}</span>
            <span style={{ border: '2px solid #000', background: reminder.status === 'pending' ? '#FFD700' : '#fafaf5', padding: '2px 5px', fontSize: 10, fontWeight: 700 }}>
              {reminder.status.toUpperCase()}
            </span>
          </div>
          <div style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{reminder.message}</div>
          <div style={{ fontSize: 10, color: '#555' }}>#{reminder.channelId}</div>
          {reminder.status === 'pending' ? <button onClick={() => cancel(reminder.id)} style={buttonStyle('#fff', '#000')}>CANCEL</button> : null}
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, fontWeight: 700 }}>
      {label}
      {multiline ? (
        <textarea value={value} onChange={(event) => onChange(event.target.value)} style={{ ...inputStyle, minHeight: 78, resize: 'vertical' }} />
      ) : (
        <input value={value} onChange={(event) => onChange(event.target.value)} style={inputStyle} />
      )}
    </label>
  );
}

function ReadonlyRows({ rows }: { rows: string[][] }) {
  return (
    <div style={{ border: '2px solid #000', background: '#fff' }}>
      {rows.map(([label, value], index) => (
        <div key={label} style={{ display: 'grid', gridTemplateColumns: '82px 1fr', borderBottom: index === rows.length - 1 ? 'none' : '2px solid #000' }}>
          <div style={{ padding: '8px', fontSize: 10, fontWeight: 700, background: '#FFD700', borderRight: '2px solid #000' }}>{label}</div>
          <div style={{ padding: '8px', fontSize: 11, overflowWrap: 'anywhere' }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

function ActivityTimeline({ activities }: { activities: AgentActivity[] }) {
  if (activities.length === 0) return <EmptyBox label="[ NO ACTIVITY ]" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {activities.map((activity) => {
        const meta = ACTIVITY_META[activity.type];
        return (
          <div key={activity.id} style={{
            display: 'grid',
            gridTemplateColumns: '62px 12px 1fr',
            gap: 7,
            alignItems: 'start',
            border: '2px solid #000',
            background: '#fff',
            padding: '7px 8px',
            fontSize: 11,
          }}>
            <span style={{ color: '#555' }}>{formatTime(activity.createdAt)}</span>
            <span style={{ width: 10, height: 10, background: meta.color, border: '1.5px solid #000', marginTop: 1 }} />
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              <strong>{meta.label}</strong>
              {activity.detail ? <span style={{ color: '#555' }}> {activity.detail}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyBox({ label }: { label: string }) {
  return (
    <div style={{ border: '2px dashed #bbb', padding: 16, textAlign: 'center', fontSize: 11, color: '#777' }}>
      {label}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      minWidth: 0,
      padding: '9px 4px',
      border: 'none',
      borderRight: '2px solid #000',
      background: active ? '#FFD700' : '#fff',
      color: '#000',
      fontFamily: FONT,
      fontWeight: 700,
      fontSize: 10,
      cursor: 'pointer',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}>
      {children}
    </button>
  );
}

function buttonStyle(background: string, color: string): React.CSSProperties {
  return {
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 11,
    border: '2px solid #000',
    background,
    color,
    cursor: 'pointer',
    padding: '6px 9px',
    flexShrink: 0,
  };
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '2px solid #000',
  background: '#fff',
  color: '#000',
  fontFamily: FONT,
  fontSize: 11,
  padding: 8,
};

function threadButtonStyle(active: boolean): React.CSSProperties {
  return {
    ...buttonStyle(active ? '#FFD700' : '#fff', '#000'),
    whiteSpace: 'nowrap',
    padding: '5px 8px',
  };
}

function parseEnvVars(value: string): Record<string, string> | undefined {
  const pairs = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=');
      if (index === -1) return [line, ''];
      return [line.slice(0, index).trim(), line.slice(index + 1)];
    })
    .filter(([key]) => key);
  if (pairs.length === 0) return undefined;
  return Object.fromEntries(pairs);
}

function formatEnvVars(envVars: Record<string, string> | undefined): string {
  if (!envVars) return '';
  return Object.entries(envVars).map(([key, value]) => `${key}=${value}`).join('\n');
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
