/**
 * CSS for the ReportViewer. All selectors are scoped under .rp-sheet /
 * .rp-toolbar so the report's heavy styling (Spectral display font, dark
 * masthead, colored funnel bars) doesn't bleed into the surrounding Axon
 * dashboard chrome. Print styles emit a clean A4 with @page rules so the
 * "Télécharger PDF" button works via window.print() — no Puppeteer infra.
 *
 * Visual reference: the NHS S2 pilotage report HTML Wati uses as model.
 */

export const REPORT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Spectral:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');

.rp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--surface-2, rgba(255,255,255,0.04));
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 8px;
  margin-bottom: 16px;
}
.rp-toolbar-title { font-weight: 600; font-size: 14px; }
.rp-toolbar-sub { font-size: 12px; color: var(--muted-2); margin-top: 2px; }
.rp-toolbar-print {
  background: var(--accent, #a855f7);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.rp-toolbar-print:hover { opacity: 0.9; }

.rp-sheet {
  --rp-ink: #14233A;
  --rp-blue: #0B5FA5;
  --rp-blue-bg: #E6F0F8;
  --rp-slate: #5A6B82;
  --rp-green: #1E7A4D;
  --rp-green-bg: #E7F4EC;
  --rp-amber: #B26A00;
  --rp-amber-bg: #FCF1DE;
  --rp-red: #A4243B;
  --rp-red-bg: #F8E7EA;
  --rp-hair: #E2E8F0;
  --rp-alt: #F5F7FA;
  --rp-surface: #FFFFFF;
  --rp-display: 'Spectral', Georgia, serif;
  --rp-body: 'Inter', system-ui, -apple-system, sans-serif;

  font-family: var(--rp-body);
  color: var(--rp-ink);
  background: var(--rp-surface);
  font-size: 13.5px;
  line-height: 1.55;
  max-width: 920px;
  margin: 0 auto;
  box-shadow: 0 1px 3px rgba(20,35,58,.12), 0 8px 30px rgba(20,35,58,.08);
}
.rp-sheet * { box-sizing: border-box; }

.rp-masthead {
  background: var(--rp-ink);
  color: white;
  padding: 36px 50px 30px;
}
.rp-kicker {
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #9FB2CC;
  font-weight: 600;
}
.rp-masthead h1 {
  font-family: var(--rp-display);
  font-weight: 600;
  font-size: 30px;
  line-height: 1.12;
  margin: 12px 0 6px;
  letter-spacing: -0.01em;
}
.rp-sub { color: #C4D2E4; font-size: 14px; }
.rp-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 26px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid rgba(255,255,255,0.14);
}
.rp-meta-row div { font-size: 12px; }
.rp-lab {
  color: #8FA3BF;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 600;
  margin-bottom: 3px;
}
.rp-val { color: #EAF0F8; font-weight: 500; }

.rp-sheet section { border-top: 1px solid var(--rp-hair); }
.rp-pad { padding: 36px 50px; }

.rp-eyebrow {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 18px;
}
.rp-num {
  font-family: var(--rp-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--rp-blue);
}
.rp-eyebrow h2 {
  font-family: var(--rp-display);
  font-weight: 600;
  font-size: 21px;
  letter-spacing: -0.01em;
  margin: 0;
}
.rp-tag {
  margin-left: auto;
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--rp-slate);
  font-weight: 600;
  border: 1px solid var(--rp-hair);
  padding: 3px 9px;
  border-radius: 3px;
}
.rp-lead { font-size: 15px; line-height: 1.62; }
.rp-muted { color: var(--rp-slate); }

.rp-msgs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  margin: 26px 0 6px;
  border: 1px solid var(--rp-hair);
  border-radius: 6px;
  overflow: hidden;
}
.rp-msg { padding: 18px 20px; border-right: 1px solid var(--rp-hair); }
.rp-msg:last-child { border-right: 0; }
.rp-msg-h {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
  margin-bottom: 8px;
  display: block;
}
.rp-msg-good .rp-msg-h { color: var(--rp-green); }
.rp-msg-warn .rp-msg-h { color: var(--rp-amber); }
.rp-msg-info .rp-msg-h { color: var(--rp-blue); }
.rp-msg-bad .rp-msg-h { color: var(--rp-red); }
.rp-msg-big {
  font-family: var(--rp-display);
  font-size: 26px;
  font-weight: 600;
  line-height: 1;
  display: block;
  margin-bottom: 6px;
}
.rp-msg-b { font-size: 13px; line-height: 1.5; display: block; }

.rp-funnel { margin-top: 26px; }
.rp-funnel-track {
  display: flex;
  align-items: stretch;
  gap: 6px;
}
.rp-fstage {
  flex: 1 1 auto;
  color: white;
  border-radius: 5px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 100px;
}
.rp-fn {
  font-family: var(--rp-display);
  font-size: 26px;
  font-weight: 700;
  line-height: 1;
}
.rp-fl {
  font-size: 10.5px;
  letter-spacing: 0.04em;
  margin-top: 5px;
  opacity: 0.92;
  font-weight: 500;
}
.rp-fpct { font-size: 10px; opacity: 0.8; margin-top: 2px; }

.rp-kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-top: 8px;
}
.rp-kpi {
  border: 1px solid var(--rp-hair);
  border-top: 3px solid var(--rp-blue);
  border-radius: 6px;
  padding: 16px;
}
.rp-kpi-v {
  font-family: var(--rp-display);
  font-size: 28px;
  font-weight: 600;
  line-height: 1;
}
.rp-kpi-k {
  font-size: 10.5px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--rp-slate);
  font-weight: 600;
  margin-top: 9px;
}
.rp-kpi-note { font-size: 11px; color: var(--rp-slate); margin-top: 7px; line-height: 1.4; }
.rp-kpi-good { border-top-color: var(--rp-green); }
.rp-kpi-good .rp-kpi-v { color: var(--rp-green); }
.rp-kpi-warn { border-top-color: var(--rp-amber); }
.rp-kpi-warn .rp-kpi-v { color: var(--rp-amber); }
.rp-kpi-bad { border-top-color: var(--rp-red); }
.rp-kpi-bad .rp-kpi-v { color: var(--rp-red); }

