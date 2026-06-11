"use client";

/**
 * ReportViewer — renders a ReportPayload as an A4-styled HTML document.
 *
 * Visual reference: the NHS S2 "Rapport de pilotage" PDF Wati uses. The
 * palette, typography (Spectral + Inter), funnel bar, KPI cards with
 * colored top borders, exec messages grid, priority tier banners, vigilance
 * flags and annex tables all mirror that doc so the printed PDF feels
 * like a polished board-ready report — not a generic dashboard dump.
 *
 * The "Télécharger PDF" button triggers window.print() with @page:A4 in
 * the embedded stylesheet — no Puppeteer service needed.
 */

import { useEffect, useMemo, useRef } from "react";
import type { ReportPayload } from "@/lib/reports/types";
import { REPORT_CSS } from "./report-css";

const TONE_COLOR_BIG: Record<string, string> = {
  good: "var(--rp-green)",
  warn: "var(--rp-amber)",
  info: "var(--rp-blue)",
  bad: "var(--rp-red)",
};

const FUNNEL_BG = ["var(--rp-ink)", "var(--rp-blue)", "#2E8B57", "var(--rp-green)"];

const PRIO_HEAD_BG: Record<number, string> = {
  1: "var(--rp-red)",
  2: "var(--rp-amber)",
  3: "var(--rp-blue)",
  4: "#5A6B82",
};

const URGENCY_TONE: Record<string, string> = {
  haute: "haute",
  moy: "moy",
  surv: "surv",
  green: "green",
};

const ANNEX_LETTER_BG: Record<string, string> = {
  good: "var(--rp-green)",
  info: "var(--rp-blue)",
  warn: "var(--rp-amber)",
  bad: "var(--rp-red)",
  neutral: "#5A6B82",
};

