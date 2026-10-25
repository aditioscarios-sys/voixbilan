// bot3.mjs : bot WhatsApp de VoixBilan relié à la base MySQL (activation par code)
// Passerelle non officielle (Baileys), uniquement pour la démonstration et les tests.

import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import qrcode from "qrcode-terminal";
import P from "pino";
import mysql from "mysql2/promise";
import { createRequire } from "module";
import * as Baileys from "@whiskeysockets/baileys";
import { GoogleGenAI } from "@google/genai";

dotenv.config();
const require = createRequire(import.meta.url);
const { infoLangue } = require("./reference.cjs");

const makeWASocket = Baileys.makeWASocket || Baileys.default?.default || Baileys.default;
const { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = Baileys;
const logger = P({ level: "silent" });

// ---------- Réglages ----------
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODELES_VOCAL = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.7-flash"];
const MODELES_TEXTE = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.6-flash", "gemini-3.5-flash-lite"];
const DELAI_MAX = 30000; // 30 secondes maximum par essai
const FUSEAU = process.env.FUSEAU || "Africa/Porto-Novo";
const DOSSIER_AUTH = process.env.DOSSIER_AUTH || "auth_bot3";
const DOSSIER_VOCAUX = process.env.DOSSIER_VOCAUX || "vocaux";

// ---------- Base de données ----------
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  maxIdle: 2,
  idleTimeout: 60000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 15000,
  timezone: "Z",
  charset: "utf8mb4",
});
const ERREURS_CONNEXION = ["ECONNRESET", "PROTOCOL_CONNECTION_LOST", "EPIPE", "ETIMEDOUT", "ECONNREFUSED"];

async function requete(sql, params = []) {
  const valeurs = params.map((p) => (p === undefined ? null : p));
  try {
    const [lignes] = await pool.execute(sql, valeurs);
    return lignes;
  } catch (e) {
    if (!ERREURS_CONNEXION.includes(e.code)) throw e;
    console.log(`   Connexion à la base coupée (${e.code}), nouvel essai...`);
    const [lignes] = await pool.execute(sql, valeurs);
    return lignes;
  }
}
const une = async (sql, params) => (await requete(sql, params))[0] || null;

async function transaction(fonction) {
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const r = await fonction(cx);
    await cx.commit();
    return r;
  } catch (e) {
    await cx.rollback().catch(() => {});
    throw e;
  } finally {
    cx.release();
  }
}

// ---------- Mémoire temporaire ----------
const enAttente = {};    // une précision a été demandée : message d'origine (par commerçante)
const aConfirmer = {};   // langue expérimentale : opérations en attente d'un "oui" (par commerçante)
const derniersAvis = {}; // numéros inconnus : dernière réponse envoyée
const essaisCode = {};   // numéros inconnus : tentatives de code (anti-abus)

// ---------- Outils ----------
const LIBELLES = { vente: "Vente", depense: "Dépense", achat_stock: "Achat de stock", credit_accorde: "Vente à crédit", remboursement: "Remboursement" };
const f = (n, devise) => `${Number(n || 0).toLocaleString("fr-FR")} ${devise === "XOF" || devise === "XAF" ? "F" : devise}`;
const cleNom = (nom) => String(nom || "").trim().toLowerCase();
const premierMot = (nom) => String(nom || "").trim().split(/\s+/)[0];
const aujourdhui = () => new Date().toLocaleDateString("fr-FR", { timeZone: FUSEAU });

// Début de la journée (minuit, heure locale) exprimé en heure universelle
function debutDuJour() {
  const maintenant = new Date();
  const local = new Date(maintenant.toLocaleString("en-US", { timeZone: FUSEAU }));
  const decalage = local.getTime() - maintenant.getTime();
  const minuit = new Date(local);
  minuit.setHours(0, 0, 0, 0);
  return new Date(minuit.getTime() - decalage);
}

// Code à 6 chiffres dans un texte ("482913", "482 913", "482-913")
function extraireCode(texte) {
  const m = String(texte || "").replace(/[\s.\-]/g, "").match(/(?<!\d)\d{6}(?!\d)/);
  return m ? m[0] : null;
}

