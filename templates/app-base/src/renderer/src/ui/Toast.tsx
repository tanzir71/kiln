export function Toast({ message }: { message: string }) { return <div role="status" className="fixed bottom-5 right-5 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white shadow-lg">{message}</div>; }
