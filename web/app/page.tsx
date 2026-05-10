import { VoicePanel } from "@/components/VoicePanel";
import { ChatPanel } from "@/components/ChatPanel";

export default function Home() {
  return (
    <main>
      <section className="panel">
        <header>
          <h1>Voix</h1>
          <h2>LiveKit + MiniMax TTS · Deepgram STT · MiniMax-M2</h2>
        </header>
        <VoicePanel />
      </section>
      <section className="panel">
        <header>
          <h1>Chat</h1>
          <h2>MiniMax-M2 via Vercel AI SDK</h2>
        </header>
        <ChatPanel />
      </section>
    </main>
  );
}
