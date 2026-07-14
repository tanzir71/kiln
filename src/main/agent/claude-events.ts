import type { AgentEvent } from '../../../ui/src/types';
import { event } from './types';

export interface ParsedClaudeEvent {
  sessionId?: string;
  event?: AgentEvent;
  finalText?: string;
}

function contentEvents(message: any): AgentEvent | undefined {
  const blocks = message?.message?.content ?? message?.content;
  if (!Array.isArray(blocks)) return undefined;
  const tool = blocks.find((block) => block?.type === 'tool_use');
  if (tool) {
    const name = String(tool.name ?? 'tool');
    const input = tool.input as Record<string, unknown> | undefined;
    if (/read|glob|grep/i.test(name)) return event('read', `${name}: ${String(input?.file_path ?? input?.pattern ?? '')}`.trim(), 'running', JSON.stringify(input, null, 2), String(tool.id ?? crypto.randomUUID()));
    if (/write|edit/i.test(name)) return event('edit', `${name}: ${String(input?.file_path ?? '')}`.trim(), 'running', JSON.stringify(input, null, 2), String(tool.id ?? crypto.randomUUID()));
    return event('command', name, 'running', JSON.stringify(input, null, 2), String(tool.id ?? crypto.randomUUID()));
  }
  const text = blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('\n');
  return text ? event('text', 'Claude response', 'ok', text, String(message?.uuid ?? crypto.randomUUID())) : undefined;
}

export function parseClaudeMessage(message: any): ParsedClaudeEvent {
  const sessionId = typeof message?.session_id === 'string' ? message.session_id : undefined;
  if (message?.type === 'result') {
    const finalText = message.subtype === 'success' ? String(message.result ?? '') : (message.errors ?? []).join('\n');
    return {
      sessionId,
      finalText,
      event: event(message.subtype === 'success' ? 'text' : 'error', message.subtype === 'success' ? 'Claude finished' : 'Claude failed', message.subtype === 'success' ? 'ok' : 'fail', finalText, String(message.uuid ?? crypto.randomUUID())),
    };
  }
  return { sessionId, event: contentEvents(message) };
}

export function parseClaudeJsonLine(line: string): ParsedClaudeEvent | undefined {
  if (!line.trim()) return undefined;
  try { return parseClaudeMessage(JSON.parse(line)); } catch { return undefined; }
}