export function ReportViewer({ report }: { report: ReportPayload }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Inject the per-page CSS scoped to .rp-sheet so it doesn't bleed into
  // the rest of the Axon UI. We append it to <head> once and clean up on
  // unmount — repeated mounts share the same <style> via the data-key.
  useEffect(() => {
    const KEY = "axon-report-css";
    if (typeof document === "undefined") return;
    if (document.querySelector(`style[data-key="${KEY}"]`)) return;
    const tag = document.createElement("style");
    tag.dataset.key = KEY;
    tag.textContent = REPORT_CSS;
    document.head.appendChild(tag);
    return () => {
      // Keep the style — repeated viewer mounts re-use it. Only remove on
      // a hot-reload boundary where the document gets a fresh head.
    };
  }, []);

  const funnelFlex = useMemo(() => {
    // Each funnel stage's flex-grow is proportional to its count, so the
    // first stage (largest) gets the widest band, the last gets the thinnest.
    const total = report.funnel.reduce((s, f) => s + f.count, 0) || 1;
    return report.funnel.map((f) => Math.max(6, Math.round((100 * f.count) / total)));
  }, [report.funnel]);

  return (
    <div>
      <div className="rp-toolbar">
        <div>
          <div className="rp-toolbar-title">{report.title}</div>
          <div className="rp-toolbar-sub">{report.subtitle} · généré le {report.generatedAt}</div>
        </div>
        <button
          type="button"
          className="rp-toolbar-print"
          onClick={() => window.print()}
          aria-label="Télécharger le rapport en PDF"
        >
          ⤓ Télécharger PDF
        </button>
      </div>

      <div className="rp-sheet" ref={containerRef}>
        {/* MASTHEAD */}
        <div className="rp-masthead">
          <div className="rp-kicker">Obesity Care Clinic · Pilotage opérationnel</div>
          <h1>{report.title}</h1>
          <div className="rp-sub">{report.subtitle}</div>
          <div className="rp-meta-row">
            {report.meta.map((m, i) => (
              <div key={i}>
                <div className="rp-lab">{m.label}</div>
                <div className="rp-val">{m.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 01 SYNTHÈSE */}
        <section className="rp-pad">
          <div className="rp-eyebrow">
            <span className="rp-num">01</span>
            <h2>Synthèse exécutive</h2>
            <span className="rp-tag">Lecture en 30 secondes</span>
          </div>
          <p className="rp-lead">{report.synthese}</p>

          <div className="rp-msgs">
            {report.execMessages.map((m, i) => (
              <div key={i} className={`rp-msg rp-msg-${m.tone}`}>
                <span className="rp-msg-h">{m.heading}</span>
                <span className="rp-msg-big" style={{ color: TONE_COLOR_BIG[m.tone] }}>{m.big}</span>
                <span className="rp-msg-b">{m.body}</span>
              </div>
            ))}
          </div>

          {/* FUNNEL */}
          <div className="rp-funnel">
            <div className="rp-funnel-track">
              {report.funnel.map((f, i) => (
                <div
                  key={i}
                  className="rp-fstage"
                  style={{ background: FUNNEL_BG[i % FUNNEL_BG.length], flexGrow: funnelFlex[i] }}
                >
                  <span className="rp-fn">{f.count.toLocaleString("fr-FR")}</span>
                  <span className="rp-fl">{f.label}</span>
                  {f.pct && <span className="rp-fpct">{f.pct}</span>}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 02 KPIs */}
        <section className="rp-pad">
          <div className="rp-eyebrow">
            <span className="rp-num">02</span>
            <h2>Indicateurs de performance</h2>
            <span className="rp-tag">période en cours</span>
          </div>
          <div className="rp-kpis">
            {report.kpis.map((k, i) => (
              <div key={i} className={`rp-kpi rp-kpi-${k.tone ?? "neutral"}`}>
                <div className="rp-kpi-v">{k.value}</div>
                <div className="rp-kpi-k">{k.label}</div>
                {k.hint && <div className="rp-kpi-note">{k.hint}</div>}
              </div>
            ))}
          </div>
        </section>

        {/* 04 PLAN D'ACTION */}
        {report.actionTiers.length > 0 && (
          <section className="rp-pad rp-page-break">
            <div className="rp-eyebrow">
              <span className="rp-num">03</span>
              <h2>Plan d&apos;action — dossiers à traiter</h2>
              <span className="rp-tag">Le cœur du pilotage</span>
            </div>
            {report.actionTiers.map((tier, i) => (
              <div key={i} className="rp-prio">
                <div
                  className="rp-prio-head"
                  style={{ background: PRIO_HEAD_BG[tier.priority] ?? "#5A6B82" }}
                >
                  <span className="rp-pn">{tier.priority}</span>
                  <span className="rp-pt">{tier.title}</span>
                  <span className="rp-pc">{tier.rows.length} dossier{tier.rows.length > 1 ? "s" : ""}</span>
                </div>
                <div className="rp-prio-body">
                  <table>
                    <thead>
                      <tr>
                        <th>Patient</th>
                        <th>Téléphone</th>
                        <th>Motif</th>
                        <th>Quand</th>
                        <th>Urgence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tier.rows.map((r, j) => (
                        <tr key={j}>
                          <td className="rp-name">{r.name}</td>
                          <td className="rp-muted" style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>{r.phone ?? "—"}</td>
                          <td>{r.reason}</td>
                          <td className="rp-when">{r.when ?? "—"}</td>
                          <td>
                            {r.urgency && (
                              <span className={`rp-pill rp-pill-${URGENCY_TONE[r.urgency]}`}>
                                {r.urgency === "haute" ? "Haute" : r.urgency === "moy" ? "Moyenne" : r.urgency === "surv" ? "Surveillance" : "OK"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* 05 VIGILANCE */}
        {report.vigilance.length > 0 && (
          <section className="rp-pad rp-page-break">
            <div className="rp-eyebrow">
              <span className="rp-num">04</span>
              <h2>Points de vigilance</h2>
              <span className="rp-tag">Regard critique</span>
            </div>
            <div className="rp-flags">
              {report.vigilance.map((v, i) => (
                <div key={i} className={`rp-flag rp-flag-${v.tone}`}>
                  <h4>{v.heading}</h4>
                  <p>{v.body}</p>
                  {v.fix && (
                    <div className="rp-fix">
                      <b>Levier →</b> {v.fix}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 06 ANNEXES */}
        {report.annexes.length > 0 && (
          <section className="rp-pad rp-page-break">
            <div className="rp-eyebrow">
              <span className="rp-num">05</span>
              <h2>Annexes — détail complet</h2>
              <span className="rp-tag">Pièce justificative</span>
            </div>
            {report.annexes.map((annex, i) => (
              <div key={i} style={{ marginBottom: 24 }}>
                <div className="rp-annex-h">
                  <span
                    className="rp-annex-chip"
                    style={{ background: ANNEX_LETTER_BG[annex.tone] }}
                  >
                    {annex.letter}
                  </span>
                  {annex.heading}
                </div>
                {annex.subheading && <div className="rp-annex-sub">{annex.subheading}</div>}
                <table>
                  <thead>
                    <tr>
                      {annex.columns.map((c) => (
                        <th key={c.key}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {annex.rows.map((r, j) => (
                      <tr key={j}>
                        {annex.columns.map((c) => (
                          <td key={c.key}>{r[c.key] ?? "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        )}

        {/* FOOTER */}
        <div className="rp-foot">
          <b>Note méthodologique.</b> {report.methodNote} &nbsp;·&nbsp;
          Rapport généré automatiquement par Axon · Confidentiel — Obesity Care Clinic.
        </div>
      </div>
    </div>
  );
}
