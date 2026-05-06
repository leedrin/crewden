import { useState, useRef } from 'react';
import type { Agent, DeliveryBehavior } from '../api.js';
import { t } from '../i18n.js';

type Props = {
  agents: Agent[];
  channelName?: string;
  content?: string;
  sendBehavior: DeliveryBehavior;
  onSendBehaviorChange: (behavior: DeliveryBehavior) => void;
  queueStateByAgent: Record<string, { depth: number; processing: boolean }>;
  onChange?: (content: string) => void;
  onSend: (content: string, agentId?: string) => void | Promise<void>;
};

export function Composer({
  agents,
  channelName,
  content,
  sendBehavior,
  onSendBehaviorChange,
  queueStateByAgent,
  onChange,
  onSend,
}: Props) {
  const [internalContent, setInternalContent] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('');
  const [pressing, setPressing] = useState(false);
  const [sending, setSending] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const value = content ?? internalContent;
  const updateContent = onChange ?? setInternalContent;

  const handleSend = async () => {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      // When "To Somebody" is selected, prepend @mention so the message
      // renders with the same highlight as inline @mentions.
      let finalContent = trimmed;
      if (selectedAgent) {
        const target = agents.find((a) => a.id === selectedAgent);
        if (target) {
          const label = target.displayName ?? target.name;
          const mentionPrefix = `@${label} `;
          if (!trimmed.startsWith(mentionPrefix)) {
            finalContent = `${mentionPrefix}${trimmed}`;
          }
        }
      }
      await onSend(finalContent, selectedAgent || undefined);
      if (!onChange) setInternalContent('');
      textareaRef.current?.focus();
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionOpen && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key) && !e.nativeEvent.isComposing) {
      const options = mentionOptions(agents);
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((index) => (index + 1) % options.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((index) => (index - 1 + options.length) % options.length);
      } else {
        e.preventDefault();
        insertMention(options[mentionIndex]?.label ?? 'user');
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  const insertMention = (label: string) => {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? value.length;
    const before = value.slice(0, cursor).replace(/@[\p{L}\p{N}_-]*$/u, '');
    const after = value.slice(cursor);
    const next = `${before}@${label} ${after}`;
    updateContent(next);
    setMentionOpen(false);
    requestAnimationFrame(() => {
      textarea?.focus();
      const pos = `${before}@${label} `.length;
      textarea?.setSelectionRange(pos, pos);
    });
  };

  const runningAgents = agents.filter((a) => ['running', 'idle', 'working'].includes(a.status));
  const selectedAgentStatus = selectedAgent ? agents.find((agent) => agent.id === selectedAgent)?.status : undefined;
  const selectedQueueState = selectedAgent ? queueStateByAgent[selectedAgent] : undefined;
  const willQueueOnSend = Boolean(selectedAgent && sendBehavior === 'queue' && isAgentBusyStatus(selectedAgentStatus));
  const canSend = value.trim().length > 0 && !sending;

  return (
    <div className="composer-shell" style={{
      padding: '10px 16px 14px',
      background: '#fff',
      borderTop: '2px solid #000',
      fontFamily: "'Courier New', monospace",
      flexShrink: 0,
    }}>
      {/* Agent selector */}
      {runningAgents.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
          fontSize: 11,
          fontWeight: 700,
        }}>
          <span style={{ color: '#888', letterSpacing: '0.5px' }}>TO:</span>
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            style={{
              fontFamily: "'Courier New', monospace",
              fontSize: 11,
              fontWeight: 700,
              border: '2px solid #000',
              borderRadius: 0,
              background: selectedAgent ? '#FFD700' : '#f5f5f5',
              color: '#000',
              padding: '2px 6px',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="">[ BROADCAST ]</option>
            {runningAgents.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.displayName ?? a.name}
                {queueStateByAgent[a.id]?.depth ? ` (Q${queueStateByAgent[a.id]?.depth})` : ''}
              </option>
            ))}
          </select>
          <div style={{ display: 'inline-flex', marginLeft: 'auto', border: '1.5px solid #111' }}>
            <button
              type="button"
              onClick={() => onSendBehaviorChange('interrupt')}
              style={sendBehaviorToggleStyle(sendBehavior === 'interrupt')}
            >
              INTERRUPT
            </button>
            <button
              type="button"
              onClick={() => onSendBehaviorChange('queue')}
              style={sendBehaviorToggleStyle(sendBehavior === 'queue')}
            >
              QUEUE
            </button>
          </div>
        </div>
      )}
      {selectedAgent && selectedQueueState ? (
        <div style={{
          marginBottom: 6,
          border: '1.5px solid #111',
          background: '#f5f5f5',
          color: '#111',
          fontSize: 10,
          fontWeight: 700,
          padding: '4px 6px',
          lineHeight: 1.35,
        }}>
          Queue @{agents.find((agent) => agent.id === selectedAgent)?.displayName ?? selectedAgent}: {selectedQueueState.depth} pending{selectedQueueState.processing ? ', dispatching' : ''}
        </div>
      ) : null}

      {/* Input row */}
      <div className="composer-input-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-end', position: 'relative' }}>
        {mentionOpen ? (
          <div className="mention-menu" style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            marginBottom: 6,
            minWidth: 220,
            border: '1.5px solid #111',
            background: '#fff',
            boxShadow: '2px 2px 0 #111',
            zIndex: 5,
          }}>
            {mentionOptions(agents).map((option, index) => (
              <button
                key={`${option.type}:${option.id}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertMention(option.label);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  border: 'none',
                  background: index === mentionIndex ? '#FFD700' : '#fff',
                  padding: '6px 8px',
                  textAlign: 'left',
                  fontFamily: "'Courier New', monospace",
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <span style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: option.online ? '#22c55e' : '#d1d5db',
                  flexShrink: 0,
                }} />
                @{option.label}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            updateContent(e.target.value);
            const cursor = e.currentTarget.selectionStart;
            setMentionOpen(/@[\p{L}\p{N}_-]*$/u.test(e.target.value.slice(0, cursor)));
            setMentionIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t('composer.placeholder').replace('{channel}', channelName ?? 'channel')}
          rows={2}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: "'Courier New', monospace",
            fontSize: 13,
            border: '2px solid #000',
            borderRadius: 0,
            padding: '8px 10px',
            resize: 'none',
            outline: 'none',
            background: '#fff',
            color: '#000',
            lineHeight: 1.5,
          }}
          onFocus={(e) => { e.currentTarget.style.outline = '2px solid #FF4D8D'; e.currentTarget.style.outlineOffset = '-2px'; }}
          onBlur={(e) => { e.currentTarget.style.outline = 'none'; }}
        />
        <button
          onClick={() => void handleSend()}
          onMouseDown={() => setPressing(true)}
          onMouseUp={() => setPressing(false)}
          onMouseLeave={() => setPressing(false)}
          disabled={!canSend}
          style={{
            fontFamily: "'Courier New', monospace",
            fontWeight: 700,
            fontSize: 13,
            border: '2px solid #000',
            borderRadius: 0,
            padding: '8px 18px',
            cursor: canSend ? 'pointer' : 'not-allowed',
            background: canSend ? '#FF4D8D' : '#eee',
            color: canSend ? '#fff' : '#aaa',
            boxShadow: canSend && !pressing ? '3px 3px 0 #000' : 'none',
            transform: pressing && canSend ? 'translate(2px, 2px)' : 'none',
            transition: 'box-shadow 0.05s, transform 0.05s',
            letterSpacing: '0.5px',
            alignSelf: 'stretch',
          }}
        >
          {willQueueOnSend ? 'QUEUE ▶' : `${t('composer.send')} ▶`}
        </button>
      </div>
    </div>
  );
}

const ONLINE_STATUSES = new Set(['running', 'idle', 'working']);
const BUSY_STATUSES = new Set(['running', 'working', 'starting']);

function mentionOptions(agents: Agent[]): Array<{ type: 'agent' | 'user'; id: string; label: string; online: boolean }> {
  return [
    { type: 'user', id: 'user', label: 'user', online: true },
    ...agents.map((agent) => ({
      type: 'agent' as const,
      id: agent.id,
      label: agent.displayName ?? agent.name,
      online: ONLINE_STATUSES.has(agent.status),
    })),
  ];
}

function sendBehaviorToggleStyle(active: boolean): React.CSSProperties {
  return {
    border: 'none',
    borderRight: active ? 'none' : '1px solid #111',
    background: active ? '#111' : '#fff',
    color: active ? '#FFD700' : '#111',
    padding: '3px 8px',
    fontFamily: "'Courier New', monospace",
    fontSize: 10,
    fontWeight: 700,
    cursor: 'pointer',
  };
}

function isAgentBusyStatus(status: string | undefined): boolean {
  if (!status) return false;
  return BUSY_STATUSES.has(status);
}
