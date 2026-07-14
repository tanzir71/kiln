export interface KilnMessage<T = unknown> { type: string; payload?: T }
export async function sendMessage<TResponse = unknown, TPayload = unknown>(message: KilnMessage<TPayload>): Promise<TResponse> {
  return await browser.runtime.sendMessage(message) as TResponse;
}