// Consigne envoyée à la commerçante selon sa langue
function consigneBot(langue) {
  if (langue.statut === "disponible") return "Tu peux parler ou écrire en français.";
  if (langue.statut === "montants_fr") return `Tu peux parler en ${langue.nom}, mais dis les montants en français, s'il te plaît.`;
  if (langue.statut === "experimental") return `Tu peux parler en ${langue.nom}. Cette langue est encore en test : je te demanderai de confirmer avant d'enregistrer. Les montants dits en français sont les plus sûrs.`;
  return `Le ${langue.nom} n'est pas encore compris. Pour l'instant, parle ou écris en français, s'il te plaît.`;
}

const AIDE = "*VoixBilan, ton carnet de comptes*\n" +
  "Envoie un vocal ou un message écrit avec tes ventes, dépenses, achats de stock, crédits et remboursements.\n" +
  "Écris *bilan* pour le résumé de ta journée.\n" +
  "Écris *dettes* pour savoir qui te doit de l'argent.\n" +
  "Écris *annuler* pour effacer le dernier enregistrement.";

// ---------- Instructions pour l'IA ----------
function instructions(c) {
  const autre = c.langueInfo.code === "francais" ? "" : ` ou en ${c.langueInfo.nom}`;
  return `
Tu es le comptable de VoixBilan, un carnet de comptes pour les commerçantes (pays : ${c.pays}).
La commerçante t'écrit ou t'envoie un vocal, en français${autre}. Elle peut mélanger les langues.
Elle peut soit raconter des opérations à enregistrer, soit te poser une question.
Réponds UNIQUEMENT en JSON, avec ce format :
{
  "intention": "enregistrer" | "bilan" | "dettes" | "dette_client" | "annuler" | "aide" | "confirmer" | "refuser" | "autre",
  "client_concerne": "nom du client si la question porte sur un client précis, sinon null",
  "transcription": "ce que la commerçante a dit, mot pour mot, dans sa langue",
  "langue": "francais" ou "${c.langueInfo.code}",
  "traduction_francais": "la traduction en français si elle n'a pas parlé français, sinon null",
  "operations": [
    {
      "type": "vente" | "depense" | "achat_stock" | "credit_accorde" | "remboursement",
      "montant": nombre (dans la monnaie locale : ${c.devise}),
      "produit": "texte ou null",
      "quantite": nombre ou null,
      "client": "nom ou null",
      "description": "explication courte"
    }
  ],
  "a_confirmer": "une question si un montant ou un nom n'est pas clair, sinon null"
}
Intentions :
- "enregistrer" : elle raconte des ventes, dépenses, achats de stock, crédits ou remboursements.
- "bilan" : elle demande le résumé de sa journée.
- "dettes" : elle POSE UNE QUESTION pour savoir qui lui doit de l'argent (exemples : "qui me doit ?", "mes dettes ?").
- "dette_client" : elle POSE UNE QUESTION pour savoir combien UN client précis lui doit (remplis "client_concerne").
IMPORTANT : quand elle RACONTE qu'un client a pris, acheté, payé ou remboursé quelque chose (exemples : "Tantie Rose a pris 1500 à crédit", "Maman Reine m'a remboursé 1000"), l'intention est TOUJOURS "enregistrer", jamais "dettes" ni "dette_client".
- "annuler" : elle veut annuler le dernier enregistrement.
- "aide" : elle demande comment utiliser le service.
- "confirmer" : elle répond oui, d'accord, c'est bon, pour valider ce que tu as compris.
- "refuser" : elle répond non, c'est faux, pour refuser ce que tu as compris.
- "autre" : salutation ou message sans rapport.
Remplis TOUJOURS "operations" dès que le message raconte une vente, une dépense, un achat de stock, un crédit ou un remboursement, même si tu hésites sur l'intention. Pour une simple question, mets "operations": [] et "a_confirmer": null.
Exemples :
- "Tanti rose a pris 1500f a credit" : intention "enregistrer", une opération "credit_accorde" de 1500, client "Tantie Rose".
- "Maman Reine m'a remboursé 1000" : intention "enregistrer", une opération "remboursement" de 1000, client "Maman Reine".
- "Combien Maman Reine me doit ?" : intention "dette_client", client_concerne "Maman Reine", operations [].
- "Qui me doit ?" : intention "dettes", operations [].
Règles pour enregistrer :
- "francs", "F", "CFA" désignent la monnaie locale.
- Les montants peuvent être dits en mots, en français ou dans une langue locale : convertis-les en nombres.
- Une vente à crédit compte comme "credit_accorde" avec le nom du client.
- Quand un client paie ce qu'il devait, c'est un "remboursement" avec le nom du client.
- Si elle dit qu'un client a TOUT remboursé sans donner de montant, utilise le montant qu'il doit encore, indiqué dans le contexte.
- Si un client ressemble à un client déjà connu du contexte (même personne), reprends EXACTEMENT le nom du contexte.
- Le transport, le repas, le loyer sont des "depense".
- N'invente jamais un montant. Si tu as un doute, remplis "a_confirmer".
`;
}

