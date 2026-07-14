import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
export function Button({ className = '', children, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) { return <button className={`rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 ${className}`} {...props}>{children}</button>; }