.rp-prio {
  margin-top: 22px;
  border: 1px solid var(--rp-hair);
  border-radius: 7px;
  overflow: hidden;
}
.rp-prio + .rp-prio { margin-top: 16px; }
.rp-prio-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 18px;
  color: white;
}
.rp-pn {
  font-family: var(--rp-display);
  font-weight: 700;
  font-size: 15px;
  background: rgba(255,255,255,0.16);
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.rp-pt { font-weight: 600; font-size: 14.5px; }
.rp-pc {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  background: rgba(255,255,255,0.18);
  padding: 4px 11px;
  border-radius: 20px;
}
.rp-prio-body { padding: 6px 18px 14px; }

.rp-sheet table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.rp-sheet thead th {
  text-align: left;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--rp-slate);
  font-weight: 700;
  padding: 10px;
  border-bottom: 1.5px solid var(--rp-hair);
}
.rp-sheet tbody td {
  padding: 10px;
  border-bottom: 1px solid var(--rp-hair);
  vertical-align: top;
  line-height: 1.42;
}
.rp-sheet tbody tr:last-child td { border-bottom: 0; }
.rp-name { font-weight: 600; white-space: nowrap; }
.rp-when { white-space: nowrap; font-weight: 500; }

.rp-pill {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  padding: 2px 8px;
  border-radius: 20px;
  white-space: nowrap;
}
.rp-pill-haute { background: var(--rp-red-bg); color: var(--rp-red); }
.rp-pill-moy { background: var(--rp-amber-bg); color: var(--rp-amber); }
.rp-pill-surv { background: var(--rp-blue-bg); color: var(--rp-blue); }
.rp-pill-green { background: var(--rp-green-bg); color: var(--rp-green); }

.rp-flags {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 6px;
}
.rp-flag {
  border: 1px solid var(--rp-hair);
  border-left: 3px solid var(--rp-amber);
  border-radius: 5px;
  padding: 14px 16px;
}
.rp-flag-bad { border-left-color: var(--rp-red); }
.rp-flag-warn { border-left-color: var(--rp-amber); }
.rp-flag-info { border-left-color: var(--rp-blue); }
.rp-flag h4 { font-size: 13px; font-weight: 700; margin-bottom: 6px; margin-top: 0; }
.rp-flag p { font-size: 12px; color: var(--rp-slate); line-height: 1.5; }
.rp-fix { font-size: 11.5px; margin-top: 8px; color: var(--rp-ink); }
.rp-fix b { color: var(--rp-green); }

.rp-annex-h {
  font-family: var(--rp-display);
  font-weight: 600;
  font-size: 15px;
  margin: 22px 0 6px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.rp-annex-chip {
  font-size: 11px;
  font-weight: 600;
  color: white;
  padding: 2px 9px;
  border-radius: 20px;
}
.rp-annex-sub { font-size: 12px; color: var(--rp-slate); margin-bottom: 4px; }

.rp-foot {
  padding: 20px 50px;
  background: var(--rp-alt);
  border-top: 1px solid var(--rp-hair);
  font-size: 11px;
  color: var(--rp-slate);
  line-height: 1.6;
}
.rp-foot b { color: var(--rp-ink); }

/* PRINT — clean A4 with no toolbar / sidebar / chrome */
@media print {
  body { background: white; font-size: 11.5px; }
  .rp-toolbar, .sidebar, nav, header, footer { display: none !important; }
  .rp-sheet {
    box-shadow: none;
    margin: 0;
    max-width: 100%;
  }
  .rp-pad { padding: 22px 28px; }
  .rp-masthead { padding: 24px 28px 20px; }
  .rp-foot { padding: 12px 28px; }
  .rp-sheet section { break-inside: avoid; }
  .rp-prio, .rp-kpi, .rp-msg, .rp-flag, .rp-fstage, tr { break-inside: avoid; }
  .rp-page-break { break-before: page; }
  @page { size: A4; margin: 12mm; }
}

@media (max-width: 680px) {
  .rp-pad, .rp-masthead { padding: 24px 20px; }
  .rp-msgs, .rp-kpis, .rp-flags { grid-template-columns: 1fr; }
  .rp-funnel-track { flex-wrap: wrap; }
}
`;
