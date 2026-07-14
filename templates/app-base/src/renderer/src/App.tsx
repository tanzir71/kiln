import { Sparkles } from 'lucide-react';
import { Button } from './ui/Button';

export default function App() {
  return (
    <main className="min-h-screen bg-zinc-100 p-12 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <section className="mx-auto max-w-xl rounded-3xl border border-black/10 bg-white/80 p-8 shadow-xl backdrop-blur dark:border-white/10 dark:bg-zinc-900/80">
        <Sparkles className="mb-5 text-violet-500" />
        <h1 className="text-3xl font-semibold tracking-tight">__APP_NAME__</h1>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Your app is ready. Describe what it should become in Kiln.</p>
        <Button className="mt-7" onClick={() => void window.kiln.notify.show({ title: '__APP_NAME__', body: 'The native bridge is working.' })}>Test notification</Button>
      </section>
    </main>
  );
}