const CONSIGNE_CODE = `Le message audio contient un code d'activation de 6 chiffres, dit à voix haute (en français ou dans une langue locale).
Réponds UNIQUEMENT en JSON : {"code": "123456"} avec les 6 chiffres, ou {"code": null} si tu n'entends pas de code de 6 chiffres.`;

// ---------- Appel à l'IA (cascade de modèles) ----------
function avecDelai(promesse, ms) {
  return Promise.race([promesse, new Promise((_, rej) => setTimeout(() => rej(new Error("trop long (délai dépassé)")), ms))]);
}

async function analyser(parts, modeles, systeme) {
  for (const modele of modeles) {
    let avecReflexion = true;
    for (let essai = 1; essai <= 2; essai++) {
      const debut = Date.now();
      try {
        const config = { systemInstruction: systeme, responseMimeType: "application/json", temperature: 0 };
        if (avecReflexion) config.thinkingConfig = { thinkingLevel: modele.includes("lite") ? "MINIMAL" : "LOW" };
        const reponse = await avecDelai(ai.models.generateContent({ model: modele, contents: [{ role: "user", parts }], config }), DELAI_MAX);
        console.log(`   (modèle : ${modele} - ${((Date.now() - debut) / 1000).toFixed(1)} s)`);
        return { resultat: JSON.parse(reponse.text), modele };
      } catch (e) {
        const message = String(e.message || e).slice(0, 150);
        console.log(`   Attention : ${modele} (essai ${essai}) : ${message}`);
        if (message.toLowerCase().includes("thinking") && avecReflexion) { avecReflexion = false; essai--; continue; }
        break; // surchargé, délai dépassé ou autre erreur : modèle suivant
      }
    }
  }
  return null;
}

// ---------- Commerçantes ----------
const SELECT_COMMERCANTE = `SELECT c.id, c.nom, c.langue, c.actif, c.accord_vocaux, o.nom AS org_nom, o.pays, o.devise
  FROM commercantes c JOIN organisations o ON o.id = c.organisation_id`;

function preparer(c) {
  if (c) c.langueInfo = infoLangue(c.pays, c.langue);
  return c;
}

async function trouverCommercante(id, idAlt) {
  return preparer(await une(`${SELECT_COMMERCANTE} WHERE c.identifiant_whatsapp IN (?, ?)`, [id, idAlt || id]));
}

async function activer(code, id) {
  const c = await une(`${SELECT_COMMERCANTE} WHERE c.code_activation = ?`, [code]);
  if (!c || !c.actif) return null;
  await transaction(async (cx) => {
    await cx.execute("UPDATE commercantes SET identifiant_whatsapp = NULL WHERE identifiant_whatsapp = ?", [id]);
    await cx.execute("UPDATE commercantes SET identifiant_whatsapp = ?, code_activation = NULL, activee_le = COALESCE(activee_le, ?) WHERE id = ?", [id, new Date(), c.id]);
  });
  return preparer(c);
}

