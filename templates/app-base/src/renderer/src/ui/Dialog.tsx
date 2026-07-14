import type { PropsWithChildren } from 'react';
export function Dialog({ open, children }: PropsWithChildren<{ open: boolean }>) { return open ? <div role="dialog" aria-modal="true" className="fixed inset-0 grid place-items-center bg-black/30"><div className="rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">{children}</div></div> : null; }
