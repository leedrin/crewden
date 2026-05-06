import { useState } from 'react';
import type { Channel, Agent, AgentActivity, Machine, RuntimeStatus, VersionInfo, Project } from '../api.js';
import { PresenceAvatar, presenceLabel } from './PresenceAvatar.js';
import { t } from '../i18n.js';

type Props = {
  projects: Project[];
  selectedProjectId: string;
  channels: Channel[];
  agents: Agent[];
  activitiesByAgent?: Record<string, AgentActivity[]>;
  machines: Machine[];
  runtimeStatus?: RuntimeStatus;
  selectedView: 'channel' | 'tasks' | 'knowledge';
  selectedChannel: string;
  selectedAgentId?: string;
  webVersion: VersionInfo;
  hubVersion?: VersionInfo;
  taskCount: number;
  onSelectTasks: () => void;
  onSelectKnowledge: () => void;
  onOpenSearch: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectChannel: (id: string) => void;
  onCreateChannel: (name: string) => Promise<void>;
  onDeleteChannel: (id: string) => Promise<void>;
  onSelectAgent: (id: string) => void;
  onOpenAgents: () => void;
  className?: string;
  onNavigate?: () => void;
  onSignOut?: () => void;
};

const S = {
  sidebar: {
    width: 240,
    background: '#FFD700',
    borderRight: '2px solid #000',
    display: 'flex',
    flexDirection: 'column' as const,
    flexShrink: 0,
    overflowY: 'auto' as const,
    fontFamily: "'Courier New', monospace",
  },
  workspaceName: {
    padding: '14px 14px 12px',
    fontWeight: 700,
    fontSize: 16,
    borderBottom: '2px solid #000',
    letterSpacing: 0,
    background: '#FFD700',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeader: {
    padding: '12px 14px 4px',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.8px',
    textTransform: 'uppercase' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
};

export function Sidebar({ projects, selectedProjectId, channels, agents, activitiesByAgent = {}, machines, runtimeStatus, selectedView, selectedChannel, selectedAgentId, webVersion, hubVersion, taskCount, onSelectTasks, onSelectKnowledge, onOpenSearch, onSelectProject, onSelectChannel, onCreateChannel, onDeleteChannel, onSelectAgent, onOpenAgents, className, onNavigate, onSignOut }: Props) {
  const [creating, setCreating] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [channelError, setChannelError] = useState('');

  const submitChannel = async () => {
    const name = channelName.trim();
    if (!name) return;
    setChannelError('');
    try {
      await onCreateChannel(name);
      setChannelName('');
      setCreating(false);
    } catch (err) {
      setChannelError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className={`sidebar-shell${className ? ` ${className}` : ''}`} style={S.sidebar}>
      <div className="sidebar-item sidebar-workspace" style={S.workspaceName}>
        <span>▶ {t('nav.workspace')}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span title={versionTitle(webVersion, hubVersion)} style={{ fontSize: 10, fontWeight: 400, opacity: 0.65 }}>
            web {shortVersion(webVersion.version)}
          </span>
          {onSignOut ? (
            <button type="button" onClick={onSignOut} title="Sign out" style={signOutButtonStyle}>
              OUT
            </button>
          ) : null}
        </span>
      </div>

      <div style={{ padding: '8px 10px 4px', borderBottom: '2px solid #000' }}>
        <select
          value={selectedProjectId}
          onChange={(event) => {
            onSelectProject(event.target.value);
            onNavigate?.();
          }}
          style={{
            width: '100%',
            border: '2px solid #000',
            background: '#fff',
            color: '#000',
            fontFamily: "'Courier New', monospace",
            fontSize: 12,
            fontWeight: 700,
            padding: '5px 6px',
          }}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </div>

      <div style={{ padding: '4px 0' }}>
        <button className="sidebar-item" onClick={() => { onOpenSearch(); onNavigate?.(); }} style={navButtonStyle(false)}>
          <span style={{ flex: 1 }}>{t('nav.search')}</span>
          <span style={{ fontSize: 10 }}>⌘K</span>
        </button>
        <button className={`sidebar-item${selectedView === 'tasks' ? ' sidebar-item-active' : ''}`} onClick={() => { onSelectTasks(); onNavigate?.(); }} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          width: 'calc(100% - 8px)',
          margin: '6px 4px 8px',
          padding: '7px 10px',
          fontSize: 13,
          fontFamily: "'Courier New', monospace",
          fontWeight: 700,
          border: 'none',
          borderLeft: selectedView === 'tasks' ? '3px solid #000' : '3px solid transparent',
          borderRight: selectedView === 'tasks' ? '3px solid #000' : '3px solid transparent',
          background: selectedView === 'tasks' ? '#000' : '#fff',
          color: selectedView === 'tasks' ? '#FFD700' : '#000',
          cursor: 'pointer',
          textAlign: 'left',
        }}>
          <span style={{ flex: 1 }}>{t('nav.tasks')}</span>
          <span style={{ fontSize: 10 }}>{taskCount}</span>
        </button>
        <button className={`sidebar-item${selectedView === 'knowledge' ? ' sidebar-item-active' : ''}`} onClick={() => { onSelectKnowledge(); onNavigate?.(); }} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          width: 'calc(100% - 8px)',
          margin: '0 4px 8px',
          padding: '7px 10px',
          fontSize: 13,
          fontFamily: "'Courier New', monospace",
          fontWeight: 700,
          border: 'none',
          borderLeft: selectedView === 'knowledge' ? '3px solid #000' : '3px solid transparent',
          borderRight: selectedView === 'knowledge' ? '3px solid #000' : '3px solid transparent',
          background: selectedView === 'knowledge' ? '#000' : '#fff',
          color: selectedView === 'knowledge' ? '#FFD700' : '#000',
          cursor: 'pointer',
          textAlign: 'left',
        }}>
          <span style={{ flex: 1 }}>{t('nav.knowledge')}</span>
        </button>

        <SectionHeader label={t('nav.channels')} count={channels.length} action={<button onClick={() => setCreating(true)} style={miniButtonStyle}>+</button>} />
        {creating ? (
          <div style={{ margin: '2px 8px 6px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4 }}>
              <input
                autoFocus
                value={channelName}
                onChange={(event) => {
                  setChannelName(event.target.value);
                  setChannelError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitChannel();
                  if (event.key === 'Escape') {
                    setCreating(false);
                    setChannelError('');
                  }
                }}
                style={{ border: '2px solid #000', padding: '5px 6px', fontFamily: "'Courier New', monospace", fontSize: 12, minWidth: 0 }}
              />
              <button onClick={submitChannel} style={miniButtonStyle}>OK</button>
            </div>
            {channelError ? (
              <div style={{ marginTop: 4, fontSize: 10, lineHeight: 1.3, color: '#b00020', fontWeight: 700 }}>
                {channelError}
              </div>
            ) : null}
          </div>
        ) : null}
        {channels.map((ch) => (
          <ChannelItem
            key={ch.id}
            id={ch.id}
            name={ch.name}
            active={selectedView === 'channel' && selectedChannel === ch.id}
            onClick={() => {
              onSelectChannel(ch.id);
              onNavigate?.();
            }}
            onDelete={ch.id === 'general' ? undefined : async () => {
              if (window.confirm(`Delete #${ch.name}?`)) await onDeleteChannel(ch.id);
            }}
          />
        ))}

        <SectionHeader label={t('nav.agents')} count={agents.length} style={{ marginTop: 8 }} action={<button onClick={() => { onOpenAgents(); onNavigate?.(); }} style={miniButtonStyle}>MANAGE</button>} />
        {agents.length === 0 && <EmptyHint text="no agents" />}
        {agents.map((a) => {
          const latestActivity = activitiesByAgent[a.id]?.[0];
          return (
          <button key={a.id} className={`sidebar-item${selectedAgentId === a.id ? ' sidebar-item-active' : ''}`} onClick={() => { onSelectAgent(a.id); onNavigate?.(); }} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            width: 'calc(100% - 8px)',
            margin: '1px 4px',
            padding: '5px 10px',
            fontSize: 12,
            fontFamily: "'Courier New', monospace",
            border: 'none',
            borderLeft: selectedAgentId === a.id ? '3px solid #000' : '3px solid transparent',
            borderRight: selectedAgentId === a.id ? '3px solid #000' : '3px solid transparent',
            background: selectedAgentId === a.id ? '#fff' : 'transparent',
            color: '#000',
            cursor: 'pointer',
            textAlign: 'left',
          }}>
            <PresenceAvatar
              name={a.displayName ?? a.name}
              isAgent
              status={a.status as any}
              latestActivity={latestActivity}
              size={16}
            />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
              {a.displayName ?? a.name}
            </span>
            <span style={{ fontSize: 9, opacity: 0.78, fontWeight: 700 }}>{presenceLabel(a.status as any, latestActivity, true)}</span>
            <span style={{
              fontSize: 9,
              fontWeight: 700,
              border: '1.5px solid #000',
              padding: '0 4px',
              background: '#fff',
              letterSpacing: '0.5px',
            }}>
              {a.runtime.toUpperCase()}
            </span>
          </button>
          );
        })}

        <SectionHeader label={t('nav.machines')} count={machines.length} style={{ marginTop: 8 }} />
        {machines.length === 0 ? (
          runtimeStatus?.mode === 'paseo-daemon' && runtimeStatus.connected ? (
            <EmptyHint text="Paseo Daemon Connected" />
          ) : (
            <EmptyHint text="no daemon connected" />
          )
        ) : null}
        {machines.map((m) => (
          <div key={m.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '4px 14px',
            fontSize: 12,
          }}>
            <span style={{
              width: 8,
              height: 8,
              background: m.status === 'online' ? '#00c853' : '#555',
              border: '1.5px solid #000',
              flexShrink: 0,
            }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
              {m.hostname}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 'auto', padding: '8px 14px 12px', fontSize: 10, lineHeight: 1.5, opacity: 0.72 }}>
        <div>WEB {shortVersion(webVersion.version)}</div>
        <div>HUB {hubVersion ? shortVersion(hubVersion.version) : '...'}</div>
      </div>
    </div>
  );
}

