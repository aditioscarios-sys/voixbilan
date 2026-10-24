// lib/email.js : envoi des e-mails (ou affichage dans le terminal en mode test)
const nodemailer = require("nodemailer");

const urlApp = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: process.env.SMTP_SECURE !== "false",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    })
  : null;

function gabarit({ titre, paragraphes = [], bouton, note }) {
  const p = paragraphes.map((t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1c1c1c">${esc(t)}</p>`).join("");
  const b = bouton
    ? `<p style="margin:24px 0"><a href="${esc(bouton.lien)}" style="background:#24513f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:15px;display:inline-block">${esc(bouton.texte)}</a></p>
       <p style="margin:0 0 14px;font-size:13px;color:#6b6b6b">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><span style="word-break:break-all">${esc(bouton.lien)}</span></p>`
    : "";
  const n = note ? `<p style="margin:16px 0 0;font-size:13px;color:#6b6b6b">${esc(note)}</p>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f7f7f5;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f5;padding:32px 12px"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e4e4e1;border-radius:8px">
  <tr><td style="padding:28px 32px">
  <div style="font-size:18px;font-weight:bold;color:#1c1c1c;margin-bottom:20px">VoixBilan</div>
  <h1 style="font-size:20px;font-weight:600;color:#1c1c1c;margin:0 0 16px">${esc(titre)}</h1>${p}${b}${n}
  </td></tr></table>
  <p style="font-size:12px;color:#6b6b6b;margin:16px 0 0">VoixBilan · Carnet de comptes vocal pour les commerçantes<br>E-mail envoyé automatiquement, merci de ne pas y répondre.</p>
  </td></tr></table></body></html>`;
}

async function envoyer({ a, sujet, titre, paragraphes = [], bouton, note }) {
  const texteBrut = [...paragraphes, bouton ? `${bouton.texte} : ${bouton.lien}` : "", note || ""].filter(Boolean).join("\n\n");
  if (!transport) {
    console.log(`\n========== E-MAIL (mode test, non envoyé) ==========\nÀ : ${a}\nSujet : ${sujet}\n\n${texteBrut}\n====================================================\n`);
    return;
  }
  try {
    await transport.sendMail({ from: process.env.EMAIL_FROM || "VoixBilan <noreply@voixbilan.com>", to: a, subject: sujet, text: texteBrut, html: gabarit({ titre, paragraphes, bouton, note }) });
  } catch (erreur) {
    console.log("Erreur d'envoi d'e-mail :", erreur.message);
  }
}

async function alerteMotDePasse(utilisateur) {
  await envoyer({
    a: utilisateur.email,
    sujet: "Votre mot de passe a été modifié",
    titre: "Votre mot de passe a été modifié",
    paragraphes: [
      `Bonjour ${utilisateur.nom},`,
      "Le mot de passe de votre compte VoixBilan vient d'être modifié.",
      "Si vous êtes à l'origine de ce changement, vous n'avez rien à faire. Sinon, réinitialisez immédiatement votre mot de passe et prévenez l'administrateur de votre organisation.",
    ],
    bouton: { texte: "Réinitialiser mon mot de passe", lien: `${urlApp()}/mot-de-passe-oublie` },
  });
}

module.exports = { envoyer, alerteMotDePasse, urlApp };