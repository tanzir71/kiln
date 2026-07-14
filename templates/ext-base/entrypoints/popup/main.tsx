import React from 'react';
import ReactDOM from 'react-dom/client';
import { Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import './style.css';

function Popup() {
  return <main className="w-80 bg-white p-5 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"><Sparkles className="mb-4 text-violet-500"/><h1 className="text-xl font-semibold">__APP_NAME__</h1><p className="mt-2 text-sm text-zinc-500">Your extension is ready for its first Kiln prompt.</p><Button className="mt-5" onClick={() => window.close()}>Done</Button></main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Popup /></React.StrictMode>);
