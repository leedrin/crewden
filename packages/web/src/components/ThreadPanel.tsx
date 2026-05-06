import { useEffect, useRef } from 'react';
import type { Agent, AgentActivity, Decision, Document, Message } from '../api.js';
import { MessageContent } from './MessageContent.js';
import { PresenceAvatar } from './PresenceAvatar.js';
import { Composer } from './Composer.js';
import { t } from '../i18n.js';

type Props = {
  root: Message;
  replies: Message[];
  linkedDecisions?: Decision[];
  linkedDocuments?: Document[];
  agents: Agent[];
  activitiesByAgent: Record<string, AgentActivity[]>;
  targetMessageId?: string;
  onClose: () => void;
  onSend: (content: string, agentId?: string) => void;
  onOpenAgent?: (agentId: string) => void;
  onTargetMessageSettled?: () => void;
};

export function ThreadPanel({
  root,
  replies,
  linkedDecisions,
  linkedDocuments,
  agents,
  activitiesByAgent,
  targetMessageId,
  onClose,
  onSend,
  onOpenAgent,
  onTargetMessageSettled,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    if (targetMessageId) {
      const target = scrollEl.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(targetMessageId)}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        target.classList.add('message-row-target');
        window.setTimeout(() => target.classList.remove('message-row-target'), 1800);
        onTargetMessageSettled?.();
      }
      return;
    }
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [replies, targetMessageId, onTargetMessageSettled]);

  return (
    <aside className="right-panel right-panel-thread" style={{
      width: 340,
      maxWidth: '42vw',
      borderLeft: '1px solid #d7d7ca',
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
      fontFamily: "'Courier New', monospace",
    }}>
      <div style={{
        height: 48,
        borderBottom: '1px solid #d7d7ca',
        padding: '0 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <strong>{t('thread.title')}</strong>
        <button onClick={onClose} style={smallButtonStyle}>{t('thread.close')}</button>
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12, background: '#fbfbf7' }}>
        {(linkedDecisions?.length || linkedDocuments?.length) ? (
          <div style={{ marginBottom: 12, border: '1.5px solid #000', background: '#fff', padding: 8, fontSize: 11, lineHeight: 1.35 }}>
            <strong>LINKED</strong>
            {linkedDecisions?.length ? (
              <div style={{ marginTop: 4 }}>
                Decisions: {linkedDecisions.map((decision) => `${decision.id}(${decision.status})`).join(', ')}
              </div>
            ) : null}
            {linkedDocuments?.length ? (
              <div style={{ marginTop: 4 }}>
                Documents: {linkedDocuments.map((document) => `${document.id}(${document.kind}/${document.status})`).join(', ')}
              </div>
            ) : null}
          </div>
        ) : null}
        <ThreadMessage
          message={root}
          agents={agents}
          activitiesByAgent={activitiesByAgent}
          onOpenAgent={onOpenAgent}
          root
        />
        <div style={{ height: 1, background: '#ddd', margin: '12px 0' }} />
        {replies.map((reply, index) => {
          const prev = replies[index - 1];
          const grouped = !!prev && prev.senderName === reply.senderName &&
            new Date(reply.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60 * 1000;
          return (
            <ThreadMessage
              key={reply.id}
              message={reply}
              agents={agents}
              activitiesByAgent={activitiesByAgent}
              grouped={grouped}
              onOpenAgent={onOpenAgent}
            />
          );
        })}
        {replies.length === 0 ? (
          <div style={{ color: '#888', fontSize: 12, padding: '12px 0' }}>{t('thread.replyPlaceholder')}</div>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <Composer agents={agents} channelName={t('thread.title')} onSend={onSend} />
    </aside>
  );
}

function ThreadMessage({ message, agents, activitiesByAgent, root = false, grouped = false, onOpenAgent }: {
  message: Message;
  agents: Agent[];
  activitiesByAgent: Record<string, AgentActivity[]>;
  root?: boolean;
  grouped?: boolean;
  onOpenAgent?: (agentId: string) => void;
}) {
  const agent = message.agentId ? agents.find((candidate) => candidate.id === message.agentId) : undefined;
  return (
    <div data-message-id={message.id} style={{ display: 'flex', gap: 9, padding: root ? '4px 0 8px' : grouped ? '1px 0 1px 39px' : '8px 0' }}>
      {!grouped && (
        <PresenceAvatar
          name={message.senderName}
          isAgent={!!message.agentId}
          status={agent?.status as any}
          latestActivity={message.agentId ? activitiesByAgent[message.agentId]?.[0] : undefined}
          size={30}
          onClick={agent ? () => onOpenAgent?.(agent.id) : undefined}
        />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        {!grouped && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 }}>
            <strong style={{ fontSize: 12 }}>{message.senderName}</strong>
            <span style={{ fontSize: 10, color: '#888' }}>{formatTime(message.createdAt)}</span>
          </div>
        )}
        <MessageContent content={message.content} mentions={message.mentions} onOpenAgent={onOpenAgent} />
      </div>
    </div>
  );
}

const smallButtonStyle: React.CSSProperties = {
  border: '1px solid #bbb',
  background: '#fff',
  fontFamily: "'Courier New', monospace",
  fontWeight: 700,
  cursor: 'pointer',
  padding: '4px 7px',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
