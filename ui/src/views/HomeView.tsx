import { useEffect, useState, type MouseEvent } from 'react';
import { AppWindow, Hammer, Plus, Puzzle, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { EngineId, EngineStatus, Project, ProjectType } from '../types';
import { ENGINE_LABELS } from '../types';
import { useToast } from '../toast';

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function HomeView(props: {
  projects: Project[];
  onOpen: (id: string) => void;
  onChanged: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); setShowNew(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const remove = async (e: MouseEvent, p: Project) => {
    e.stopPropagation();
    if (!window.confirm(`Delete “${p.name}”? The project folder is moved to Trash.`)) return;
    await api.deleteProject(p.id);
    toast('info', `Deleted ${p.name}`);
    props.onChanged();
  };

  return (
    <div className="home">
      <div className="home-header">
        <h1>My Projects</h1>
        <button className="btn primary" onClick={() => setShowNew(true)}>
          <Plus size={14} /> New Project
        </button>
      </div>

      {props.projects.length === 0 ? (
        <div className="empty">
          <Hammer size={36} color="var(--text-3)" />
          <h2>Nothing here yet</h2>
          <p>Describe an app or a browser extension, and Kiln will build it.</p>
          <button className="btn primary lg" onClick={() => setShowNew(true)}>
            <Plus size={15} /> Create your first project
          </button>
        </div>
      ) : (
        <div className="project-grid">
          {props.projects.map((p) => (
            <div key={p.id} className="project-card" onClick={() => props.onOpen(p.id)}>
              {p.icon
                ? <img className="icon" src={p.icon} alt="" />
                : <div className="icon" style={{ background: 'var(--bg-inset)' }} />}
              <h3>{p.name}</h3>
              <div className="meta">
                {p.type === 'mac-app' ? <AppWindow size={12} /> : <Puzzle size={12} />}
                <span>{p.type === 'mac-app' ? 'Mac App' : 'Extension'}</span>
                <span>·</span>
                <span>{p.latestVersion > 0 ? `v${p.latestVersion}` : 'new'}</span>
                <span>·</span>
                <span>{timeAgo(p.lastEditedAt)}</span>
              </div>
              <button className="btn ghost icon kebab" title="Delete" onClick={(e) => remove(e, p)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button className="project-card card-new" onClick={() => setShowNew(true)}>
            <Plus size={20} />
            <span>New Project</span>
          </button>
        </div>
      )}

      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreated={(id) => { setShowNew(false); props.onChanged(); props.onOpen(id); }}
        />
      )}
    </div>
  );
}

function NewProjectModal(props: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ProjectType>('mac-app');
  const [engine, setEngine] = useState<EngineId>('claude-sub');
  const [engines, setEngines] = useState<EngineStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void api.getEngines().then((es) => {
      setEngines(es);
      void api.getSettings().then((s) => {
        const preferred = es.find((e) => e.id === s.defaultEngine);
        if (preferred?.installed && preferred.authenticated) setEngine(preferred.id);
        else {
          const ready = es.find((e) => e.installed && e.authenticated);
          if (ready) setEngine(ready.id);
        }
      });
    });
  }, []);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const p = await api.createProject({ name: name.trim(), type, engine });
      props.onCreated(p.id);
    } catch (err) {
      toast('err', `Could not create project: ${String(err)}`);
      setBusy(false);
    }
  };

  return (
    <div className="modal-veil" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Project</h2>

        <div className="field">
          <label>Name</label>
          <input
            type="text" autoFocus placeholder="e.g. Pomodoro"
            value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
        </div>

        <div className="field">
          <label>Type</label>
          <div className="type-picker">
            <button className={`type-option ${type === 'mac-app' ? 'on' : ''}`} onClick={() => setType('mac-app')}>
              <AppWindow size={18} color={type === 'mac-app' ? 'var(--accent)' : 'var(--text-2)'} />
              <h4>Mac App</h4>
              <p>A real desktop app. Exports as a DMG.</p>
            </button>
            <button className={`type-option ${type === 'extension' ? 'on' : ''}`} onClick={() => setType('extension')}>
              <Puzzle size={18} color={type === 'extension' ? 'var(--accent)' : 'var(--text-2)'} />
              <h4>Browser Extension</h4>
              <p>Chrome, Edge &amp; Firefox. Exports as ZIPs.</p>
            </button>
          </div>
        </div>

        <div className="field">
          <label>Engine</label>
          <select value={engine} onChange={(e) => setEngine(e.target.value as EngineId)}>
            {(Object.keys(ENGINE_LABELS) as EngineId[]).map((id) => {
              const st = engines.find((e) => e.id === id);
              const ready = st?.installed && st.authenticated;
              return (
                <option key={id} value={id}>
                  {ENGINE_LABELS[id].name} — {ENGINE_LABELS[id].sub}{ready ? '' : ' (not set up)'}
                </option>
              );
            })}
          </select>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={props.onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim() || busy} onClick={create}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
