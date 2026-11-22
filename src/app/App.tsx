import { StartupReport } from './StartupReport.tsx';

export function App() {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-3xl font-bold">Music to Sheets</h1>
        <p className="text-slate-400">Turn songs into Growtopia sheet music. Nothing to transcribe yet: this build only checks your browser.</p>
      </header>
      <main className="flex-1">
        <StartupReport />
      </main>
      <footer className="text-xs text-slate-500">
        Unofficial fan tool, not affiliated with or endorsed by Ubisoft. Growtopia is a trademark of its owner. Your audio
        stays on your device.
      </footer>
    </div>
  );
}
