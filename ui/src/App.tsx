import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Hammer, Settings as SettingsIcon } from 'lucide-react';
import { api, isMock } from './api';
import type { Project } from './types';
import { ToastProvider } from './toast';
import HomeView from './views/HomeView';
import BuilderView from './views/BuilderView';
import SettingsView from './views/SettingsView';

type Route = { view: 'home' } | { view: 'builder'; projectId: string } | { view: 'settings' };

export default function App() {
  const [route, setRoute] = useState<Route>({ view: 'home' });
  const [projects, setProjects] = useState<Project[]>([]);

  const refresh = useCallback(() => { void api.listProjects().then(setProjects); }, []);
  useEffect(() => {
    refresh();
    return api.onProjectUpdate((p) =>
      setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x))),
    );
  }, [refresh]);

  const openProject = (projectId: string) => setRoute({ view: 'builder', projectId });
  const current = route.view === 'builder' ? projects.find((p) => p.id === route.projectId) : undefined;

  return (
    <ToastProvider>
      <div className="app">
        <div className="titlebar">
          {route.view !== 'home' ? (
            <button className="btn ghost icon" title="Back" onClick={() => { refresh(); setRoute({ view: 'home' }); }}>
              <ArrowLeft size={15} />
            </button>
          ) : (
            <Hammer size={15} color="var(--text-2)" />
          )}
          <span className="titlebar-title">
            {route.view === 'home' && 'Kiln'}
            {route.view === 'settings' && 'Settings'}
            {route.view === 'builder' && (current?.name ?? 'Project')}
          </span>
          {route.view === 'builder' && current && (
            <span className="badge">{current.type === 'mac-app' ? 'Mac App' : 'Extension'}</span>
          )}
          <div className="titlebar-spacer" />
          <div className="app-credit" aria-label="Creator links">
            <span>built by</span>
            <a href="https://tanziro.com/" target="_blank" rel="noreferrer">tanziro.com</a>
            <span aria-hidden="true">·</span>
            <a href="https://buymeacoffee.com/tanzir" target="_blank" rel="noreferrer">buy me a coffee</a>
          </div>
          {route.view === 'home' && (
            <button className="btn ghost icon" title="Settings" onClick={() => setRoute({ view: 'settings' })}>
              <SettingsIcon size={15} />
            </button>
          )}
        </div>

        <div className="content">
          {route.view === 'home' && (
            <HomeView projects={projects} onOpen={openProject} onChanged={refresh} />
          )}
          {route.view === 'builder' && current && (
            <BuilderView project={current} />
          )}
          {route.view === 'settings' && <SettingsView />}
        </div>
      </div>
      {isMock && <div className="mock-pill">MOCK BACKEND</div>}
    </ToastProvider>
  );
}
