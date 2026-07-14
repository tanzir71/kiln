import type { AgentEvent } from '../../../ui/src/types';
import { event } from './types';

interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  changes?: Array<{ path?: string; kind?: string }>;
  query?: string;
  [key: string]: unknown;
}

interface CodexWireEvent {
  type?: string;
  thread_id?: string;
  message?: string;
  item?: CodexItem;
  error?: { message?: string };
}

export interface ParsedCodexEvent {
  sessionId?: string;
  event?: AgentEvent;
  finalText?: string;
}

function itemLabel(item: CodexItem): { kind: AgentEvent['kind']; label: string; detail?: string } {
  switch (item.type) {
    case 'agent_message':
      return { kind: 'text', label: 'Agent response', detail: item.text };
    case 'reasoning':
      return { kind: 'thinking', label: 'Reasoning', detail: item.text };
    case 'command_execution':
      return { kind: 'command', label: item.command || 'Running command', detail: item.aggregated_output };
    case 'file_change': {
      const paths = item.changes?.map((change) => change.path).filter(Boolean).join(', ');
      return { kind: 'edit', label: paths ? `Editing ${paths}` : 'Editing project files', detail: JSON.stringify(item.changes ?? [], null, 2) };
    }
    case 'mcp_tool_call':
      return { kind: 'command', label: 'Using tool', detail: JSON.stringify(item, null, 2) };
    case 'web_search':
      return { kind: 'read', label: item.query ? `Searching for ${item.query}` : 'Searching', detail: item.text };
    case 'plan':
    case 'todo_list':
      return { kind: 'text', label: 'Updating plan', detail: item.text ?? JSON.stringify(item, null, 2) };
    default:
      return { kind: 'thinking', label: item.type ? `Working: ${item.type}` : 'Working', detail: JSON.stringify(item, null, 2) };
  }
}

export function parseCodexEvent(line: string): ParsedCodexEvent | undefined {
  if (!line.trim()) return undefined;
  let wire: CodexWireEvent;
  try { wire = JSON.parse(line) as CodexWireEvent; } catch { return undefined; }
  if (wire.type === 'thread.started') return { sessionId: wire.thread_id };
  if (wire.type === 'error' || wire.type === 'turn.failed') {
    const message = wire.error?.message ?? wire.message ?? 'Codex run failed';
    return { event: event('error', message, 'fail', JSON.stringify(wire, null, 2)) };
  }
  if ((wire.type === 'item.started' || wire.type === 'item.updated' || wire.type === 'item.completed') && wire.item) {
    const meta = itemLabel(wire.item);
    const status = wire.type === 'item.completed' ? 'ok' : 'running';
    const mapped = event(meta.kind, meta.label, status, meta.detail, wire.item.id ?? crypto.randomUUID());
    return {
      event: mapped,
      finalText: wire.type === 'item.completed' && wire.item.type === 'agent_message' ? wire.item.text : undefined,
    };
  }
  return undefined;
}
