import { useEffect, useState } from 'react';
import type React from 'react';
import type { KnowledgeEntry, KnowledgeKind, KnowledgeSearchResult, KnowledgeStatus } from '../api.js';
import { createKnowledge, patchKnowledge, searchKnowledge } from '../api.js';

const KINDS: KnowledgeKind[] = ['decision', 'project_archive', 'user_preference', 'runbook', 'learning', 'artifact'];
const STATUSES: KnowledgeStatus[] = ['active', 'stale', 'conflict', 'archived'];

export function KnowledgePanel({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KnowledgeKind | ''>('');
  const [tag, setTag] = useState('');
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [selected, setSelected] = useState<KnowledgeEntry | undefined>();
  const [form, setForm] = useState({ kind: 'decision' as KnowledgeKind, title: '', summary: '', body: '', tags: '', sourceRefs: '', status: 'active' as KnowledgeStatus });

  const load = async () => {
    const next = await searchKnowledge(query, { projectId, kind: kind || undefined, tag: tag.trim() || undefined });
    setResults(next);
    if (!selected && next[0]) setSelected(next[0].entry);
  };

  useEffect(() => { void load(); }, [projectId]);

  async function handleCreate() {
    const created = await createKnowledge({
      projectId,
      kind: form.kind,
      title: form.title,
      summary: form.summary,
      body: form.body,
      tags: split(form.tags),
      sourceRefs: split(form.sourceRefs),
      status: form.status,
      allowNoSource: split(form.sourceRefs).length === 0,
    });
    setSelected(created);
    setForm({ ...form, title: '', summary: '', body: '', sourceRefs: '' });
    await load();
  }

  async function handleStatus(entry: KnowledgeEntry, status: KnowledgeStatus) {
    const updated = await patchKnowledge(entry.id, { status });
    setSelected(updated);
    setResults((prev) => prev.map((result) => result.entry.id === updated.id ? { ...result, entry: updated } : result));
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(300px, 420px) 1fr', background: '#fafaf5', fontFamily: "'Courier New', monospace" }}>
      <section style={{ borderRight: '2px solid #000', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 14, borderBottom: '2px solid #000', background: '#fff', display: 'grid', gap: 8 }}>
          <strong>KNOWLEDGE</strong>
          <input aria-label="Knowledge search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void load(); }} placeholder="Search decisions, runbooks, archives" style={inputStyle} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
            <select aria-label="Kind filter" value={kind} onChange={(event) => setKind(event.target.value as KnowledgeKind | '')} style={inputStyle}>
              <option value="">all kinds</option>
              {KINDS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <input aria-label="Tag filter" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="tag" style={inputStyle} />
            <button onClick={() => void load()} style={buttonStyle}>SEARCH</button>
          </div>
        </div>
        <div style={{ overflow: 'auto', padding: 12, display: 'grid', gap: 8 }}>
          {results.map(({ entry }) => (
            <button key={entry.id} onClick={() => setSelected(entry)} style={{ ...cardStyle, textAlign: 'left', background: selected?.id === entry.id ? '#dcfce7' : '#fff' }}>
              <strong>{entry.title}</strong>
              <div style={metaStyle}>{entry.kind} · {entry.status}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>{entry.summary}</div>
            </button>
          ))}
        </div>
      </section>
      <section style={{ minHeight: 0, overflow: 'auto', padding: 16 }}>
        {selected ? (
          <article style={{ ...cardStyle, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{selected.title}</h2>
              <select aria-label="Knowledge status" value={selected.status} onChange={(event) => void handleStatus(selected, event.target.value as KnowledgeStatus)} style={inputStyle}>
                {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
            <div style={metaStyle}>{selected.kind} · {selected.tags.join(', ') || 'no tags'}</div>
            <p>{selected.summary}</p>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: "'Courier New', monospace", fontSize: 13 }}>{selected.body}</pre>
            <div style={metaStyle}>Sources: {selected.sourceRefs.join(', ') || 'manual'}</div>
          </article>
        ) : null}
        <section style={cardStyle}>
          <strong>CREATE ENTRY</strong>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as KnowledgeKind })} style={inputStyle}>{KINDS.map((item) => <option key={item} value={item}>{item}</option>)}</select>
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Title" style={inputStyle} />
            <input value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder="Summary" style={inputStyle} />
            <textarea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="Body" style={{ ...inputStyle, height: 110, paddingTop: 8 }} />
            <input value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} placeholder="tags, comma separated" style={inputStyle} />
            <input value={form.sourceRefs} onChange={(event) => setForm({ ...form, sourceRefs: event.target.value })} placeholder="source refs, comma separated" style={inputStyle} />
            <button onClick={() => void handleCreate()} disabled={!form.title || !form.summary || !form.body} style={buttonStyle}>CREATE</button>
          </div>
        </section>
      </section>
    </div>
  );
}

function split(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

const inputStyle: React.CSSProperties = {
  height: 32,
  border: '2px solid #000',
  background: '#fff',
  fontFamily: "'Courier New', monospace",
  fontSize: 12,
  padding: '0 8px',
};

const buttonStyle: React.CSSProperties = {
  height: 32,
  border: '2px solid #000',
  background: '#00ff66',
  color: '#000',
  fontFamily: "'Courier New', monospace",
  fontWeight: 700,
  cursor: 'pointer',
};

const cardStyle: React.CSSProperties = {
  border: '2px solid #000',
  background: '#fff',
  padding: 10,
  boxShadow: '3px 3px 0 #000',
};

const metaStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 11,
  color: '#555',
  fontWeight: 700,
};