// ---------- Calculs (depuis la base) ----------
async function totauxDuJour(cid) {
  const t = { vente: 0, depense: 0, achat_stock: 0, credit_accorde: 0, remboursement: 0 };
  const lignes = await requete("SELECT type, SUM(montant) AS total FROM operations WHERE commercante_id = ? AND annulee = 0 AND date_operation >= ? GROUP BY type", [cid, debutDuJour()]);
  for (const l of lignes) t[l.type] = Number(l.total);
  return t;
}

async function tousLesClients(cid) {
  const lignes = await requete(
    `SELECT MIN(client) AS nom,
       SUM(CASE WHEN type = 'credit_accorde' THEN montant ELSE 0 END) AS total,
       SUM(CASE WHEN type = 'remboursement' THEN montant ELSE 0 END) AS rembourse
     FROM operations WHERE commercante_id = ? AND annulee = 0 AND client IS NOT NULL AND client <> ''
     GROUP BY client`,
    [cid]
  );
  return lignes.map((l) => ({ nom: l.nom, total: Number(l.total), rembourse: Number(l.rembourse) }));
}

async function resteDu(cid, client) {
  const c = (await tousLesClients(cid)).find((x) => cleNom(x.nom) === cleNom(client));
  return c ? Math.max(c.total - c.rembourse, 0) : 0;
}

async function texteBilan(c) {
  const t = await totauxDuJour(c.id);
  const benefice = t.vente + t.credit_accorde - t.depense - t.achat_stock;
  const d = c.devise;
  return `*Ta journée (${aujourdhui()})*\nVentes payées : ${f(t.vente, d)}\nVentes à crédit : ${f(t.credit_accorde, d)}\nRemboursements reçus : ${f(t.remboursement, d)}\nDépenses : ${f(t.depense, d)}\nAchats de stock : ${f(t.achat_stock, d)}\n*Bénéfice estimé : ${f(benefice, d)}*`;
}

async function texteDettes(c) {
  const liste = (await tousLesClients(c.id)).filter((x) => x.total - x.rembourse > 0);
  if (liste.length === 0) return "Personne ne te doit d'argent pour l'instant.";
  const d = c.devise;
  const total = liste.reduce((s, x) => s + x.total - x.rembourse, 0);
  const lignes = liste.map((x) => {
    const reste = x.total - x.rembourse;
    return x.rembourse > 0
      ? `- ${x.nom} : reste ${f(reste, d)} (sur ${f(x.total, d)}, déjà remboursé ${f(x.rembourse, d)})`
      : `- ${x.nom} : ${f(reste, d)}`;
  });
  return `*Qui te doit ?*\n${lignes.join("\n")}\n\n*Total à récupérer : ${f(total, d)}*`;
}

async function texteDetteClient(c, client) {
  if (!client) return texteDettes(c);
  const x = (await tousLesClients(c.id)).find((y) => cleNom(y.nom) === cleNom(client));
  if (!x) return `Je ne trouve aucun crédit pour ${client}.`;
  const reste = x.total - x.rembourse;
  if (reste <= 0) return `${x.nom} ne te doit plus rien (tout est remboursé).`;
  return `${x.nom} te doit encore *${f(reste, c.devise)}* (crédit total ${f(x.total, c.devise)}, déjà remboursé ${f(x.rembourse, c.devise)}).`;
}

async function contexteClients(c) {
  const clients = await tousLesClients(c.id);
  const connus = clients.map((x) => x.nom).join(", ") || "aucun";
  const doivent = clients.filter((x) => x.total - x.rembourse > 0).map((x) => `${x.nom} (doit encore ${x.total - x.rembourse})`).join(", ") || "aucun";
  return `CONTEXTE (à ne pas enregistrer) : clients déjà connus de cette commerçante : ${connus}. Clients qui lui doivent encore de l'argent : ${doivent}.`;
}

