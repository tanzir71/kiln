import type { PropsWithChildren } from 'react';
export function List({ children }: PropsWithChildren) { return <div className="divide-y divide-black/10 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">{children}</div>; }
