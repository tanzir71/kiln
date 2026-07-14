import { useEffect, useState } from 'react';
import { KeyRound, PlugZap, Trash2 } from 'lucide-react';
import { api } from '../api';
import type { EngineId, EngineStatus, Settings } from '../types';
import { ENGINE_LABELS } from '../types';
import { useToast } from '../toast';

export default function SettingsView() {
  const [engines, setEngines] = useState<EngineStatus[]>([]);
  const [settings, setSettings] = useState<Settings>();
  const refresh = () => void api.getEngines().then(setEngines);

  useEffect(() => {
    refresh();
    void api.getSettings().then(setSettings);
  }, []);

  const patch = async (p: Partial<Settings>) => setSettings(await api.updateSettings(p));

  return (
    <div className="settings">
      <h1>Settings</h1>

      <h2>Engines</h2>
      <div className="settings-grid">
        {engines.map((e) => <EngineCard key={e.id} engine={e} onChanged={refresh} />)}
      </div>

      {settings && (
        <>
          <h2>General</h2>
          <div className="form-row">
            <div>
              <div className="lbl">Default engine</div>
              <div className="desc">Used for new projects. Each project can override it.</div>
            </div>
            <select
              value={settings.defaultEngine}
              onChange={(e) => void patch({ defaultEngine: e.target.value as EngineId })}
            >
              {(Object.keys(ENGINE_LABELS) as EngineId[]).map((id) => (
                <option key={id} value={id}>{ENGINE_LABELS[id].name} — {ENGINE_LABELS[id].sub}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div>
              <div className="lbl">Projects folder</div>
              <div className="desc">Where generated project workspaces live.</div>
            </div>
            <input
              type="text"
              value={settings.projectsDir}
              onChange={(e) => setSettings({ ...settings, projectsDir: e.target.value })}
              onBlur={(e) => void patch({ projectsDir: e.target.value })}
            />
          </div>

          <h2>Distribution (Mac apps)</h2>
          <div className="form-row">
            <div>
              <div className="lbl">Developer ID signing identity</div>
              <div className="desc">
                Optional. Without it, apps are ad-hoc signed: they run fine on this Mac, but other Macs
                need right-click → Open on first launch. With a Developer ID certificate, exports are
                signed and notarized for frictionless sharing.
              </div>
            </div>
            <input
              type="text"
              placeholder="Developer ID Application: …"
              value={settings.signingIdentity ?? ''}
              onChange={(e) => setSettings({ ...settings, signingIdentity: e.target.value })}
              onBlur={(e) => void patch({ signingIdentity: e.target.value || undefined })}
            />
          </div>
          <div className="form-row">
            <div>
              <div className="lbl">Notarize exports</div>
              <div className="desc">Requires the signing identity above plus App Store Connect credentials.</div>
            </div>
            <input
              type="checkbox"
              checked={settings.notarize}
              disabled={!settings.signingIdentity}
              onChange={(e) => void patch({ notarize: e.target.checked })}
            />
          </div>
        </>
      )}
    </div>
  );
}

function EngineCard({ engine, onChanged }: { engine: EngineStatus; onChanged: () => void }) {
  const [key, setKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string }>();
  const toast = useToast();
  const isByok = engine.id.endsWith('byok');
  const ready = engine.installed && engine.authenticated;

  const saveKey = async () => {
    if (!key.trim()) return;
    await api.setApiKey(engine.id, key.trim());
    setKey('');
    toast('ok', `${ENGINE_LABELS[engine.id].name} key saved to Keychain`);
    onChanged();
  };

  const test = async () => {
    setTesting(true); setResult(undefined);
    setResult(await api.testEngine(engine.id));
    setTesting(false);
  };

  return (
    <div className="engine-card">
      <header>
        <span className={`dot ${ready ? 'ok' : engine.installed ? 'warn' : 'bad'}`} />
        <div className="names">
          <h3>{ENGINE_LABELS[engine.id].name}</h3>
          <div className="sub">{ENGINE_LABELS[engine.id].sub}</div>
        </div>
        {engine.version && <span className="badge">v{engine.version}</span>}
      </header>

      {!ready && <div className="hint">{engine.detail ?? (isByok ? 'Add an API key to enable.' : 'Sign in via the CLI to enable.')}</div>}

      {isByok && (
        ready ? (
          <div className="row">
            <span className="hint" style={{ flex: 1 }}><KeyRound size={12} style={{ verticalAlign: -2 }} /> Key stored in Keychain</span>
            <button className="btn danger" onClick={async () => { await api.clearApiKey(engine.id); onChanged(); }}>
              <Trash2 size={12} /> Remove
            </button>
          </div>
        ) : (
          <div className="row">
            <input
              type="password" placeholder="Paste API key" value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            />
            <button className="btn" disabled={!key.trim()} onClick={saveKey}>Save</button>
          </div>
        )
      )}

      {engine.models.length > 0 && (
        <div className="row">
          <span className="hint">Model</span>
          <select
            value={engine.selectedModel ?? engine.models[0]}
            onChange={async (e) => { await api.selectModel(engine.id, e.target.value); onChanged(); }}
            style={{ flex: 1 }}
          >
            {engine.models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}

      <div className="row">
        <button className="btn" disabled={testing} onClick={test}>
          {testing ? <span className="spinner" /> : <PlugZap size={13} />} Test engine
        </button>
        {result && <span className={`test-result ${result.ok ? 'ok' : 'bad'}`}>{result.message}</span>}
      </div>
    </div>
  );
}
