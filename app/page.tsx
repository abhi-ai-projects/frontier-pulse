export default function Home() {
  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-2xl">
        <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">
          Frontier Pulse
        </h1>
        <p className="text-lg text-gray-400 mb-8">
          Compare responses from Claude, GPT-4o, and Gemini — side by side, in real time.
        </p>
        <div className="inline-block bg-white/10 border border-white/20 rounded-full px-5 py-2 text-sm text-gray-300">
          🚧 Coming soon
        </div>
      </div>
    </main>
  );
}