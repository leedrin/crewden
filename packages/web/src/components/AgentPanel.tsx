import { useEffect, useRef, useState } from 'react';
import type { Agent, Machine, RuntimeStatus } from '../api.js';
import { createAgent, deleteAgent, respondRuntimePermission, startAgent, stopAgent } from '../api.js';

type Props = {
  projectId: string;
  agents: Agent[];
  machines: Machine[];
  runtimeStatus?: RuntimeStatus;
  onAgentsChange: () => void;
  onRuntimeStatusRefresh?: () => void | Promise<void>;
  onClose?: () => void;
};
type PendingPermission = NonNullable<RuntimeStatus['agentHealth']>[number]['pendingPermissions'][number];

const FONT = "'Courier New', monospace";

const inputStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 12,
  border: '2px solid #000',
  borderRadius: 0,
  padding: '5px 8px',
  background: '#fff',
  color: '#000',
  width: '100%',
  outline: 'none',
};

const AUTO_ALLOW_RULES_KEY = 'crewden_auto_allow_rules_v1';

function buildAutoAllowRuleKey(agentId: string, kind: string, name: string): string {
  return `${agentId}::${kind}::${name}`;
}

export function AgentPanel({ projectId, agents, machines, runtimeStatus, onAgentsChange, onRuntimeStatusRefresh, onClose }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    displayName: '',
    runtime: 'claude' as 'claude' | 'codex' | 'gemini' | 'opencode' | 'pi',
    model: '',
    systemPrompt: '',
    machineId: '',
  });
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Agent | undefined>();
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [deleting, setDeleting] = useState(false);
  const [permissionActionKey, setPermissionActionKey] = useState<string | undefined>();
  const [permissionActionError, setPermissionActionError] = useState<string | undefined>();
  const [autoAllowRules, setAutoAllowRules] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(AUTO_ALLOW_RULES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  });
  const autoAttemptedPermissionIdsRef = useRef<Set<string>>(new Set());

  const onlineMachines = machines.filter((m) => m.status === 'online');

  useEffect(() => {
    if (!form.machineId && onlineMachines.length > 0) {
      setForm((f) => ({ ...f, machineId: onlineMachines[0].id }));
    }
  }, [machines]);

  const handleCreate = async () => {
    if (!form.name) return;
    setLoading(true);
    try {
      await createAgent({
        projectId,
        name: form.name,
        displayName: form.displayName || undefined,
        runtime: form.runtime,
        model: form.model || undefined,
        systemPrompt: form.systemPrompt || undefined,
        machineId: form.machineId || undefined,
      });
      setShowForm(false);
      setForm({ name: '', displayName: '', runtime: 'claude', model: '', systemPrompt: '', machineId: '' });
      onAgentsChange();
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await deleteAgent(deleteTarget.id);
      setDeleteTarget(undefined);
      onAgentsChange();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'DELETE FAILED');
    } finally {
      setDeleting(false);
    }
  };

  const handlePermission = async (
    agentId: string,
    permissionId: string,
    behavior: 'allow' | 'deny',
    selectedActionId?: string,
    options?: { silent?: boolean },
  ) => {
    const key = `${agentId}:${permissionId}:${behavior}:${selectedActionId ?? ''}`;
    setPermissionActionKey(key);
    if (!options?.silent) setPermissionActionError(undefined);
    try {
      await respondRuntimePermission(agentId, permissionId, { behavior, selectedActionId });
      await onAgentsChange();
      await onRuntimeStatusRefresh?.();
    } catch (err) {
      if (!options?.silent) {
        setPermissionActionError(err instanceof Error ? err.message : 'PERMISSION ACTION FAILED');
      }
      throw err;
    } finally {
      setPermissionActionKey(undefined);
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_ALLOW_RULES_KEY, JSON.stringify(autoAllowRules));
    } catch {
      // ignore persistence failures
    }
  }, [autoAllowRules]);

  useEffect(() => {
    const health = runtimeStatus?.agentHealth ?? [];
    const pendingIds = new Set<string>();
    for (const item of health) {
      for (const permission of item.pendingPermissions) {
        pendingIds.add(permission.id);
      }
    }
    for (const attempted of Array.from(autoAttemptedPermissionIdsRef.current)) {
      if (!pendingIds.has(attempted)) {
        autoAttemptedPermissionIdsRef.current.delete(attempted);
      }
    }
    if (permissionActionKey) return;
    for (const item of health) {
      for (const permission of item.pendingPermissions) {
        const ruleKey = buildAutoAllowRuleKey(item.id, permission.kind, permission.name);
        if (!autoAllowRules.includes(ruleKey)) continue;
        if (autoAttemptedPermissionIdsRef.current.has(permission.id)) continue;
        autoAttemptedPermissionIdsRef.current.add(permission.id);
        const selectedActionId = permission.actions?.find((action) => action.behavior === 'allow')?.id;
        void handlePermission(item.id, permission.id, 'allow', selectedActionId, { silent: true })
          .catch(() => {
            autoAttemptedPermissionIdsRef.current.delete(permission.id);
          });
        return;
      }
    }
  }, [autoAllowRules, permissionActionKey, runtimeStatus]);

  const toggleAutoAllow = (agentId: string, kind: string, name: string) => {
    const key = buildAutoAllowRuleKey(agentId, kind, name);
    setAutoAllowRules((current) => (
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : [...current, key]
    ));
  };

  const handleAllowAll = async (
    agentId: string,
    pendingPermissions: PendingPermission[],
  ) => {
    if (pendingPermissions.length === 0) return;
    setPermissionActionError(undefined);
    const batchKey = `batch:${agentId}`;
    setPermissionActionKey(batchKey);
    try {
      for (const permission of pendingPermissions) {
        const selectedActionId = permission.actions?.find((action) => action.behavior === 'allow')?.id;
        await respondRuntimePermission(agentId, permission.id, {
          behavior: 'allow',
          selectedActionId,
        });
      }
      await onAgentsChange();
      await onRuntimeStatusRefresh?.();
    } catch (err) {
      setPermissionActionError(err instanceof Error ? err.message : 'ALLOW ALL FAILED');
    } finally {
      setPermissionActionKey(undefined);
    }
  };

  return (
    <div className="right-panel right-panel-agents" style={{
      width: 280,
      background: '#fafaf5',
      borderLeft: '2px solid #000',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      fontFamily: FONT,
    }}>
      {/* Header */}
      <div style={{
        height: 48,
        padding: '0 12px',
        borderBottom: '2px solid #000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#fff',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: '0.5px' }}>▶ AGENTS</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <PxButton
            onClick={() => setShowForm(!showForm)}
            bg={showForm ? '#FFD700' : '#000'}
            color={showForm ? '#000' : '#FFD700'}
            small
          >
            {showForm ? '✕ CANCEL' : '+ NEW'}
          </PxButton>
          {onClose ? (
            <PxButton onClick={onClose} bg="#fff" color="#000" small>
              X
            </PxButton>
          ) : null}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {runtimeStatus ? (
          <div style={{
            border: '2px solid #000',
            background: '#fff',
            padding: 10,
            marginBottom: 10,
            fontSize: 11,
            display: 'grid',
            gap: 4,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>RUNTIME DIAGNOSTICS</span>
              <PxButton
                onClick={() => { void onRuntimeStatusRefresh?.(); }}
                bg="#fff"
                color="#000"
                small
              >
                REFRESH
              </PxButton>
            </div>
            <div>EFFECTIVE: <strong>{runtimeStatus.mode.toUpperCase()}</strong></div>
            <div>CONFIGURED: <strong>{runtimeStatus.configuredMode.toUpperCase()}</strong></div>
            <div>CONNECTED: <strong>{runtimeStatus.connected ? 'YES' : 'NO'}</strong></div>
            {runtimeStatus.daemonUrl ? <div>DAEMON URL: <strong>{runtimeStatus.daemonUrl}</strong></div> : null}
            <div>MCP BRIDGE: <strong>{runtimeStatus.mcpBridgeReady ? 'READY' : 'NOT READY'}</strong></div>
            {runtimeStatus.mcpBridgeBin ? <div style={{ overflowWrap: 'anywhere' }}>MCP BIN: {runtimeStatus.mcpBridgeBin}</div> : null}
            {runtimeStatus.fallbackReason ? <div style={{ color: '#b00020' }}>{runtimeStatus.fallbackReason}</div> : null}
            {runtimeStatus.diagnostics?.length ? (
              <div style={{ color: '#b00020', borderTop: '1px solid #ddd', paddingTop: 4 }}>
                {runtimeStatus.diagnostics.map((message) => (
                  <div key={message}>- {message}</div>
                ))}
              </div>
            ) : null}
            {runtimeStatus.alerts?.length ? (
              <div style={{ color: '#b00020', borderTop: '1px solid #ddd', paddingTop: 4 }}>
                <div style={{ fontWeight: 700 }}>ALERTS</div>
                {runtimeStatus.alerts.map((message) => (
                  <div key={message}>- {message}</div>
                ))}
              </div>
            ) : null}
            {runtimeStatus.agentHealth?.length ? (
              <div style={{ borderTop: '1px solid #ddd', paddingTop: 4, display: 'grid', gap: 4 }}>
                <div style={{ fontWeight: 700 }}>AGENT HEALTH</div>
                {runtimeStatus.agentHealth.map((item) => (
                  <div key={item.id} style={{ border: '1px solid #ddd', padding: 4 }}>
                    <div><strong>{item.name}</strong> · {item.status} · {item.runtimeLifecycle ?? '-'}</div>
                    {item.pendingPermissions.length > 0 ? (
                      <div style={{ color: '#b00020', overflowWrap: 'anywhere' }}>
                        <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>pending requests: {item.pendingPermissions.length}</span>
                          <PxButton
                            onClick={() => { void handleAllowAll(item.id, item.pendingPermissions); }}
                            disabled={Boolean(permissionActionKey)}
                            bg="#00c853"
                            color="#fff"
                            small
                          >
                            {permissionActionKey === `batch:${item.id}` ? 'ALLOWING...' : 'ALLOW ALL'}
                          </PxButton>
                        </div>
                        {item.pendingPermissions.map((permission) => (
                          <div
                            key={permission.id}
                            style={{ border: '1px solid #f0b4c4', background: '#fff7fb', padding: 4, marginBottom: 4 }}
                          >
                            <div><strong>[{permission.kind}] {permission.name}</strong></div>
                            {permission.title ? <div>{permission.title}</div> : null}
                            {permission.description ? <div>{permission.description}</div> : null}
                            <div style={{ fontSize: 10 }}>req: {permission.id.slice(0, 8)}</div>
                            <div style={{ marginTop: 4 }}>
                              <PxButton
                                onClick={() => toggleAutoAllow(item.id, permission.kind, permission.name)}
                                disabled={Boolean(permissionActionKey)}
                                bg={autoAllowRules.includes(buildAutoAllowRuleKey(item.id, permission.kind, permission.name)) ? '#000' : '#fff'}
                                color={autoAllowRules.includes(buildAutoAllowRuleKey(item.id, permission.kind, permission.name)) ? '#FFD700' : '#000'}
                                small
                              >
                                {autoAllowRules.includes(buildAutoAllowRuleKey(item.id, permission.kind, permission.name))
                                  ? 'AUTO ALLOW: ON'
                                  : 'AUTO ALLOW SAME: OFF'}
                              </PxButton>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                              {permission.actions?.length
                                ? permission.actions.map((action) => {
                                  const actionKey = `${item.id}:${permission.id}:${action.behavior}:${action.id}`;
                                  const busy = permissionActionKey === actionKey;
                                  return (
                                    <PxButton
                                      key={action.id}
                                      onClick={() => { void handlePermission(item.id, permission.id, action.behavior, action.id); }}
                                      disabled={Boolean(permissionActionKey)}
                                      bg={action.behavior === 'allow' ? '#00c853' : '#f44336'}
                                      color="#fff"
                                      small
                                    >
                                      {busy ? 'PROCESSING' : action.label.toUpperCase()}
                                    </PxButton>
                                  );
                                })
                                : (
                                  <>
                                    <PxButton
                                      onClick={() => { void handlePermission(item.id, permission.id, 'allow'); }}
                                      disabled={Boolean(permissionActionKey)}
                                      bg="#00c853"
                                      color="#fff"
                                      small
                                    >
                                      {permissionActionKey === `${item.id}:${permission.id}:allow:` ? 'PROCESSING' : 'ALLOW'}
                                    </PxButton>
                                    <PxButton
                                      onClick={() => { void handlePermission(item.id, permission.id, 'deny'); }}
                                      disabled={Boolean(permissionActionKey)}
                                      bg="#f44336"
                                      color="#fff"
                                      small
                                    >
                                      {permissionActionKey === `${item.id}:${permission.id}:deny:` ? 'PROCESSING' : 'DENY'}
                                    </PxButton>
                                  </>
                                )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {item.issues.length > 0 ? (
                      <div style={{ color: '#b00020', overflowWrap: 'anywhere' }}>
                        issues: {item.issues.join(', ')}
                      </div>
                    ) : null}
                  </div>
                ))}
                {permissionActionError ? <div style={{ color: '#b00020' }}>{permissionActionError}</div> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Create form */}
        {showForm && (
          <div style={{
            border: '2px solid #000',
            background: '#fff',
            padding: 10,
            marginBottom: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
            <FieldLabel>NAME *</FieldLabel>
            <input
              placeholder="my-agent"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              style={inputStyle}
            />
            <FieldLabel>DISPLAY NAME</FieldLabel>
            <input
              placeholder="My Agent"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              style={inputStyle}
            />
            <FieldLabel>RUNTIME</FieldLabel>
            <select
              value={form.runtime}
              onChange={(e) => setForm((f) => ({ ...f, runtime: e.target.value as any }))}
              style={inputStyle}
            >
              <option value="claude">CLAUDE</option>
              <option value="codex">CODEX</option>
              <option value="opencode">OPENCODE</option>
              <option value="pi">PI</option>
              <option value="gemini">GEMINI</option>
            </select>
            <FieldLabel>MODEL (OPTIONAL)</FieldLabel>
            <input
              placeholder="e.g. claude-opus-4-5"
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              style={inputStyle}
            />
            <FieldLabel>SYSTEM PROMPT</FieldLabel>
            <textarea
              placeholder="You are a helpful assistant..."
              value={form.systemPrompt}
              onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.4 }}
            />
            {onlineMachines.length > 0 && (
              <>
                <FieldLabel>MACHINE</FieldLabel>
                <select
                  value={form.machineId}
                  onChange={(e) => setForm((f) => ({ ...f, machineId: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">-- none --</option>
                  {onlineMachines.map((m) => (
                    <option key={m.id} value={m.id}>{m.hostname}</option>
                  ))}
                </select>
              </>
            )}
            <div style={{ marginTop: 4 }}>
              <PxButton
                onClick={handleCreate}
                disabled={loading || !form.name}
                bg={loading || !form.name ? '#ccc' : '#FF4D8D'}
                color="#fff"
                full
              >
                {loading ? 'CREATING...' : '▶ CREATE AGENT'}
              </PxButton>
            </div>
          </div>
        )}

        {/* Agent list */}
        {agents.length === 0 && !showForm && (
          <div style={{
            fontSize: 11,
            color: '#aaa',
            textAlign: 'center',
            marginTop: 20,
            border: '2px dashed #ccc',
            padding: 16,
            lineHeight: 1.8,
          }}>
            [ NO AGENTS ]<br />
            <span>click + NEW to create one</span>
          </div>
        )}
        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            onStart={() => { startAgent(a.id).then(onAgentsChange); }}
            onStop={() => { stopAgent(a.id).then(onAgentsChange); }}
            onDelete={() => {
              setDeleteTarget(a);
              setDeleteError(undefined);
            }}
          />
        ))}
      </div>
      {deleteTarget ? (
        <DeleteAgentModal
          agent={deleteTarget}
          error={deleteError}
          deleting={deleting}
          onCancel={() => {
            if (deleting) return;
            setDeleteTarget(undefined);
            setDeleteError(undefined);
          }}
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  );
}

function AgentCard({ agent, onStart, onStop, onDelete }: { agent: Agent; onStart: () => void; onStop: () => void; onDelete: () => void }) {
  const statusColor = agent.status === 'idle' || agent.status === 'running' ? '#00c853'
    : agent.status === 'working' ? '#FFD700'
    : agent.status === 'starting' ? '#2196f3'
    : agent.status === 'error' ? '#f44336'
    : '#ccc';

  const runtimeBg: Record<string, string> = {
    claude: '#e8f0ff',
    codex: '#e8f5e9',
    opencode: '#fff5e6',
    pi: '#f3e8ff',
    gemini: '#fff8e1',
  };

  return (
    <div style={{
      border: '2px solid #000',
      background: '#fff',
      padding: '8px 10px',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <span style={{
          width: 9,
          height: 9,
          background: statusColor,
          border: '1.5px solid #000',
          flexShrink: 0,
        }} />
        <span style={{ fontWeight: 700, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agent.displayName ?? agent.name}
        </span>
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          border: '1.5px solid #000',
          padding: '1px 5px',
          background: runtimeBg[agent.runtime] ?? '#f5f5f5',
          letterSpacing: '0.5px',
        }}>
          {agent.runtime.toUpperCase()}
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 7, letterSpacing: '0.3px' }}>
        STATUS: {agent.status.toUpperCase()} · AUTO START: {agent.autoStart ? 'ON' : 'OFF'}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['inactive', 'error'].includes(agent.status) ? (
          <PxButton onClick={onStart} bg="#00c853" color="#fff" small>▶ START</PxButton>
        ) : (
          <PxButton onClick={onStop} bg="#f44336" color="#fff" small>■ STOP</PxButton>
        )}
        <PxButton onClick={onDelete} bg="#fff" color="#b00020" small>DELETE</PxButton>
      </div>
    </div>
  );
}

function DeleteAgentModal({ agent, error, deleting, onCancel, onConfirm }: {
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
            <PxButton onClick={onCancel} disabled={deleting} bg="#fff" color="#000" small>CANCEL</PxButton>
            <PxButton onClick={onConfirm} disabled={deleting} bg="#b00020" color="#fff" small>{deleting ? 'DELETING' : 'DELETE'}</PxButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', color: '#666', marginTop: 2 }}>
      {children}
    </div>
  );
}

function PxButton({ onClick, bg, color, children, disabled, small, full }: {
  onClick: () => void;
  bg: string;
  color: string;
  children: React.ReactNode;
  disabled?: boolean;
  small?: boolean;
  full?: boolean;
}) {
  const [pressing, setPressing] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseDown={() => setPressing(true)}
      onMouseUp={() => setPressing(false)}
      onMouseLeave={() => setPressing(false)}
      style={{
        fontFamily: FONT,
        fontWeight: 700,
        fontSize: small ? 11 : 12,
        border: '2px solid #000',
        borderRadius: 0,
        padding: small ? '3px 10px' : '6px 12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? '#ccc' : bg,
        color: disabled ? '#888' : color,
        boxShadow: !disabled && !pressing ? '2px 2px 0 #000' : 'none',
        transform: pressing && !disabled ? 'translate(2px, 2px)' : 'none',
        transition: 'box-shadow 0.05s, transform 0.05s',
        letterSpacing: '0.5px',
        width: full ? '100%' : undefined,
      }}
    >
      {children}
    </button>
  );
}
