// bot2.mjs : le bot WhatsApp de VoixBilan avec Baileys (version de démonstration)
// Passerelle non officielle, uniquement pour les tests.

import dotenv from "dotenv";
import fs from "fs";
import qrcode from "qrcode-terminal";
import P from "pino";
import * as Baileys from "@whiskeysockets/baileys";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const makeWASocket = Baileys.makeWASocket || Baileys.default?.default || Baileys.default;
const { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = Baileys;
const logger = P({ level: "silent" });

// ---------- Réglages ----------
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODELES_VOCAL = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.7-flash"];
const MODELES_TEXTE = ["gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.6-flash", "gemini-3.5-flash"];
const AUTORISES = (process.env.NUMEROS_AUTORISES || "").split(",").map((n) => n.trim()).filter(Boolean);
const FICHIER_DONNEES = "donnees.json";
const DELAI_MAX = 30000; // 30 secondes maximum par essai
const enAttente = {}; // messages en attente d'une précision, pour chaque commerçante

const INSTRUCTIONS = `
Tu es le comptable de VoixBilan, un carnet de comptes pour les commerçantes du Bénin.
La commerçante t'écrit ou t'envoie un vocal, en français ou en fon (fongbé).
Elle peut soit raconter des opérations à enregistrer, soit te poser une question.
Réponds UNIQUEMENT en JSON, avec ce format :
{
  "intention": "enregistrer" | "bilan" | "dettes" | "dette_client" | "annuler" | "aide" | "autre",
  "client_concerne": "nom du client si la question porte sur un client précis, sinon null",
  "transcription": "ce que la commerçante a dit, mot pour mot, dans sa langue",
  "langue": "francais" ou "fon",
  "traduction_francais": "la traduction en français si elle a parlé fon, sinon null",
  "operations": [
    {
      "type": "vente" | "depense" | "achat_stock" | "credit_accorde" | "remboursement",
      "montant": nombre en FCFA,
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
- "bilan" : elle demande le résumé de sa journée (ex : "mon bilan", "comment s'est passée ma journée").
- "dettes" : elle demande qui lui doit de l'argent ou qui a acheté à crédit.
- "dette_client" : elle demande combien UN client précis lui doit (remplis "client_concerne").
- "annuler" : elle veut annuler le dernier enregistrement.
- "aide" : elle demande comment utiliser le service.
- "autre" : salutation ou message sans rapport.
Si l'intention n'est pas "enregistrer", mets "operations": [] et "a_confirmer": null.
Règles pour enregistrer :
- "francs", "F", "CFA" veulent dire FCFA.
- Les montants peuvent être dits en mots, en français ou en fon : convertis-les en nombres.
- Une vente à crédit compte comme "credit_accorde" avec le nom du client.
- Quand un client paie ce qu'il devait, c'est un "remboursement" avec le nom du client.
- Si elle dit qu'un client a TOUT remboursé sans donner de montant, utilise le montant qu'il doit encore, indiqué dans le contexte.
- Si un client ressemble à un client déjà connu du contexte (même personne), reprends EXACTEMENT le nom du contexte.
- Le transport, le repas, le loyer sont des "depense".
- N'invente jamais un montant. Si tu as un doute, remplis "a_confirmer".
`;

const AIDE = "👋 Je suis VoixBilan.\n🎙️ Envoie-moi un vocal (français ou fon) ou un message écrit avec tes ventes, dépenses, crédits et remboursements.\n📊 Demande ton *bilan* quand tu veux.\n📒 Demande *qui te doit de l'argent*.\n↩️ Dis *annuler* pour effacer le dernier enregistrement.";

// ---------- Sauvegarde des données ----------
function lireDonnees() {
  try { return JSON.parse(fs.readFileSync(FICHIER_DONNEES, "utf8")); } catch { return []; }
}
function enregistrer(entree) {
  const donnees = lireDonnees();
  donnees.push(entree);
  fs.writeFileSync(FICHIER_DONNEES, JSON.stringify(donnees, null, 2));
}
function annulerDernier(id) {
  const donnees = lireDonnees();
  for (let i = donnees.length - 1; i >= 0; i--) {
    if (donnees[i].id === id) {
      donnees.splice(i, 1);
      fs.writeFileSync(FICHIER_DONNEES, JSON.stringify(donnees, null, 2));
      return true;
    }
  }
  return false;
}
function aujourdhui() {
  return new Date().toLocaleDateString("fr-FR", { timeZone: "Africa/Porto-Novo" });
}
const f = (n) => Number(n || 0).toLocaleString("fr-FR") + " F";
const cleNom = (nom) => String(nom || "").trim().toLowerCase();

// ---------- Calculs ----------
function totauxDuJour(id) {
  const t = { vente: 0, depense: 0, achat_stock: 0, credit_accorde: 0, remboursement: 0 };
  for (const e of lireDonnees()) {
    if (e.id !== id || e.jour !== aujourdhui()) continue;
    for (const op of e.operations) if (t[op.type] !== undefined) t[op.type] += Number(op.montant || 0);
  }
  return t;
}
function tousLesClients(id) {
  const d = {}; // on regroupe par nom, sans tenir compte des majuscules
  for (const e of lireDonnees()) {
    if (e.id !== id) continue;
    for (const op of e.operations) {
      if (!op.client) continue;
      const cle = cleNom(op.client);
      if (!d[cle]) d[cle] = { nom: op.client.trim(), total: 0, rembourse: 0 };
      if (op.type === "credit_accorde") d[cle].total += Number(op.montant || 0);
      if (op.type === "remboursement") d[cle].rembourse += Number(op.montant || 0);
    }
  }
  return Object.values(d);
}
function dettes(id) {
  return tousLesClients(id).filter((c) => c.total - c.rembourse > 0);
}
function resteDu(id, client) {
  const c = tousLesClients(id).find((x) => cleNom(x.nom) === cleNom(client));
  return c ? Math.max(c.total - c.rembourse, 0) : 0;
}
function texteBilan(id) {
  const t = totauxDuJour(id);
  const benefice = t.vente + t.credit_accorde - t.depense - t.achat_stock;
  return `📊 *Ta journée (${aujourdhui()})*\n💰 Ventes payées : ${f(t.vente)}\n📝 Ventes à crédit : ${f(t.credit_accorde)}\n💵 Remboursements reçus : ${f(t.remboursement)}\n🧾 Dépenses : ${f(t.depense)}\n📦 Achats de stock : ${f(t.achat_stock)}\n➡️ *Bénéfice estimé : ${f(benefice)}*`;
}
function texteDettes(id) {
  const liste = dettes(id);
  if (liste.length === 0) return "📒 Personne ne te doit d'argent pour l'instant.";
  const total = liste.reduce((s, c) => s + c.total - c.rembourse, 0);
  const lignes = liste.map((c) => {
    const reste = c.total - c.rembourse;
    return c.rembourse > 0
      ? `• ${c.nom} : reste ${f(reste)} (sur ${f(c.total)}, déjà remboursé ${f(c.rembourse)})`
      : `• ${c.nom} : ${f(reste)}`;
  });
  return `📒 *Qui te doit ?*\n${lignes.join("\n")}\n\n💰 *Total à récupérer : ${f(total)}*`;
}
function texteDetteClient(id, client) {
  if (!client) return texteDettes(id);
  const c = tousLesClients(id).find((x) => cleNom(x.nom) === cleNom(client));
  if (!c) return `📒 Je ne trouve aucun crédit pour ${client}.`;
  const reste = c.total - c.rembourse;
  if (reste <= 0) return `✅ ${c.nom} ne te doit plus rien (tout est remboursé).`;
  return `📒 ${c.nom} te doit encore *${f(reste)}* (crédit total ${f(c.total)}, déjà remboursé ${f(c.rembourse)}).`;
}
function contexteClients(id) {
  const clients = tousLesClients(id);
  const connus = clients.map((c) => c.nom).join(", ") || "aucun";
  const doivent = clients.filter((c) => c.total - c.rembourse > 0).map((c) => `${c.nom} (doit encore ${c.total - c.rembourse} F)`).join(", ") || "aucun";
  return `CONTEXTE (à ne pas enregistrer) : clients déjà connus de cette commerçante : ${connus}. Clients qui lui doivent encore de l'argent : ${doivent}.`;
}

// ---------- Appel à l'IA ----------
function avecDelai(promesse, ms) {
  return Promise.race([promesse, new Promise((_, rej) => setTimeout(() => rej(new Error("trop long (délai dépassé)")), ms))]);
}

async function analyser(parts, modeles) {
  for (const modele of modeles) {
    let avecReflexion = true;
    for (let essai = 1; essai <= 2; essai++) {
      const debut = Date.now();
      try {
        const config = { systemInstruction: INSTRUCTIONS, responseMimeType: "application/json", temperature: 0 };
        if (avecReflexion) config.thinkingConfig = { thinkingLevel: modele.includes("lite") ? "MINIMAL" : "LOW" };
        const reponse = await avecDelai(ai.models.generateContent({ model: modele, contents: [{ role: "user", parts }], config }), DELAI_MAX);
        console.log(`   (modèle : ${modele} - ${((Date.now() - debut) / 1000).toFixed(1)} s)`);
        return JSON.parse(reponse.text);
      } catch (e) {
        const message = String(e.message || e).slice(0, 150);
        console.log(`   ⚠️ ${modele} (essai ${essai}) : ${message}`);
        if (message.toLowerCase().includes("thinking") && avecReflexion) { avecReflexion = false; essai--; continue; }
        break; // surchargé, délai dépassé ou autre erreur : modèle suivant
      }
    }
  }
  return null;
}

// ---------- Vérification des remboursements ----------
function verifierOperations(id, operations) {
  const gardees = [];
  const avertissements = [];
  const dejaRembourse = {}; // remboursements du même message, pour ne pas compter deux fois
  for (const op of operations) {
    if (op.type === "remboursement" && op.client) {
      const cle = cleNom(op.client);
      const reste = resteDu(id, op.client) - (dejaRembourse[cle] || 0);
      if (reste <= 0) {
        avertissements.push(`ℹ️ ${op.client} ne te doit rien : remboursement non enregistré.`);
        continue;
      }
      if (Number(op.montant) > reste) {
        avertissements.push(`ℹ️ ${op.client} ne devait que ${f(reste)} : j'ai enregistré ${f(reste)}.`);
        op.montant = reste;
      }
      dejaRembourse[cle] = (dejaRembourse[cle] || 0) + Number(op.montant);
    }
    gardees.push(op);
  }
  return { gardees, avertissements };
}

// ---------- Traitement d'un message ----------
async function traiter(sock, m) {
  const jid = m.key.remoteJid;
  if (!jid || m.key.fromMe || jid.endsWith("@g.us") || jid === "status@broadcast" || !m.message) return;

  // Identifiant de l'expéditeur (numéro ou identifiant caché WhatsApp)
  const id = jid.split("@")[0].split(":")[0];
  const idAlt = (m.key.remoteJidAlt || m.key.senderPn || "").split("@")[0].split(":")[0];
  if (!AUTORISES.includes(id) && !AUTORISES.includes(idAlt)) { console.log(`🚫 Message ignoré (non autorisé) : ${id} ${idAlt}`); return; }

  const nom = m.pushName || id;
  const repondre = (texte) => sock.sendMessage(jid, { text: texte }, { quoted: m });
  let etape = "début";

  try {
    const audio = m.message.audioMessage;
    const texteRecu = m.message.conversation || m.message.extendedTextMessage?.text;
    let parts, modeles;

    if (audio) {
      console.log(`📩 Vocal de ${nom} (${id})`);
      etape = "téléchargement du vocal";
      const buffer = await downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
      const mimetype = (audio.mimetype || "audio/ogg").split(";")[0];
      parts = [{ inlineData: { mimeType: mimetype, data: buffer.toString("base64") } }];
      modeles = MODELES_VOCAL;
    } else if (texteRecu) {
      console.log(`📩 Texte de ${nom} (${id}) : ${texteRecu}`);
      const t = texteRecu.trim().toLowerCase();
      // Raccourcis écrits (réponse immédiate, sans IA)
      if (t === "aide" || t === "bonjour") { delete enAttente[id]; return repondre(AIDE); }
      if (t === "bilan") { delete enAttente[id]; return repondre(texteBilan(id)); }
      if (t === "annuler") { delete enAttente[id]; return repondre(annulerDernier(id) ? "↩️ Ton dernier enregistrement a été annulé. Tu peux renvoyer ton vocal." : "Il n'y a rien à annuler."); }
      if (t === "dettes" || t === "qui me doit") { delete enAttente[id]; return repondre(texteDettes(id)); }
      parts = [{ text: texteRecu }];
      modeles = MODELES_TEXTE;
    } else {
      return repondre("🙂 Envoie-moi un vocal ou un message écrit avec tes ventes, dépenses ou crédits.");
    }

    // Si le bot attendait une précision, on combine le message d'origine et la réponse
    if (enAttente[id]) {
      parts = [...enAttente[id], { text: "Voici la précision de la commerçante, en réponse à ta question :" }, ...parts];
      modeles = parts.some((p) => p.inlineData) ? MODELES_VOCAL : MODELES_TEXTE;
      delete enAttente[id];
      console.log("   🔗 Réponse à une question : on combine avec le message d'origine");
    }
    try { await sock.sendPresenceUpdate("composing", jid); } catch {}

    etape = "analyse par l'IA";
    console.log("   🤖 Envoi à Gemini...");
    const avecContexte = () => [{ text: contexteClients(id) }, ...parts];
    let resultat = await analyser(avecContexte(), modeles);
    for (let tour = 1; !resultat && tour <= 2; tour++) {
      if (tour === 1) await repondre("⏳ Le service est très chargé en ce moment. Je réessaie et je te réponds dans quelques minutes.");
      console.log(`   ⏳ Nouvel essai dans 60 secondes (tour ${tour}/2)`);
      await new Promise((r) => setTimeout(r, 60000));
      resultat = await analyser(avecContexte(), modeles);
    }
    if (!resultat) return repondre("😔 Désolé, je n'ai pas pu traiter ton message. Renvoie-le un peu plus tard, s'il te plaît.");
    console.log(`   ✅ Compris (intention : ${resultat.intention}) :`, JSON.stringify(resultat.operations));

    // Les questions (à l'écrit ou à la voix)
    if (resultat.intention === "bilan") return repondre(texteBilan(id));
    if (resultat.intention === "dettes") return repondre(texteDettes(id));
    if (resultat.intention === "dette_client") return repondre(texteDetteClient(id, resultat.client_concerne));
    if (resultat.intention === "annuler") return repondre(annulerDernier(id) ? "↩️ Ton dernier enregistrement a été annulé. Tu peux renvoyer ton vocal." : "Il n'y a rien à annuler.");
    if (resultat.intention === "aide") return repondre(AIDE);

    // Une information manque : on demande, et on garde le message en mémoire
    const operations = resultat.operations || [];
    const sansMontant = operations.some((op) => !(Number(op.montant) > 0));
    if (resultat.a_confirmer || sansMontant) {
      enAttente[id] = parts;
      const question = resultat.a_confirmer || "Quel est le montant exact ?";
      return repondre(`🤔 ${question}\nRéponds simplement à cette question, par vocal ou par écrit.`);
    }
    if (operations.length === 0) return repondre(AIDE);

    // Vérification des remboursements
    const { gardees, avertissements } = verifierOperations(id, operations);
    if (gardees.length === 0) return repondre(avertissements.join("\n"));

    etape = "enregistrement";
    enregistrer({
      date: new Date().toISOString(),
      jour: aujourdhui(),
      id,
      nom,
      langue: resultat.langue,
      transcription: resultat.transcription,
      traduction: resultat.traduction_francais,
      operations: gardees,
    });

    etape = "envoi de la réponse";
    const lignes = gardees.map((op) => {
      const qui = op.client ? ` (${op.client})` : "";
      return `• ${op.type.replace("_", " ")} : ${f(op.montant)}${qui}`;
    });
    const notes = avertissements.length ? `\n\n${avertissements.join("\n")}` : "";
    await repondre(`✅ *Enregistré !*\n${lignes.join("\n")}${notes}\n\n${texteBilan(id)}`);
    try { await sock.sendPresenceUpdate("paused", jid); } catch {}
    console.log("   📤 Réponse envoyée");
  } catch (e) {
    console.log(`❌ Erreur pendant l'étape « ${etape} » :`);
    console.log(e);
  }
}

// ---------- Connexion à WhatsApp ----------
async function demarrer() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_baileys");
  const sock = makeWASocket({ auth: state, logger });

  sock.ev.on("creds.update", saveCreds);

  let codeDemande = false;
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      if (process.env.NUMERO_BOT && !codeDemande) {
        codeDemande = true;
        try {
          const code = await sock.requestPairingCode(process.env.NUMERO_BOT);
          console.log("🔑 Code de connexion à taper sur le téléphone VoixBilan :", code);
        } catch (e) {
          console.log("❌ Impossible d'obtenir le code :", e.message);
        }
      } else if (!process.env.NUMERO_BOT) {
        console.log("📱 Scanne ce QR code avec le compte VoixBilan (Appareils connectés) :");
        qrcode.generate(qr, { small: true });
      }
    }
    if (connection === "open") console.log("✅ VoixBilan est connecté à WhatsApp ! En attente de messages...");
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log("❌ Déconnecté de WhatsApp. Supprime le dossier auth_baileys et relance pour rescanner.");
      } else {
        console.log("🔄 Connexion perdue, reconnexion...");
        demarrer();
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) traiter(sock, m); // chaque message est traité en parallèle
  });
}

demarrer();