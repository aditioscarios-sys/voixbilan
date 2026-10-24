// bot.js : le bot WhatsApp de VoixBilan (version de démonstration)
// Passerelle non officielle, uniquement pour les tests.

require("dotenv").config({ path: "../.env" });
const fs = require("fs");
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { GoogleGenAI } = require("@google/genai");

// ---------- Réglages ----------
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODELES = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
const AUTORISES = (process.env.NUMEROS_AUTORISES || "").split(",").map((n) => n.trim()).filter(Boolean);
const FICHIER_DONNEES = "donnees.json";

const INSTRUCTIONS = `
Tu es le comptable de VoixBilan, un carnet de comptes pour les commerçantes du Bénin.
La commerçante raconte sa journée, en français ou en fon (fongbé).
Ta mission : trouver chaque opération et répondre UNIQUEMENT en JSON, avec ce format :
{
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
Règles :
- "francs", "F", "CFA" veulent dire FCFA.
- Les montants peuvent être dits en mots, en français ou en fon : convertis-les en nombres.
- Une vente à crédit compte comme "credit_accorde" avec le nom du client.
- Le transport, le repas, le loyer sont des "depense".
- N'invente jamais un montant. Si tu as un doute, remplis "a_confirmer".
`;

const AIDE = "👋 Je suis VoixBilan.\n🎙️ Envoie-moi un vocal (français ou fon) ou un message écrit avec tes ventes, dépenses et crédits.\n📊 Écris *bilan* pour voir ta journée.\n📒 Écris *dettes* pour voir qui te doit.";

// ---------- Sauvegarde des données (fichier local) ----------
function lireDonnees() {
  try { return JSON.parse(fs.readFileSync(FICHIER_DONNEES, "utf8")); } catch { return []; }
}
function enregistrer(entree) {
  const donnees = lireDonnees();
  donnees.push(entree);
  fs.writeFileSync(FICHIER_DONNEES, JSON.stringify(donnees, null, 2));
}
function aujourdhui() {
  return new Date().toLocaleDateString("fr-FR", { timeZone: "Africa/Porto-Novo" });
}
const f = (n) => Number(n || 0).toLocaleString("fr-FR") + " F";

// ---------- Calculs ----------
function totauxDuJour(id) {
  const t = { vente: 0, depense: 0, achat_stock: 0, credit_accorde: 0, remboursement: 0 };
  for (const e of lireDonnees()) {
    if (e.id !== id || e.jour !== aujourdhui()) continue;
    for (const op of e.operations) if (t[op.type] !== undefined) t[op.type] += Number(op.montant || 0);
  }
  return t;
}
function dettes(id) {
  const d = {};
  for (const e of lireDonnees()) {
    if (e.id !== id) continue;
    for (const op of e.operations) {
      if (!op.client) continue;
      if (op.type === "credit_accorde") d[op.client] = (d[op.client] || 0) + Number(op.montant || 0);
      if (op.type === "remboursement") d[op.client] = (d[op.client] || 0) - Number(op.montant || 0);
    }
  }
  return Object.entries(d).filter(([, m]) => m > 0);
}
function texteBilan(id) {
  const t = totauxDuJour(id);
  const benefice = t.vente + t.credit_accorde - t.depense - t.achat_stock;
  return `📊 *Ta journée (${aujourdhui()})*\n💰 Ventes payées : ${f(t.vente)}\n📝 Ventes à crédit : ${f(t.credit_accorde)}\n💵 Remboursements reçus : ${f(t.remboursement)}\n🧾 Dépenses : ${f(t.depense)}\n📦 Achats de stock : ${f(t.achat_stock)}\n➡️ *Bénéfice estimé : ${f(benefice)}*`;
}
function texteDettes(id) {
  const liste = dettes(id);
  if (liste.length === 0) return "📒 Personne ne te doit d'argent pour l'instant.";
  return "📒 *Qui te doit ?*\n" + liste.map(([nom, m]) => `• ${nom} : ${f(m)}`).join("\n");
}

// ---------- Appel à l'IA (2 essais par modèle, puis modèle suivant) ----------
async function analyser(parts) {
  for (const modele of MODELES) {
    let avecReflexion = true;
    for (let essai = 1; essai <= 2; essai++) {
      const debut = Date.now();
      try {
        const config = { systemInstruction: INSTRUCTIONS, responseMimeType: "application/json", temperature: 0 };
        if (avecReflexion) config.thinkingConfig = { thinkingLevel: modele.includes("lite") ? "MINIMAL" : "LOW" };
        const reponse = await ai.models.generateContent({ model: modele, contents: [{ role: "user", parts }], config });
        console.log(`   (modèle : ${modele} - ${((Date.now() - debut) / 1000).toFixed(1)} s)`);
        return JSON.parse(reponse.text);
      } catch (e) {
        const message = String(e.message || e).slice(0, 150);
        console.log(`   ⚠️ ${modele} (essai ${essai}) : ${message}`);
        if (message.toLowerCase().includes("thinking") && avecReflexion) { avecReflexion = false; essai--; continue; }
        if (message.includes("503") || message.includes("UNAVAILABLE")) { await new Promise((r) => setTimeout(r, 5000)); continue; }
        break;
      }
    }
  }
  return null;
}

