import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUp, Check, ChevronDown, ChevronRight, FileCode2, Eye,
  ListChecks, OctagonX, ShieldCheck, Sparkles, TerminalSquare, X,
} from 'lucide-react';
import { api } from '../api';
import type { AgentEvent, ChatMessage, Project, RunMode } from '../types';

const EVENT_ICON: Record<AgentEvent['kind'], ReactNode> = {
  thinking: <Sparkles size={13} />,
  read: <Eye size={13} />,
  edit: <FileCode2 size={13} />,
  command: <TerminalSquare size={13} />,
  gate: <ShieldCheck size={13} />,
  text: <ListChecks size={13} />,
  error: <OctagonX size={13} />,
};

function StepRow({ e }: { e: AgentEvent }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(e.detail);
  return (
    <div className="step">
      <button className="step-row" onClick={() => expandable && setOpen(!open)}>
        {expandable ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12 }} />}
        {EVENT_ICON[e.kind]}
        <span className="label">{e.label}</span>
        {e.status === 'running' && <span className="spinner" />}
        {e.status === 'ok' && <Check size={13} className="status-ok" />}
        {e.status === 'fail' && <X size={13} className="status-fail" />}
      </button>
      {open && e.detail && <pre className="step-detail">{e.detail}</pre>}
    </div>
  );
}

export default function ChatPane({ project }: { project: Project }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<RunMode>('build');
  const scrollRef = useRef<HTMLDivElement>(null);
  const running = project.status === 'agent-running';

  useEffect(() => {
    void api.getChat(project.id).then(setMessages);
    return api.onChatUpdate((pid, msg) => {
      if (pid !== project.id) return;
      setMessages((prev) => {
        const i = prev.findIndex((m) => m.id === msg.id);
        if (i === -1) return [...prev, msg];
        const next = [...prev]; next[i] = msg; return next;
      });
    });
  }, [project.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = () => {
    const text = draft.trim();
    if (!text || running) return;
    setDraft('');
    void api.sendPrompt(project.id, text, mode);
  };

  return (
    <div className="chat-pane">
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty" style={{ padding: '48px 12px' }}>
            <Sparkles size={26} color="var(--text-3)" />
            <h2 style={{ fontSize: 14 }}>Describe your {project.type === 'mac-app' ? 'app' : 'extension'}</h2>
            <p style={{ margin: 0, fontSize: 12 }}>
              Be specific about what it should do. You can refine it with follow-up prompts — every change is a
              version you can revert.
            </p>
          </div>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg-user">{m.text}</div>
          ) : (
            <div key={m.id} className="msg-agent">
              {m.events && m.events.length > 0 && (
                <div className="steps">{m.events.map((e) => <StepRow key={e.id} e={e} />)}</div>
              )}
              {m.text && <div className="summary">{m.text}</div>}
              {m.versionTag && <span className="badge accent vtag">{m.versionTag} saved</span>}
            </div>
          ),
        )}
      </div>

      <div className="composer">
        <div className="composer-box">
          <textarea
            placeholder={mode === 'plan' ? 'Describe a change to plan first…' : 'Describe what to build or change…'}
            value={draft}
            disabled={running}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
            }}
          />
          <div className="composer-row">
            <div className="seg">
              <button className={mode === 'build' ? 'on' : ''} onClick={() => setMode('build')}>Build</button>
              <button className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>Plan</button>
            </div>
            {running ? (
              <button className="btn danger" onClick={() => void api.cancelRun(project.id)}>
                <OctagonX size={13} /> Cancel
              </button>
            ) : (
              <button className="btn primary icon" title="Send (⌘↩)" disabled={!draft.trim()} onClick={send}>
                <ArrowUp size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