function shortVersion(version: string): string {
  return version.length > 12 ? `${version.slice(0, 12)}` : version;
}

function versionTitle(webVersion: VersionInfo, hubVersion?: VersionInfo): string {
  const web = `web ${webVersion.version}${webVersion.commit ? ` (${webVersion.commit})` : ''}`;
  const hub = hubVersion ? `hub ${hubVersion.version}${hubVersion.commit ? ` (${hubVersion.commit})` : ''}` : 'hub loading';
  return `${web}\n${hub}`;
}

const miniButtonStyle: React.CSSProperties = {
  border: '2px solid #000',
  background: '#fff',
  color: '#000',
  fontFamily: "'Courier New', monospace",
  fontWeight: 700,
  cursor: 'pointer',
  minWidth: 24,
  height: 22,
};

const signOutButtonStyle: React.CSSProperties = {
  border: '1.5px solid #000',
  background: '#fff',
  color: '#000',
  fontFamily: "'Courier New', monospace",
  fontSize: 9,
  fontWeight: 700,
  cursor: 'pointer',
  padding: '1px 4px',
};

function navButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    width: 'calc(100% - 8px)',
    margin: '6px 4px 4px',
    padding: '7px 10px',
    fontSize: 13,
    fontFamily: "'Courier New', monospace",
    fontWeight: 700,
    border: 'none',
    borderLeft: active ? '3px solid #000' : '3px solid transparent',
    borderRight: active ? '3px solid #000' : '3px solid transparent',
    background: active ? '#000' : '#fff',
    color: active ? '#FFD700' : '#000',
    cursor: 'pointer',
    textAlign: 'left',
  };
}

