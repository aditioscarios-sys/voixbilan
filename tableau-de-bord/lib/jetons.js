// lib/jetons.js : liens à usage unique (confirmation, mot de passe oublié, invitation)
const db = require("./db");
const { genererJeton, empreinte } = require("./securite");

async function creerJeton(type, { utilisateurId = null, organisationId = null, email = null, role = null, invitePar = null }, dureeMs) {
  const jeton = genererJeton();
  await db.requete(
    "INSERT INTO jetons (type, jeton_empreinte, utilisateur_id, organisation_id, email, role, invite_par, expire_le, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [type, empreinte(jeton), utilisateurId, organisationId, email, role, invitePar, new Date(Date.now() + dureeMs), new Date()]
  );
  return jeton;
}

// Renvoie le jeton s'il est valable (bon type, pas encore utilisé, pas expiré), sinon null
async function lireJeton(type, jeton) {
  if (!jeton) return null;
  const j = await db.une("SELECT * FROM jetons WHERE type = ? AND jeton_empreinte = ?", [type, empreinte(jeton)]);
  if (!j || j.utilise_le || new Date(j.expire_le) < new Date()) return null;
  return j;
}

async function utiliserJeton(id) {
  await db.requete("UPDATE jetons SET utilise_le = ? WHERE id = ?", [new Date(), id]);
}

module.exports = { creerJeton, lireJeton, utiliserJeton };