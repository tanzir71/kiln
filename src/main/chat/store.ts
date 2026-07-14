import { join } from 'node:path';
import type { ChatMessage } from '../../../ui/src/types';
import { readJson, writeJson } from '../util/files';

export class ChatStore {
  async get(projectPath: string): Promise<ChatMessage[]> {
    return await readJson<ChatMessage[]>(join(projectPath, '.kiln/chat.json'), []);
  }

  async save(projectPath: string, messages: ChatMessage[]): Promise<void> {
    await writeJson(join(projectPath, '.kiln/chat.json'), messages);
  }
}
