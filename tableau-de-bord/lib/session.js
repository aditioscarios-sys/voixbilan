// lib/session.js : sessions de connexion (7 jours), conservées dans la base
const db = require("./db");
const { genererJeton, empreinte } = require("./securite");

const NOM = "vb_session";
const DUREE = 7 * 24 * 3600 * 1000;

function cookie(valeur, maxAge) {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `${NOM}=${valeur}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function lireCookie(req) {
  const ligne = (req.headers.cookie || "").split(";").map((s) => s.trim()).find((s) => s.startsWith(NOM + "="));
  return ligne ? decodeURIComponent(ligne.slice(NOM.length + 1)) : null;
}

// Ouvre une session et note la date de connexion (quel que soit le moyen : mot de passe, lien de confirmation, invitation)
async function creerSession(res, utilisateurId) {
  const jeton = genererJeton();
  const maintenant = new Date();
  await db.requete("DELETE FROM sessions WHERE expire_le < ?", [maintenant]);
  await db.requete("INSERT INTO sessions (id, utilisateur_id, expire_le, date_creation) VALUES (?, ?, ?, ?)", [empreinte(jeton), utilisateurId, new Date(Date.now() + DUREE), maintenant]);
  await db.requete("UPDATE utilisateurs SET derniere_connexion = ? WHERE id = ?", [maintenant, utilisateurId]);
  res.setHeader("Set-Cookie", cookie(jeton, DUREE / 1000));
}

async function detruireSession(req, res) {
  const jeton = lireCookie(req);
  if (jeton) await db.requete("DELETE FROM sessions WHERE id = ?", [empreinte(jeton)]);
  res.setHeader("Set-Cookie", cookie("", 0));
}

// Lit la session à chaque page : req.utilisateur et req.organisation
async function chargerSession(req, res, next) {
  try {
    const jeton = lireCookie(req);
    if (jeton) {
      const s = await db.une(
        `SELECT s.id AS session_id, s.expire_le, u.id, u.nom, u.fonction, u.email, u.role, u.actif,
                o.id AS org_id, o.nom AS org_nom, o.type AS org_type, o.pays AS org_pays, o.ville AS org_ville,
                o.devise AS org_devise, o.telephone AS org_telephone
         FROM sessions s
         JOIN utilisateurs u ON u.id = s.utilisateur_id
         JOIN organisations o ON o.id = u.organisation_id
         WHERE s.id = ?`,
        [empreinte(jeton)]
      );
      if (s && s.actif && new Date(s.expire_le) > new Date()) {
        req.sessionId = s.session_id;
        req.utilisateur = { id: s.id, nom: s.nom, fonction: s.fonction, email: s.email, role: s.role };
        req.organisation = { id: s.org_id, nom: s.org_nom, type: s.org_type, pays: s.org_pays, ville: s.org_ville, devise: s.org_devise, telephone: s.org_telephone };
      }
    }
    next();
  } catch (erreur) {
    next(erreur);
  }
}

module.exports = { creerSession, detruireSession, chargerSession };