// ---------- Vérification des remboursements ----------
async function verifierOperations(c, operations) {
  const gardees = [];
  const avertissements = [];
  const dejaRembourse = {};
  for (const op of operations) {
    if (op.type === "remboursement" && op.client) {
      const cle = cleNom(op.client);
      const reste = (await resteDu(c.id, op.client)) - (dejaRembourse[cle] || 0);
      if (reste <= 0) { avertissements.push(`${op.client} ne te doit rien : remboursement non enregistré.`); continue; }
      if (Number(op.montant) > reste) {
        avertissements.push(`${op.client} ne devait que ${f(reste, c.devise)} : j'ai enregistré ${f(reste, c.devise)}.`);
        op.montant = reste;
      }
      dejaRembourse[cle] = (dejaRembourse[cle] || 0) + Number(op.montant);
    }
    gardees.push(op);
  }
  return { gardees, avertissements };
}

// ---------- Enregistrement dans la base ----------
async function noterMessage(c, { type, langue = null, transcription = null, traduction = null, intention = null, modele = null, fichier = null, operations = [] }) {
  const maintenant = new Date();
  await transaction(async (cx) => {
    const [m] = await cx.execute(
      "INSERT INTO messages (commercante_id, date_message, type, langue, transcription, traduction, intention, modele, statut, fichier_audio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'enregistre', ?)",
      [c.id, maintenant, type, langue, transcription, traduction, intention, modele, fichier]
    );
    for (const op of operations) {
      await cx.execute(
        "INSERT INTO operations (message_id, commercante_id, date_operation, type, montant, produit, quantite, client, description, annulee) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
        [m.insertId, c.id, maintenant, op.type, Number(op.montant), op.produit ? String(op.produit).slice(0, 150) : null,
          Number(op.quantite) > 0 ? Number(op.quantite) : null, op.client ? String(op.client).trim().slice(0, 150) : null,
          op.description ? String(op.description).slice(0, 255) : null]
      );
    }
  });
}

async function annulerDernier(c) {
  const m = await une(
    `SELECT m.id FROM messages m WHERE m.commercante_id = ? AND m.statut = 'enregistre'
       AND EXISTS (SELECT 1 FROM operations o WHERE o.message_id = m.id AND o.annulee = 0)
     ORDER BY m.date_message DESC, m.id DESC LIMIT 1`,
    [c.id]
  );
  if (!m) return false;
  await requete("UPDATE operations SET annulee = 1 WHERE message_id = ?", [m.id]);
  await requete("UPDATE messages SET statut = 'annule' WHERE id = ?", [m.id]);
  return true;
}

function sauverVocal(c, buffer) {
  if (!c.accord_vocaux || !buffer) return null;
  try {
    fs.mkdirSync(DOSSIER_VOCAUX, { recursive: true });
    const fichier = path.join(DOSSIER_VOCAUX, `${c.id}-${Date.now()}.ogg`);
    fs.writeFileSync(fichier, buffer);
    return fichier;
  } catch (e) {
    console.log("   Vocal non conservé :", e.message);
    return null;
  }
}

async function enregistrerEtRepondre(c, repondre, { resultat, gardees, avertissements, type, modele, fichier }) {
  await noterMessage(c, {
    type, langue: resultat.langue, transcription: resultat.transcription, traduction: resultat.traduction_francais,
    intention: "enregistrer", modele, fichier, operations: gardees,
  });
  const lignes = gardees.map((op) => `- ${LIBELLES[op.type] || op.type} : ${f(op.montant, c.devise)}${op.client ? ` (${op.client})` : ""}`);
  const notes = avertissements.length ? `\n\n${avertissements.join("\n")}` : "";
  await repondre(`*Enregistré.*\n${lignes.join("\n")}${notes}\n\n${await texteBilan(c)}`);
}