// ---------- Le client WhatsApp ----------
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  },
});

client.on("qr", (qr) => {
  console.log("📱 Scanne ce QR code avec le numéro VoixBilan (Appareils connectés) :");
  qrcode.generate(qr, { small: true });
});
client.on("ready", () => console.log("✅ VoixBilan est connecté à WhatsApp ! En attente de messages..."));
client.on("disconnected", (raison) => console.log("❌ Déconnecté :", raison));

client.on("message", async (msg) => {
  let etape = "début";
  try {
    // On ignore les groupes, les statuts et nos propres messages
    if (msg.fromMe || msg.from.endsWith("@g.us") || msg.from === "status@broadcast") return;

    // Identifiant de l'expéditeur (numéro ou identifiant caché WhatsApp)
    const id = msg.from.split("@")[0];
    if (!AUTORISES.includes(id)) { console.log(`🚫 Message ignoré (non autorisé) : ${id}`); return; }

    etape = "lecture du contact";
    let nom = id;
    try { const contact = await msg.getContact(); nom = contact.pushname || contact.name || id; } catch {}
    console.log(`📩 Message de ${nom} (${id}) - type : ${msg.type}`);

    let parts;
    if (msg.hasMedia && (msg.type === "ptt" || msg.type === "audio")) {
      etape = "téléchargement du vocal";
      console.log("   ⬇️ Téléchargement du vocal...");
            let media = null;
      for (let i = 1; i <= 3 && !media; i++) {
        try { media = await msg.downloadMedia(); }
        catch (err) { console.log(`   ⚠️ Téléchargement, essai ${i} raté`); await new Promise((r) => setTimeout(r, 3000)); }
      }
      if (!media || !media.data) { console.log("   ❌ Vocal vide ou impossible à télécharger"); return msg.reply("😔 Je n'ai pas pu écouter ton vocal. Renvoie-le, s'il te plaît."); }
      parts = [{ inlineData: { mimeType: media.mimetype.split(";")[0], data: media.data } }];
    } else if (msg.type === "chat") {
      const texte = msg.body.trim().toLowerCase();
      if (texte === "aide" || texte === "bonjour") return msg.reply(AIDE);
      if (texte === "bilan") return msg.reply(texteBilan(id));
      if (texte === "dettes" || texte === "qui me doit") return msg.reply(texteDettes(id));
      parts = [{ text: msg.body }];
    } else {
      return msg.reply("🙂 Envoie-moi un vocal ou un message écrit avec tes ventes, dépenses ou crédits.");
    }

    // Indicateur « écrit... » (facultatif : s'il ne marche pas, on continue)
    try { const chat = await msg.getChat(); await chat.sendStateTyping(); } catch {}

    etape = "analyse par l'IA";
    console.log("   🤖 Envoi à Gemini...");
    const resultat = await analyser(parts);
    if (!resultat) return msg.reply("😔 Désolé, je n'ai pas pu traiter ton message. Réessaie dans quelques minutes.");
    console.log("   ✅ Compris :", JSON.stringify(resultat.operations));
    if (resultat.a_confirmer) return msg.reply(`🤔 ${resultat.a_confirmer}\nRenvoie ton message avec cette précision, s'il te plaît.`);

    etape = "enregistrement";
    enregistrer({
      date: new Date().toISOString(),
      jour: aujourdhui(),
      id,
      nom,
      langue: resultat.langue,
      transcription: resultat.transcription,
      traduction: resultat.traduction_francais,
      operations: resultat.operations || [],
    });

    etape = "envoi de la réponse";
    const lignes = (resultat.operations || []).map((op) => {
      const qui = op.client ? ` (${op.client})` : "";
      return `• ${op.type.replace("_", " ")} : ${f(op.montant)}${qui}`;
    });
    await msg.reply(`✅ *Enregistré !*\n${lignes.join("\n")}\n\n${texteBilan(id)}`);
    console.log("   📤 Réponse envoyée");
  } catch (e) {
    console.log(`❌ Erreur pendant l'étape « ${etape} » :`);
    console.log(e);
  }
});

client.initialize();