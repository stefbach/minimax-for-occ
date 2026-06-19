/**
 * Patient-facing email/WhatsApp content for Agent 4 (Communicate), ported from
 * the n8n "Prepare Comms" node. Pure string builders — the step decides which
 * to send based on the dossier status.
 */

export interface CommsInput {
  nom: string;
  status: string;
  pct: number;
  region: string;
  docs: Record<string, string>;
  medical_report_url?: string;
  undue_delay_url?: string;
}

const DOC_LABELS: Array<[string, string]> = [
  ["doc_nhs_s2_form", "NHS S2 Form"],
  ["doc_clinical_justification_gp", "Clinical Justification / Medical History"],
  ["doc_patient_authorisation", "Patient Authorisation Letter"],
  ["doc_identity_document", "Identity Document"],
  ["doc_proof_of_residence", "Proof of Residence (UK)"],
  ["doc_bank_statements", "Bank Statements"],
];

const SIG =
  "<p style='font-size:15px;color:#555;margin-top:30px;'>Warm regards,<br><strong style='color:#1a5276;'>The OCC Patient Services Team</strong></p>";
const FOOT =
  "<tr><td style='background:#f0f3f4;padding:20px;text-align:center;border-top:1px solid #ddd;'><p style='margin:0;font-size:13px;color:#888;'>Obesity Care Clinic &nbsp;|&nbsp; Supporting your journey to better health</p></td></tr>";

function wrap(title: string, body: string): string {
  return (
    "<html><body style='margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4;'>" +
    "<table width='100%' cellpadding='0' cellspacing='0'><tr><td>" +
    "<table width='600' align='center' cellpadding='0' cellspacing='0' style='background:#ffffff;margin:20px auto;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);'>" +
    `<tr><td style='background:#1a5276;padding:30px 40px;text-align:center;'><h1 style='color:#ffffff;margin:0;font-size:22px;font-weight:bold;'>${title}</h1></td></tr>` +
    `<tr><td style='padding:35px 40px;'>${body}${SIG}</td></tr>${FOOT}</table></td></tr></table></body></html>`
  );
}

export interface CommsOutput {
  missing_text: string;
  need_to_sign: boolean;
  html_no_docs: string;
  html_missing: string;
  html_complete: string;
  html_coordinator: string;
  wa_no_docs: string;
  wa_missing: string;
  wa_complete: string;
  emailFor(status: string): { subject: string; html: string };
  waFor(status: string): string;
}

export function buildComms(input: CommsInput): CommsOutput {
  const { nom, status, pct, region, docs } = input;
  let docList = "";
  const missingNames: string[] = [];
  for (const [f, label] of DOC_LABELS) {
    if (docs[f] === "received") docList += `<li>✅ <strong>${label}</strong></li>`;
    else {
      docList += `<li>❌ <strong>${label}</strong> — still required</li>`;
      missingNames.push(label);
    }
  }
  const missing_text = missingNames.join(", ") || "none";
  const need_to_sign =
    status !== "COMPLETE" &&
    (docs.doc_nhs_s2_form !== "received" ||
      docs.doc_patient_authorisation !== "received" ||
      docs.doc_s2_provider_declaration !== "received");

  const html_no_docs = wrap(
    "NHS S2 Document Submission Required",
    `<p style='font-size:16px;color:#333;'>Dear ${nom},</p><p style='font-size:15px;color:#555;line-height:1.7;'>We are writing regarding your NHS S2 application for bariatric surgery with <strong>Obesity Care Clinic</strong>. We have not yet received your required documents. You will receive the forms to sign in a separate email — please complete and return them, and send any supporting documents to <a href='mailto:customer.service@obesity-care-clinic.com'>customer.service@obesity-care-clinic.com</a>.</p>`,
  );
  const html_missing = wrap(
    "NHS S2 Application — Documents Still Required",
    `<p style='font-size:16px;color:#333;'>Dear ${nom},</p><p style='font-size:15px;color:#555;line-height:1.7;'>Thank you for the documents already submitted. Some documents are still missing to complete your NHS S2 application:</p><table width='100%'><tr><td style='background:#eaf2f8;border-left:4px solid #1a5276;border-radius:4px;padding:25px 30px;'><ul style='margin:0;padding-left:0;list-style:none;color:#444;font-size:14px;line-height:2.2;'>${docList}</ul></td></tr></table>`,
  );
  const html_complete = wrap(
    "Your NHS S2 Dossier is Complete",
    `<p style='font-size:16px;color:#333;'>Dear ${nom},</p><p style='font-size:15px;color:#555;line-height:1.7;'>We are pleased to confirm we have received all required documents for your NHS S2 bariatric surgery application. Your dossier is complete and is being prepared for submission to the NHS. We will be in touch with the next steps shortly.</p>`,
  );
  const html_coordinator =
    `<html><body style='font-family:Arial,sans-serif;color:#333;'><h2 style='color:#1a5276;'>NHS S2 Dossier Ready</h2><p>The following NHS S2 dossier is ready for internal review and submission.</p><ul>` +
    `<li><strong>Patient:</strong> ${nom}</li><li><strong>Status:</strong> ${status}</li><li><strong>Completion:</strong> ${pct}%</li>` +
    `<li><strong>NHS Region:</strong> ${region}</li><li><strong>Medical Report:</strong> ${input.medical_report_url || "not generated"}</li>` +
    `<li><strong>Undue Delay Letter:</strong> ${input.undue_delay_url || "not generated"}</li></ul></body></html>`;

  const wa_no_docs = `Dear ${nom}, we have not yet received your NHS S2 documents. We have emailed you the forms to sign — please complete them and return everything to customer.service@obesity-care-clinic.com. The OCC Patient Services Team`;
  const wa_missing = `Dear ${nom}, thank you for the documents already submitted. Still missing: ${missing_text}. Please send them to customer.service@obesity-care-clinic.com. The OCC Patient Services Team`;
  const wa_complete = `Dear ${nom}, all your NHS S2 documents have been received. Your dossier is complete and is being prepared for submission. The OCC Patient Services Team`;

  return {
    missing_text,
    need_to_sign,
    html_no_docs,
    html_missing,
    html_complete,
    html_coordinator,
    wa_no_docs,
    wa_missing,
    wa_complete,
    emailFor(s: string) {
      if (s === "COMPLETE") return { subject: "Your NHS S2 Dossier is Complete", html: html_complete };
      if (s === "MISSING_DOCUMENTS") return { subject: "Your NHS S2 Application — Documents Still Required", html: html_missing };
      return { subject: "NHS S2 Document Submission Required", html: html_no_docs };
    },
    waFor(s: string) {
      if (s === "COMPLETE") return wa_complete;
      if (s === "MISSING_DOCUMENTS") return wa_missing;
      return wa_no_docs;
    },
  };
}