// ---------- Numéro inconnu : activation par code ----------
async function accueillirInconnu(m, id, texteRecu, audio, sock, repondre) {
  const maintenant = Date.now();
  const essais = (essaisCode[id] = (essaisCode[id] || []).filter((t) => maintenant - t < 3600000));
  if (essais.length >= 5) { console.log(`   Trop d'essais de code pour ${id} : ignoré`); return; }

  let code = texteRecu ? extraireCode(texteRecu) : null;
  if (!code && audio) {
    essais.push(maintenant); // chaque vocal analysé compte comme un essai
    const buffer = await downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
    const mimetype = (audio.mimetype || "audio/ogg").split(";")[0];
    const r = await analyser([{ inlineData: { mimeType: mimetype, data: buffer.toString("base64") } }], MODELES_VOCAL, CONSIGNE_CODE);
    code = r?.resultat?.code ? extraireCode(String(r.resultat.code)) : null;
    console.log(`   Code entendu dans le vocal : ${code || "aucun"}`);
  }

  if (code) {
    const c = await activer(code, id);
    if (c) {
      delete essaisCode[id];
      console.log(`   Activation réussie : ${c.nom} (${c.org_nom})`);
      return repondre(`Bienvenue ${premierMot(c.nom)}. Ton carnet VoixBilan est activé avec *${c.org_nom}*.\n\n${consigneBot(c.langueInfo)}\n\nEnvoie maintenant tes ventes, dépenses et crédits, par vocal ou par écrit, quand tu veux. Écris *aide* pour voir tout ce que tu peux faire.`);
    }
    if (!audio) essais.push(maintenant);
    console.log(`   Code refusé : ${code}`);
    return repondre("Ce code n'est pas valable. Vérifie-le auprès de ton organisation, puis renvoie-le.");
  }

    // Des chiffres, mais pas exactement 6 : on explique
  if (texteRecu && /\d{3,}/.test(texteRecu.replace(/[\s.\-]/g, ""))) {
    essais.push(maintenant);
    return repondre("Le code d'activation contient exactement 6 chiffres. Vérifie-le auprès de ton organisation, puis renvoie-le.");
  }
  if (maintenant - (derniersAvis[id] || 0) < 10 * 60000) return;
  derniersAvis[id] = maintenant;
  return repondre("Bonjour. Ce numéro n'est pas encore activé sur VoixBilan.\nEnvoie le code à 6 chiffres donné par ton organisation, par écrit ou à la voix.");
}

// ---------- Traitement d'un message ----------
const OUI = ["oui", "ok", "okay", "d'accord", "daccord", "c'est bon", "cest bon", "oui c'est bon", "yes", "valide", "confirme"];
const NON = ["non", "faux", "c'est faux", "cest faux", "pas ça", "no"];
const normaliser = (t) => String(t || "").trim().toLowerCase().replace(/[.!?\s]+$/g, "");

