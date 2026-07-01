"use client";

import { useEffect, useRef, useState } from "react";
import type { Voice } from "@/lib/types";
import { useT } from "@/lib/i18n";

const LANGUAGES = ["multi", "fr", "en", "es", "de", "it", "zh", "ja"];

export function VoiceStudio({ initial }: { initial: Voice[] }) {
  const t = useT();
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
    if (!confirm(t("Supprimer la voix") + ` "${v.display_name}" ` + t("de votre catalogue ?"))) return;
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
        <h3 style={{ marginTop: 0 }}>{t("Cloner une nouvelle voix")}</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("Échantillon attendu :")} <strong>10 s {t("à")} 5 min</strong>, mono, {t("sans musique,")}{" "}
          {t("format")} <strong>mp3 / wav / m4a {t("uniquement")}</strong> (.ogg / .flac {t("non supportés")}),
          ≤ 20 MB.
        </p>
        <form onSubmit={onClone} style={{ display: "grid", gap: 12 }}>
          <div className="form-row">
            <div>
              <label>{t("Fichier audio")}</label>
              <input
                type="file"
                accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f) {
                    const ok = /\.(mp3|wav|m4a)$/i.test(f.name);
                    if (!ok) {
                      alert(
                        t("Format non supporté") + ` : "${f.name}".\n\nMiniMax ` + t("accepte uniquement mp3, wav ou m4a. Convertissez votre fichier (ex. avec ffmpeg : ffmpeg -i file.ogg file.mp3)."),
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
                  {t("Fichier")} : <strong>{file.name}</strong> ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </div>
              )}
            </div>
            <div>
              <label>
                voice_id ({t("technique")}) — <span style={{ color: "var(--muted)", fontWeight: "normal" }}>
                  {t("8 à 64 caractères, commence par une lettre, A-Z / 0-9 / _ uniquement")}
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
                title={t("8 à 64 caractères, commence par une lettre, puis lettres / chiffres / underscores uniquement")}
              />
              <div style={{
                fontSize: 12,
                color: voiceId && (voiceId.length < 8 || voiceId.length > 64) ? "#ff8080" : "var(--muted)",
                marginTop: 4,
              }}>
                {voiceId.length === 0
                  ? t("Identifiant interne, non visible par les utilisateurs finaux")
                  : voiceId.length < 8
                    ? `${voiceId.length}/8 ` + t("caractères minimum") + ` — ${8 - voiceId.length} ` + t("restants")
                    : `${voiceId.length}/64 ` + t("caractères") + " ✓"}
              </div>
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>{t("Nom d'affichage")}</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dr Coste — voix officielle"
                required
              />
            </div>
            <div>
              <label>{t("Langue cible")}</label>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label>{t("Description (optionnel)")}</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("Voix calme, ton médical professionnel")} />
          </div>
          <div>
            <label>{t("Phrase d'écoute (optionnel — utilisée par le bouton ▶ Tester)")}</label>
            <input
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              placeholder="Hello, I am your voice assistant."
            />
          </div>
          <div>
            <button type="submit" disabled={busy || !file || !voiceId || !name}>
              {busy ? t("Clonage…") : t("Cloner cette voix")}
            </button>
          </div>
        </form>
        {error && <div style={{ color: "var(--bad)", marginTop: 8 }}>{error}</div>}
      </div>

      <Section title={t("Mes voix clonées")} voices={cloned} onPlay={onPlay} onDelete={onDelete} playing={playing} busy={busy} canDelete />
      <Section title={t("Voix preset MiniMax")} voices={presets} onPlay={onPlay} playing={playing} busy={busy} />
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
  const t = useT();
  if (voices.length === 0) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p className="muted">{t("Aucune voix.")}</p>
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
            <th>{t("Nom")}</th><th>voice_id</th><th>{t("Langue")}</th><th>{t("Description")}</th><th></th>
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
                  {playing === v.voice_id ? "▶ …" : "▶ " + t("Tester")}
                </button>
                {canDelete && onDelete && (
                  <button
                    onClick={() => onDelete(v)}
                    className="danger"
                    style={{ padding: "5px 9px" }}
                    disabled={busy}
                  >
                    {t("Supprimer")}
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
