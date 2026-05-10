"use client";

import { useEffect, useRef, useState } from "react";
import type { Voice } from "@/lib/types";

const TTS_MODELS = [
  { id: "speech-2.5-hd-preview", label: "speech-2.5-hd (preview, qualité maximale)" },
  { id: "speech-02-hd", label: "speech-02-hd (HD multilingue)" },
  { id: "speech-02-turbo", label: "speech-02-turbo (rapide, multilingue)" },
  { id: "speech-01-turbo", label: "speech-01-turbo (rapide, économique)" },
  { id: "speech-01", label: "speech-01 (legacy)" },
];

const LANGUAGES = ["multi", "fr", "en", "es", "de", "it", "zh", "ja"];

export function VoiceStudio({ initial }: { initial: Voice[] }) {
  const [voices, setVoices] = useState<Voice[]>(initial);
  const [model, setModel] = useState("speech-02-hd");
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
  const [sampleText, setSampleText] = useState("Bonjour, je suis votre assistant vocal.");

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
          text: v.sample_text || "Bonjour, je suis votre assistant vocal.",
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
    if (!confirm(`Supprimer la voix « ${v.display_name} » de votre catalogue ?`)) return;
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
        <h3 style={{ marginTop: 0 }}>Modèle TTS pour les écoutes</h3>
        <div className="form-row">
          <div>
            <label>Modèle MiniMax</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {TTS_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="muted" style={{ alignSelf: "end", fontSize: 12, paddingBottom: 6 }}>
            Choisissez la qualité audio. Le modèle sera aussi utilisable par agent (voir fiche agent).
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Cloner une nouvelle voix</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Échantillon attendu : <strong>10 s à 5 min</strong>, mono, sans musique, format mp3/wav/m4a, ≤ 20 Mo.
          Le voice_id est interne (8 à 64 caractères, commence par une lettre, A-Z, 0-9, _).
        </p>
        <form onSubmit={onClone} style={{ display: "grid", gap: 12 }}>
          <div className="form-row">
            <div>
              <label>Fichier audio</label>
              <input
                type="file"
                accept=".mp3,.wav,.m4a,audio/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div>
              <label>voice_id (technique)</label>
              <input
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder="tibok_pharma_dr_coste"
                pattern="[A-Za-z][A-Za-z0-9_]{7,63}"
                required
              />
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Nom affiché</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dr Coste — voix officielle"
                required
              />
            </div>
            <div>
              <label>Langue cible</label>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label>Description (optionnel)</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Voix posée, ton médical professionnel" />
          </div>
          <div>
            <label>Phrase d&apos;écoute (servira au bouton ▶ Tester)</label>
            <input value={sampleText} onChange={(e) => setSampleText(e.target.value)} />
          </div>
          <div>
            <button type="submit" disabled={busy || !file || !voiceId || !name}>
              {busy ? "Clonage en cours…" : "Cloner cette voix"}
            </button>
          </div>
        </form>
        {error && <div style={{ color: "var(--bad)", marginTop: 8 }}>{error}</div>}
      </div>

      <Section title="Mes voix clonées" voices={cloned} onPlay={onPlay} onDelete={onDelete} playing={playing} busy={busy} canDelete />
      <Section title="Voix presets MiniMax" voices={presets} onPlay={onPlay} playing={playing} busy={busy} />
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
        <p className="muted">Aucune voix.</p>
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
            <th>Nom</th><th>voice_id</th><th>Langue</th><th>Description</th><th></th>
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
                  {playing === v.voice_id ? "▶ …" : "▶ Tester"}
                </button>
                {canDelete && onDelete && (
                  <button
                    onClick={() => onDelete(v)}
                    className="danger"
                    style={{ padding: "5px 9px" }}
                    disabled={busy}
                  >
                    Supprimer
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