async function traiter(sock, m) {
  const jid = m.key.remoteJid;
  if (!jid || m.key.fromMe || jid.endsWith("@g.us") || jid === "status@broadcast" || !m.message) return;

  // Identifiant de l'expéditeur (numéro ou identifiant caché WhatsApp)
  const id = jid.split("@")[0].split(":")[0];
  const idAlt = (m.key.remoteJidAlt || m.key.senderPn || "").split("@")[0].split(":")[0];
  const repondre = (texte) => sock.sendMessage(jid, { text: texte }, { quoted: m });
  const audio = m.message.audioMessage;
  const texteRecu = m.message.conversation || m.message.extendedTextMessage?.text;
  let etape = "recherche de la commerçante";

  try {
    const c = await trouverCommercante(id, idAlt);

    // Numéro inconnu : activation par code
    if (!c) {
      console.log(`Message d'un numéro non activé : ${id} ${idAlt}`);
      etape = "activation";
      return await accueillirInconnu(m, id, texteRecu, audio, sock, repondre);
    }

    // Commerçante désactivée
    if (!c.actif) {
      if (Date.now() - (derniersAvis[id] || 0) > 10 * 60000) {
        derniersAvis[id] = Date.now();
        await repondre("Ton carnet VoixBilan est suspendu. Contacte ton organisation.");
      }
      return;
    }

    let parts, modeles, buffer = null;
    const type = audio ? "vocal" : "texte";

    if (audio) {
      console.log(`Vocal de ${c.nom} (${c.org_nom})`);
      etape = "téléchargement du vocal";
      buffer = await downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
      const mimetype = (audio.mimetype || "audio/ogg").split(";")[0];
      parts = [{ inlineData: { mimeType: mimetype, data: buffer.toString("base64") } }];
      modeles = MODELES_VOCAL;
    } else if (texteRecu) {
      console.log(`Texte de ${c.nom} (${c.org_nom}) : ${texteRecu}`);
      const t = normaliser(texteRecu);

      // Réponse à une demande de confirmation (langue expérimentale)
      if (aConfirmer[c.id]) {
        if (OUI.includes(t)) { const attente = aConfirmer[c.id]; delete aConfirmer[c.id]; return await enregistrerEtRepondre(c, repondre, attente); }
        if (NON.includes(t)) { delete aConfirmer[c.id]; return await repondre("D'accord, rien n'a été enregistré. Renvoie ton message pour corriger."); }
      }

      // Raccourcis écrits (réponse immédiate, sans IA)
      if (t === "aide" || t === "bonjour") { delete enAttente[c.id]; await noterMessage(c, { type, intention: "aide", transcription: texteRecu }); return await repondre(AIDE); }
      if (t === "bilan") { delete enAttente[c.id]; await noterMessage(c, { type, intention: "bilan", transcription: texteRecu }); return await repondre(await texteBilan(c)); }
      if (t === "annuler") { delete enAttente[c.id]; delete aConfirmer[c.id]; return await repondre((await annulerDernier(c)) ? "Ton dernier enregistrement a été annulé. Tu peux renvoyer ton message." : "Il n'y a rien à annuler."); }
      if (t === "dettes" || t === "qui me doit") { delete enAttente[c.id]; await noterMessage(c, { type, intention: "dettes", transcription: texteRecu }); return await repondre(await texteDettes(c)); }
      parts = [{ text: texteRecu }];
      modeles = MODELES_TEXTE;
    } else {
      return await repondre("Envoie-moi un vocal ou un message écrit avec tes ventes, dépenses ou crédits.");
    }

    // Si le bot attendait une précision, on combine le message d'origine et la réponse
    if (enAttente[c.id]) {
      parts = [...enAttente[c.id], { text: "Voici la précision de la commerçante, en réponse à ta question :" }, ...parts];
      modeles = parts.some((p) => p.inlineData) ? MODELES_VOCAL : MODELES_TEXTE;
      delete enAttente[c.id];
      console.log("   Réponse à une question : on combine avec le message d'origine");
    }
    try { await sock.sendPresenceUpdate("composing", jid); } catch {}

    etape = "analyse par l'IA";
    const avecContexte = async () => [{ text: await contexteClients(c) }, ...parts];
    let analyse = await analyser(await avecContexte(), modeles, instructions(c));
    for (let tour = 1; !analyse && tour <= 2; tour++) {
      if (tour === 1) await repondre("Le service est très chargé en ce moment. Je réessaie et je te réponds dans quelques minutes.");
      console.log(`   Nouvel essai dans 60 secondes (tour ${tour}/2)`);
      await new Promise((r) => setTimeout(r, 60000));
      analyse = await analyser(await avecContexte(), modeles, instructions(c));
    }
    if (!analyse) return await repondre("Désolé, je n'ai pas pu traiter ton message. Renvoie-le un peu plus tard, s'il te plaît.");
    const { resultat, modele } = analyse;
    console.log(`   Compris (intention : ${resultat.intention}) :`, JSON.stringify(resultat.operations));
    // Sécurité : si l'IA a trouvé des opérations, c'est un enregistrement, même si elle a hésité sur l'intention
    if ((resultat.operations || []).length > 0 && !["enregistrer", "confirmer"].includes(resultat.intention)) {
      console.log(`   Intention corrigée : ${resultat.intention} -> enregistrer (des opérations ont été trouvées)`);
      resultat.intention = "enregistrer";
    }
    // Réponse vocale à une demande de confirmation
    if (aConfirmer[c.id]) {
      const attente = aConfirmer[c.id];
      delete aConfirmer[c.id];
      if (resultat.intention === "confirmer") return await enregistrerEtRepondre(c, repondre, attente);
      if (resultat.intention === "refuser") return await repondre("D'accord, rien n'a été enregistré. Renvoie ton message pour corriger.");
      // Sinon : nouveau message, l'ancienne proposition est abandonnée
    }

    // Les questions (à l'écrit ou à la voix)
    const noter = (intention) => noterMessage(c, { type, intention, langue: resultat.langue, transcription: resultat.transcription, traduction: resultat.traduction_francais, modele });
    if (resultat.intention === "bilan") { await noter("bilan"); return await repondre(await texteBilan(c)); }
    if (resultat.intention === "dettes") { await noter("dettes"); return await repondre(await texteDettes(c)); }
    if (resultat.intention === "dette_client") { await noter("dette_client"); return await repondre(await texteDetteClient(c, resultat.client_concerne)); }
    if (resultat.intention === "annuler") return await repondre((await annulerDernier(c)) ? "Ton dernier enregistrement a été annulé. Tu peux renvoyer ton message." : "Il n'y a rien à annuler.");
    if (resultat.intention === "aide") { await noter("aide"); return await repondre(AIDE); }

    // Une information manque : on demande, et on garde le message en mémoire
    const operations = resultat.operations || [];
    const sansMontant = operations.some((op) => !(Number(op.montant) > 0));
    if (resultat.a_confirmer || sansMontant) {
      enAttente[c.id] = parts;
      return await repondre(`${resultat.a_confirmer || "Quel est le montant exact ?"}\nRéponds simplement à cette question, par vocal ou par écrit.`);
    }
    if (operations.length === 0) { await noter(resultat.intention || "autre"); return await repondre(AIDE); }

    // Vérification des remboursements
    etape = "vérification";
    const { gardees, avertissements } = await verifierOperations(c, operations);
    if (gardees.length === 0) return await repondre(avertissements.join("\n"));

    const fichier = sauverVocal(c, buffer);
    const attente = { resultat, gardees, avertissements, type, modele, fichier };

    // Langue expérimentale (et message non dit en français) : on demande confirmation
    if (c.langueInfo.statut === "experimental" && resultat.langue !== "francais") {
      aConfirmer[c.id] = attente;
      const lignes = gardees.map((op) => `- ${LIBELLES[op.type] || op.type} : ${f(op.montant, c.devise)}${op.client ? ` (${op.client})` : ""}`);
      return await repondre(`Voici ce que j'ai compris :\n${lignes.join("\n")}\n\nRéponds *oui* pour enregistrer, ou renvoie ton message pour corriger.`);
    }

    etape = "enregistrement";
    await enregistrerEtRepondre(c, repondre, attente);
    try { await sock.sendPresenceUpdate("paused", jid); } catch {}
    console.log("   Réponse envoyée");
  } catch (e) {
    console.log(`Erreur pendant l'étape « ${etape} » :`);
    console.log(e);
  }
}