function SectionHeader({ label, count, action, style }: { label: string; count: number; action?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ ...S.sectionHeader, ...style }}>
      <span>{label}</span>
      {action ?? (count > 0 && (
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          background: '#000',
          color: '#FFD700',
          padding: '1px 5px',
          minWidth: 18,
          textAlign: 'center',
        }}>
          {count}
        </span>
      ))}
    </div>
  );
}

function ChannelItem({ id, name, active, onClick, onDelete }: { id: string; name: string; active: boolean; onClick: () => void; onDelete?: () => void }) {
  return (
    <div
      className={`sidebar-item${active ? ' sidebar-item-active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 14px',
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        background: active ? '#FF4D8D' : 'transparent',
        color: active ? '#fff' : '#000',
        borderLeft: active ? '3px solid #000' : '3px solid transparent',
        borderRight: active ? '3px solid #000' : '3px solid transparent',
        margin: '1px 4px',
      }}
    >
      <span style={{ fontSize: 14, opacity: 0.7 }}>#</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      {onDelete ? (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          title={`Delete ${id}`}
          style={{ border: '1.5px solid #000', background: '#fff', color: '#000', fontWeight: 700, cursor: 'pointer', height: 20, minWidth: 20 }}
        >
          x
        </button>
      ) : null}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div style={{ padding: '3px 14px', fontSize: 11, opacity: 0.5, fontStyle: 'italic' }}>{text}</div>
  );
}
