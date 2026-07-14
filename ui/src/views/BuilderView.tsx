import { useEffect, useState } from 'react';
import {
  AppWindow, ChevronDown, ChevronRight, Download, ExternalLink, FileText,
  Folder, History, Play, Puzzle, RotateCcw, Square,
} from 'lucide-react';
import { api } from '../api';
import type { FileNode, Project, Version } from '../types';
import { useToast } from '../toast';
import ChatPane from './ChatPane';

type Tab = 'preview' | 'versions' | 'files';

export default function BuilderView({ project }: { project: Project }) {
  const [tab, setTab] = useState<Tab>('preview');
  const toast = useToast();
  const exporting = project.status === 'exporting';
  const appRunning = project.status === 'app-running';

  const doExport = async () => {
    toast('info', project.type === 'mac-app' ? 'Building DMG…' : 'Building ZIPs…');
    const res = await api.exportProject(project.id);
    if (res.ok) {
      toast('ok', `Exported ${res.artifacts.map((a) => a.split('/').pop()).join(', ')}`);
      if (res.artifacts[0]) void api.revealPath(res.artifacts[0]);
    } else {
      toast('err', res.error ?? 'Export failed');
    }
  };

  const testExtensionExport = async () => {
    toast('info', 'Building and opening the exact Chrome export…');
    try {
      await api.testExtensionExport(project.id);
      toast('ok', 'Chrome export loaded in the test browser');
    } catch (error) {
      toast('err', `Could not launch Chrome export: ${String(error)}`);
    }
  };

  return (
    <div className="builder">
      <ChatPane project={project} />

      <div className="preview-pane">
        <div className="preview-toolbar">
          <div className="seg">
            <button className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>Preview</button>
            <button className={tab === 'versions' ? 'on' : ''} onClick={() => setTab('versions')}>
              <History size={11} style={{ marginRight: 4, verticalAlign: -1 }} />Versions
            </button>
            <button className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>Files</button>
          </div>
          <div className="titlebar-spacer" />
          {appRunning ? (
            <button className="btn" onClick={() => void api.stopApp(project.id)}>
              <Square size={12} /> Stop
            </button>
          ) : (
            <button className="btn" onClick={() => void api.runApp(project.id)} disabled={project.latestVersion === 0}>
              <Play size={12} /> Run
            </button>
          )}
          <button className="btn primary" onClick={doExport} disabled={exporting || project.latestVersion === 0}>
            {exporting ? <span className="spinner" /> : <Download size={13} />}
            {project.type === 'mac-app' ? 'Export DMG' : 'Export ZIPs'}
          </button>
          {project.type === 'extension' && (
            <button className="btn" onClick={testExtensionExport} disabled={exporting || project.latestVersion === 0}>
              <Play size={12} /> Test in Chrome
            </button>
          )}
        </div>

        <div className="preview-body">
          {tab === 'preview' && <PreviewStage project={project} />}
          {tab === 'versions' && <VersionsTab project={project} />}
          {tab === 'files' && <FilesTab project={project} />}
        </div>
      </div>
    </div>
  );
}

function PreviewStage({ project }: { project: Project }) {
  const Icon = project.type === 'mac-app' ? AppWindow : Puzzle;
  if (project.latestVersion === 0) {
    return (
      <div className="preview-stage">
        <Icon size={30} color="var(--text-3)" />
        <div>
          <strong>No build yet.</strong>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Send your first prompt and the {project.type === 'mac-app' ? 'app' : 'extension'} will appear here.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="preview-stage">
      <div className="preview-frame">
        {project.status === 'app-running' ? (
          <>
            <Icon size={26} color="var(--accent)" />
            <strong>
              {project.type === 'mac-app'
                ? `${project.name} is running in its own window`
                : `${project.name} is loaded in the dev browser`}
            </strong>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Changes hot-reload as the agent works.
            </span>
          </>
        ) : (
          <>
            {project.icon && <img src={project.icon} width={44} height={44} style={{ borderRadius: 10 }} alt="" />}
            <strong>{project.name} · v{project.latestVersion}</strong>
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Press Run to {project.type === 'mac-app' ? 'launch the app' : 'open it in a browser'}.
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function VersionsTab({ project }: { project: Project }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const toast = useToast();
  useEffect(() => { void api.listVersions(project.id).then(setVersions); }, [project.id, project.latestVersion]);

  const revert = async (tag: string) => {
    if (!window.confirm(`Revert to ${tag}? Later versions stay in history.`)) return;
    await api.revertTo(project.id, tag);
    toast('ok', `Reverted to ${tag}`);
    void api.listVersions(project.id).then(setVersions);
  };

  if (versions.length === 0) {
    return <div className="empty"><History size={26} color="var(--text-3)" /><h2>No versions yet</h2></div>;
  }
  return (
    <div className="versions">
      {versions.map((v) => (
        <div key={v.tag} className="version-row">
          {v.screenshot
            ? <img src={v.screenshot} width={52} height={34} style={{ borderRadius: 5, objectFit: 'cover' }} alt="" />
            : <FileText size={16} color="var(--text-3)" />}
          <span className="tag">{v.tag}</span>
          <span className="msg">{v.message}</span>
          {v.current && <span className="badge accent">current</span>}
          <span className="when">{new Date(v.ts).toLocaleString()}</span>
          {!v.current && (
            <button className="btn" onClick={() => revert(v.tag)}>
              <RotateCcw size={12} /> Revert
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function FilesTab({ project }: { project: Project }) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selected, setSelected] = useState<string>();
  const [content, setContent] = useState('');
  useEffect(() => { void api.listFiles(project.id).then(setTree); }, [project.id, project.latestVersion]);
  useEffect(() => {
    if (selected) void api.readFile(project.id, selected).then(setContent);
  }, [project.id, selected]);

  return (
    <div className="files">
      <div className="file-tree">
        <TreeLevel nodes={tree} depth={0} selected={selected} onSelect={setSelected} />
        <button className="btn ghost" style={{ marginTop: 10, width: '100%' }} onClick={() => void api.openInEditor(project.id, selected)}>
          <ExternalLink size={12} /> Open in editor
        </button>
      </div>
      <div className="file-view">
        {selected
          ? <pre>{content}</pre>
          : <div className="empty"><Folder size={24} color="var(--text-3)" /><h2 style={{ fontSize: 14 }}>Select a file</h2></div>}
      </div>
    </div>
  );
}

function TreeLevel(props: {
  nodes: FileNode[]; depth: number; selected?: string; onSelect: (p: string) => void;
}) {
  return (
    <>
      {props.nodes.map((n) => (
        <TreeNode key={n.path} node={n} depth={props.depth} selected={props.selected} onSelect={props.onSelect} />
      ))}
    </>
  );
}

function TreeNode(props: {
  node: FileNode; depth: number; selected?: string; onSelect: (p: string) => void;
}) {
  const { node, depth } = props;
  const [open, setOpen] = useState(depth < 2);
  const pad = { paddingLeft: 8 + depth * 14 };

  if (node.kind === 'dir') {
    return (
      <>
        <button className="tree-row" style={pad} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Folder size={13} color="var(--text-2)" />
          {node.name}
        </button>
        {open && node.children && (
          <TreeLevel nodes={node.children} depth={depth + 1} selected={props.selected} onSelect={props.onSelect} />
        )}
      </>
    );
  }
  return (
    <button
      className={`tree-row ${props.selected === node.path ? 'on' : ''}`}
      style={pad}
      onClick={() => props.onSelect(node.path)}
    >
      <span style={{ width: 12 }} />
      <FileText size={13} color="var(--text-2)" />
      {node.name}
    </button>
  );
}
