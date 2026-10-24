// lib/securite.js : mots de passe chiffrés, jetons et vérifications
const crypto = require("crypto");

function chiffrerMotDePasse(motdepasse) {
  const sel = crypto.randomBytes(16).toString("hex");
  const empreinte = crypto.scryptSync(String(motdepasse), sel, 64).toString("hex");
  return `${sel}:${empreinte}`;
}

function verifierMotDePasse(motdepasse, stocke) {
  if (!stocke || !stocke.includes(":")) return false;
  const [sel, empreinte] = stocke.split(":");
  const essai = crypto.scryptSync(String(motdepasse || ""), sel, 64);
  const attendu = Buffer.from(empreinte, "hex");
  return essai.length === attendu.length && crypto.timingSafeEqual(essai, attendu);
}

const genererJeton = () => crypto.randomBytes(32).toString("hex");
const empreinte = (jeton) => crypto.createHash("sha256").update(String(jeton)).digest("hex");
const motDePasseValide = (m) => typeof m === "string" && m.length >= 8 && /[A-Za-zÀ-ÿ]/.test(m) && /\d/.test(m);
const emailValide = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const normEmail = (e) => String(e || "").trim().toLowerCase();
const texte = (valeur, max = 150) => String(valeur ?? "").trim().replace(/\s+/g, " ").slice(0, max);

// Met une majuscule à la première lettre (cotonou -> Cotonou)
const majuscule = (valeur, max = 150) => {
  const t = texte(valeur, max);
  return t ? t.charAt(0).toLocaleUpperCase("fr-FR") + t.slice(1) : t;
};

module.exports = { chiffrerMotDePasse, verifierMotDePasse, genererJeton, empreinte, motDePasseValide, emailValide, normEmail, texte, majuscule };