// ---------- Connexion à WhatsApp ----------
async function demarrer() {
  const { state, saveCreds } = await useMultiFileAuthState(DOSSIER_AUTH);
  const sock = makeWASocket({ auth: state, logger });
  sock.ev.on("creds.update", saveCreds);

  let codeDemande = false;
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      if (process.env.NUMERO_BOT && !codeDemande) {
        codeDemande = true;
        try {
          const code = await sock.requestPairingCode(process.env.NUMERO_BOT);
          console.log("Code de connexion à taper sur le téléphone VoixBilan :", code);
        } catch (e) {
          console.log("Impossible d'obtenir le code :", e.message);
        }
      } else if (!process.env.NUMERO_BOT) {
        console.log("Scanne ce QR code avec le compte VoixBilan (Appareils connectés) :");
        qrcode.generate(qr, { small: true });
      }
    }
    if (connection === "open") console.log("VoixBilan (bot3, relié à la base) est connecté à WhatsApp. En attente de messages...");
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log(`Déconnecté de WhatsApp. Supprime le dossier ${DOSSIER_AUTH} et relance pour te reconnecter.`);
      } else {
        console.log("Connexion perdue, reconnexion...");
        demarrer();
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) traiter(sock, m); // chaque message est traité en parallèle
  });
}

// Vérifie la base avant de démarrer
try {
  await requete("SELECT 1");
  console.log("Base de données : connexion réussie.");
  demarrer();
} catch (e) {
  console.log("Impossible de se connecter à la base de données :", e.message);
  process.exit(1);
}