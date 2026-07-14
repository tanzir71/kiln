export function Toast({ message }: { message: string }) { return <div role="status" className="fixed bottom-4 right-4 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white">{message}</div>; }
