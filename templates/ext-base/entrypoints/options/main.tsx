import React from 'react';
import ReactDOM from 'react-dom/client';
import '../popup/style.css';

function Options() { return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-semibold">__APP_NAME__ Settings</h1><p className="mt-2 text-sm text-zinc-500">Extension preferences will appear here.</p></main>; }
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Options /></React.StrictMode>);
