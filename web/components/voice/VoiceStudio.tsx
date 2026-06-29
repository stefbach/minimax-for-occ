"use client";

import { useEffect, useRef, useState } from "react";
import type { Voice } from "@/lib/types";

const LANGUAGES = ["multi", "fr", "en", "es", "de", "it", "zh", "ja"];

export function VoiceStudio({ initial }: { initial: Voice[] }) {
  const [voices, setVoices] = useState<Voice[]>(initial);
  // The cloned voice is always created against the HD model; the per-listening
  // model selector was removed from this page (no longer user-configurable here).
  const model = "speech-02-hd";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Clone form state
  const [file, setFile] = useState<File | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [name, setName] = useState("");
  const [lang, setLang] = useState("multi");
  const [desc, setDesc] = useState("");
  const [sampleText, setSampleText] = useState("Hello, I am your voice assistant.");

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function refresh() {
    const r = await fetch("/api/voices");
    if (r.ok) setVoices(await r.json());
  }

  async function onPlay(v: Voice) {
    setError(null);
    setBusy(true);
    setPlaying(v.voice_id);
    try {
      const r = await fetch("/api/voices/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          voice_id: v.voice_id,
          text: v.sample_text || "Hello, I am your voice assistant.",
          model,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `${r.status}`);
      }
      const blob = await r.blob();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = url;
      audioRef.current.onended = () => setPlaying(null);
      await audioRef.current.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPlaying(null);
    } finally {
      setBusy(false);
    }
  }

  async function onClone(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !voiceId || !name) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("voice_id", voiceId);
    fd.set("display_name", name);
    fd.set("language", lang);
    fd.set("description", desc);
    fd.set("sample_text", sampleText);
    const r = await fetch("/api/voices", { method: "POST", body: fd });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? `${r.status}`);
      return;
    }
    setFile(null);
    setVoiceId("");
    setName("");
    setDesc("");
    refresh();
  }

  async function onDelete(v: Voice) {
    if (v.source === "preset") return;
    if (!confirm(`Delete voice "${v.display_name}" from your catalogue?`)) return;
    setBusy(true);
    await fetch(`/api/voices?id=${v.id}`, { method: "DELETE" });
    setBusy(false);
    refresh();
  }

  const cloned = voices.filter((v) => v.source === "cloned");
  const presets = voices.filter((v) => v.source === "preset");

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Clone a new voice</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Expected sample: <strong>10 s to 5 min</strong>, mono, no music,
          format <strong>mp3 / wav / m4a only</strong> (.ogg / .flac not supported),
          ≤ 20 MB.
        </p>
        <form onSubmit={onClone} style={{ display: "grid", gap: 12 }}>
          <div className="form-row">
            <div>
              <label>Audio file</label>
              <input
                type="file"
                accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f) {
                    const ok = /\.(mp3|wav|m4a)$/i.test(f.name);
                    if (!ok) {
                      alert(
                        `Unsupported format: "${f.name}".\n\nMiniMax only accepts mp3, wav or m4a. Convert your file first (e.g. with ffmpeg: ffmpeg -i file.ogg file.mp3).`,
                      );
                      e.target.value = "";
                      setFile(null);
                      return;
                    }
                  }
                  setFile(f);
                }}
              />
              {file && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  File: <strong>{file.name}</strong> ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </div>
              )}
            </div>
            <div>
              <label>
                voice_id (technical) — <span style={{ color: "var(--muted)", fontWeight: "normal" }}>
                  8 to 64 characters, starts with a letter, A-Z / 0-9 / _ only
                </span>
              </label>
              <input
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder="tibok_pharma_dr_coste"
                pattern="[A-Za-z][A-Za-z0-9_]{7,63}"
                minLength={8}
                maxLength={64}
                required
                title="8 to 64 characters, starts with a letter, then letters / digits / underscores only"
              />
              <div style={{
                fontSize: 12,
                color: voiceId && (voiceId.length < 8 || voiceId.length > 64) ? "#ff8080" : "var(--muted)",
                marginTop: 4,
              }}>
                {voiceId.length === 0
                  ? "Internal identifier, not visible to end users"
                  : voiceId.length < 8
                    ? `${voiceId.length}/8 characters minimum — ${8 - voiceId.length} more to go`
                    : `${voiceId.length}/64 characters ✓`}
              </div>
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Display name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dr Coste — official voice"
                required
              />
            </div>
            <div>
              <label>Target language</label>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label>Description (optional)</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Calm voice, professional medical tone" />
          </div>
          <div>
            <label>Listening phrase (optional — used by the ▶ Test button)</label>
            <input
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              placeholder="Hello, I am your voice assistant."
            />
          </div>
          <div>
            <button type="submit" disabled={busy || !file || !voiceId || !name}>
              {busy ? "Cloning…" : "Clone this voice"}
            </button>
          </div>
        </form>
        {error && <div style={{ color: "var(--bad)", marginTop: 8 }}>{error}</div>}
      </div>

      <Section title="My cloned voices" voices={cloned} onPlay={onPlay} onDelete={onDelete} playing={playing} busy={busy} canDelete />
      <Section title="MiniMax preset voices" voices={presets} onPlay={onPlay} playing={playing} busy={busy} />
    </div>
  );
}

function Section({
  title,
  voices,
  onPlay,
  onDelete,
  playing,
  busy,
  canDelete,
}: {
  title: string;
  voices: Voice[];
  onPlay: (v: Voice) => void;
  onDelete?: (v: Voice) => void;
  playing: string | null;
  busy: boolean;
  canDelete?: boolean;
}) {
  if (voices.length === 0) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p className="muted">No voices.</p>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: 16 }}>
        <h3 style={{ margin: 0 }}>{title} · {voices.length}</h3>
      </div>
      <table className="list">
        <thead>
          <tr>
            <th>Name</th><th>voice_id</th><th>Language</th><th>Description</th><th></th>
          </tr>
        </thead>
        <tbody>
          {voices.map((v) => (
            <tr key={v.id}>
              <td style={{ fontWeight: 600 }}>{v.display_name}</td>
              <td><span className="kbd">{v.voice_id}</span></td>
              <td>{v.language}</td>
              <td className="muted" style={{ fontSize: 13, maxWidth: 320 }}>{v.description}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <button
                  onClick={() => onPlay(v)}
                  disabled={busy}
                  className="ghost"
                  style={{ padding: "5px 10px", marginRight: 6 }}
                >
                  {playing === v.voice_id ? "▶ …" : "▶ Test"}
                </button>
                {canDelete && onDelete && (
                  <button
                    onClick={() => onDelete(v)}
                    className="danger"
                    style={{ padding: "5px 9px" }}
                    disabled={busy}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
