// routes/compte.js : tableau de bord d'accueil, paramètres et équipe
const express = require("express");
const db = require("../lib/db");
const sec = require("../lib/securite");
const { envoyer, alerteMotDePasse, urlApp } = require("../lib/email");
const { creerJeton } = require("../lib/jetons");
const { pageApp, esc, note, champMotDePasse, optionsPays, optionsListe } = require("../lib/pages");
const { TYPES_ORGANISATION, ROLES, DESCRIPTION_ROLES, DEVISES, infosPays } = require("../lib/reference");

const router = express.Router();
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const JOUR = 24 * 3600 * 1000;
const dateFr = (d) => (d ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const exigerConnexion = (req, res, next) => (req.utilisateur ? next() : res.redirect("/connexion"));
const exigerAdmin = (req, res, next) => {
  if (!req.utilisateur) return res.redirect("/connexion");
  if (req.utilisateur.role !== "administrateur") {
    return res.status(403).send(pageApp("Accès refusé", req, `<h1>Accès refusé</h1><p class="sous-titre">Cette page est réservée aux administrateurs de votre organisation.</p>`));
  }
  next();
};

// ---------- Tableau de bord (accueil) ----------
router.get("/", exigerConnexion, (req, res) => {
  const u = req.utilisateur;
  const o = req.organisation;
  const equipe = u.role === "administrateur" ? '<a class="lien" href="/equipe">Invitez votre équipe</a> : agents de terrain, responsables, partenaires.' : "Votre administrateur peut inviter d'autres membres de l'équipe.";
  res.send(pageApp("Tableau de bord", req, `<h1>Bonjour, ${esc(u.nom)}</h1>
    <p class="sous-titre">${esc(o.nom)} · ${esc(o.ville)}, ${esc(o.pays)}</p>
    ${req.query.bienvenue ? note("vert", "Votre adresse e-mail est confirmée. Bienvenue sur VoixBilan.") : ""}
        <div class="bloc"><h2>Pour bien démarrer</h2><ol class="etapes">
      <li><a class="lien" href="/groupes">Créez vos groupes</a>, par marché ou par projet.</li>
      <li><a class="lien" href="/commercantes/ajouter">Ajoutez vos commerçantes</a> : chacune reçoit un code d'activation à 6 chiffres.</li>
      <li>Chaque commerçante envoie son code au numéro WhatsApp de VoixBilan, puis ses vocaux chaque jour.</li>
      <li>${equipe}</li>
        </ol><p class="petit" style="margin:12px 0 0">Les chiffres de toutes vos commerçantes, le graphique et les alertes arrivent dans la prochaine mise à jour.</p></div>`, "accueil"));
});

// ---------- Paramètres ----------
const OK_PARAM = { organisation: "Les informations de l'organisation ont été enregistrées.", profil: "Votre profil a été enregistré.", motdepasse: "Votre mot de passe a été modifié." };
const ERR_PARAM = {
  champs: "Merci de remplir tous les champs obligatoires.",
  actuel: "Le mot de passe actuel est incorrect.",
  regle: "Le nouveau mot de passe doit contenir au moins 8 caractères, avec au moins une lettre et un chiffre.",
  confirmation: "Les deux mots de passe ne sont pas identiques.",
};

router.get("/parametres", exigerConnexion, (req, res) => {
  const o = req.organisation;
  const u = req.utilisateur;
  const admin = u.role === "administrateur";
  const messages = (OK_PARAM[req.query.ok] ? note("vert", OK_PARAM[req.query.ok]) : "") + (ERR_PARAM[req.query.erreur] ? note("rouge", ERR_PARAM[req.query.erreur]) : "");

  const blocOrganisation = admin
    ? `<form class="formulaire" method="post" action="/parametres/organisation" style="max-width:620px">
        <div><label for="nom-org">Nom de l'organisation</label><input id="nom-org" name="nom" required maxlength="150" value="${esc(o.nom)}"></div>
        <div><label for="type">Type d'organisation</label><select id="type" name="type" required>${optionsListe(TYPES_ORGANISATION, o.type)}</select></div>
        <div class="deux">
          <div><label for="pays">Pays</label><select id="pays" name="pays" required>${optionsPays(o.pays)}</select></div>
          <div><label for="ville">Ville</label><input id="ville" name="ville" required maxlength="100" value="${esc(o.ville)}"></div>
        </div>
        <div class="deux">
          <div><label for="devise">Monnaie</label><select id="devise" name="devise">${optionsListe(DEVISES, o.devise)}</select></div>
          <div><label for="tel-org">Téléphone</label><input id="tel-org" name="telephone" maxlength="30" value="${esc(o.telephone)}"></div>
        </div>
        <div><button type="submit">Enregistrer</button></div>
      </form>`
    : `<table><tr><th>Nom</th><td>${esc(o.nom)}</td></tr><tr><th>Type</th><td>${esc(o.type)}</td></tr><tr><th>Pays</th><td>${esc(o.pays)}</td></tr><tr><th>Ville</th><td>${esc(o.ville)}</td></tr><tr><th>Monnaie</th><td>${esc(o.devise)}</td></tr></table>
       <p class="petit">Seuls les administrateurs peuvent modifier ces informations.</p>`;

  res.send(pageApp("Paramètres", req, `<h1>Paramètres</h1><p class="sous-titre">Votre organisation et votre compte</p>${messages}
    <div class="bloc"><h2>Organisation</h2>${blocOrganisation}</div>
    <div class="bloc"><h2>Mon profil</h2>
      <form class="formulaire" method="post" action="/parametres/profil" style="max-width:620px">
        <div class="deux">
          <div><label for="nom">Nom et prénom</label><input id="nom" name="nom" required maxlength="150" value="${esc(u.nom)}"></div>
          <div><label for="fonction">Fonction</label><input id="fonction" name="fonction" maxlength="100" value="${esc(u.fonction)}"></div>
        </div>
        <div><label>E-mail</label><input value="${esc(u.email)}" disabled></div>
        <div><button type="submit">Enregistrer</button></div>
      </form></div>
    <div class="bloc"><h2>Mot de passe</h2>
      <form class="formulaire" method="post" action="/parametres/mot-de-passe" style="max-width:420px">
        ${champMotDePasse("actuel", "Mot de passe actuel")}
        ${champMotDePasse("motdepasse", "Nouveau mot de passe", { autocomplete: "new-password", aide: "Au moins 8 caractères, avec au moins une lettre et un chiffre." })}
        ${champMotDePasse("confirmation", "Confirmer le nouveau mot de passe", { autocomplete: "new-password" })}
        <div><button type="submit">Changer le mot de passe</button></div>
      </form></div>`, "parametres"));
});

router.post("/parametres/organisation", exigerAdmin, a(async (req, res) => {
  const v = req.body;
  const pays = infosPays(v.pays);
  if (!sec.texte(v.nom) || !TYPES_ORGANISATION.includes(v.type) || !sec.texte(v.ville)) return res.redirect("/parametres?erreur=champs");
  const devise = DEVISES.includes(v.devise) ? v.devise : pays.devise;
  await db.requete("UPDATE organisations SET nom = ?, type = ?, pays = ?, ville = ?, devise = ?, telephone = ? WHERE id = ?",
    [sec.texte(v.nom), v.type, pays.nom, sec.texte(v.ville, 100), devise, sec.texte(v.telephone, 30) || null, req.organisation.id]);
  res.redirect("/parametres?ok=organisation");
}));

router.post("/parametres/profil", exigerConnexion, a(async (req, res) => {
  if (!sec.texte(req.body.nom)) return res.redirect("/parametres?erreur=champs");
  await db.requete("UPDATE utilisateurs SET nom = ?, fonction = ? WHERE id = ?", [sec.texte(req.body.nom), sec.texte(req.body.fonction, 100) || null, req.utilisateur.id]);
  res.redirect("/parametres?ok=profil");
}));

router.post("/parametres/mot-de-passe", exigerConnexion, a(async (req, res) => {
  const u = await db.une("SELECT id, nom, email, mot_de_passe FROM utilisateurs WHERE id = ?", [req.utilisateur.id]);
  if (!sec.verifierMotDePasse(req.body.actuel, u.mot_de_passe)) return res.redirect("/parametres?erreur=actuel");
  if (!sec.motDePasseValide(req.body.motdepasse)) return res.redirect("/parametres?erreur=regle");
  if (req.body.motdepasse !== req.body.confirmation) return res.redirect("/parametres?erreur=confirmation");
  await db.requete("UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?", [sec.chiffrerMotDePasse(req.body.motdepasse), u.id]);
  await db.requete("DELETE FROM sessions WHERE utilisateur_id = ? AND id <> ?", [u.id, req.sessionId]);
  await alerteMotDePasse(u);
  res.redirect("/parametres?ok=motdepasse");
}));

// ---------- Équipe (administrateurs) ----------
const OK_EQUIPE = { invitation: "L'invitation a été envoyée.", role: "Le rôle a été modifié.", statut: "Le statut a été modifié.", annulation: "L'invitation a été annulée." };
const ERR_EQUIPE = { invitation: "Vérifiez l'adresse e-mail et le rôle.", existe: "Cette personne a déjà un compte VoixBilan." };

router.get("/equipe", exigerAdmin, a(async (req, res) => {
  const membres = await db.requete("SELECT id, nom, fonction, email, role, actif, email_verifie, derniere_connexion FROM utilisateurs WHERE organisation_id = ? ORDER BY date_creation", [req.organisation.id]);
  const invitations = await db.requete(
    "SELECT id, email, role, date_creation, expire_le FROM jetons WHERE type = 'invitation' AND organisation_id = ? AND utilise_le IS NULL AND expire_le > ? ORDER BY date_creation DESC",
    [req.organisation.id, new Date()]
  );
  const messages = (OK_EQUIPE[req.query.ok] ? note("vert", OK_EQUIPE[req.query.ok]) : "") + (ERR_EQUIPE[req.query.erreur] ? note("rouge", ERR_EQUIPE[req.query.erreur]) : "");
  const optionsRoles = (choisi) => Object.entries(ROLES).map(([cle, libelle]) => `<option value="${cle}" ${cle === choisi ? "selected" : ""}>${libelle}</option>`).join("");

  const lignes = membres.map((m) => {
    const soi = m.id === req.utilisateur.id;
    const role = soi
      ? `${esc(ROLES[m.role])} <span class="petit">(vous)</span>`
      : `<form method="post" action="/equipe/role" class="en-ligne"><input type="hidden" name="id" value="${m.id}"><select name="role">${optionsRoles(m.role)}</select><button type="submit" class="secondaire petit-bouton">Modifier</button></form>`;
    const statut = !m.actif ? '<span class="statut rouge">Désactivé</span>' : !m.email_verifie ? '<span class="statut orange">E-mail non confirmé</span>' : '<span class="statut vert">Actif</span>';
    const action = soi ? "" : `<form method="post" action="/equipe/statut" class="en-ligne"><input type="hidden" name="id" value="${m.id}"><button type="submit" class="secondaire petit-bouton">${m.actif ? "Désactiver" : "Réactiver"}</button></form>`;
    return `<tr><td>${esc(m.nom)}<div class="petit">${esc(m.fonction || "")}</div></td><td>${esc(m.email)}</td><td>${role}</td><td>${statut}</td><td class="petit">${dateFr(m.derniere_connexion)}</td><td>${action}</td></tr>`;
  }).join("");

  const lignesInvitations = invitations.map((i) => `<tr><td>${esc(i.email)}</td><td>${esc(ROLES[i.role])}</td><td class="petit">${dateFr(i.date_creation)}</td><td class="petit">${dateFr(i.expire_le)}</td>
    <td><form method="post" action="/equipe/annuler-invitation" class="en-ligne"><input type="hidden" name="id" value="${i.id}"><button type="submit" class="secondaire petit-bouton">Annuler</button></form></td></tr>`).join("");

  res.send(pageApp("Équipe", req, `<h1>Équipe</h1><p class="sous-titre">Les personnes qui ont accès à l'espace de ${esc(req.organisation.nom)}</p>${messages}
    <div class="bloc"><h2>Membres</h2><table><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th><th></th></tr>${lignes}</table></div>
    <div class="bloc"><h2>Inviter un membre</h2>
      <form class="formulaire" method="post" action="/equipe/inviter" style="max-width:620px">
        <div class="deux">
          <div><label for="email">E-mail</label><input id="email" type="email" name="email" required></div>
          <div><label for="role">Rôle</label><select id="role" name="role">${optionsRoles("agent")}</select></div>
        </div>
        <div class="petit">${Object.entries(DESCRIPTION_ROLES).map(([cle, texte]) => `<strong>${ROLES[cle]}</strong> : ${texte}`).join("<br>")}</div>
        <div><button type="submit">Envoyer l'invitation</button></div>
      </form></div>
    ${lignesInvitations ? `<div class="bloc"><h2>Invitations en attente</h2><table><tr><th>E-mail</th><th>Rôle</th><th>Envoyée le</th><th>Valable jusqu'au</th><th></th></tr>${lignesInvitations}</table></div>` : ""}`, "equipe"));
}));

router.post("/equipe/inviter", exigerAdmin, a(async (req, res) => {
  const email = sec.normEmail(req.body.email);
  const role = ROLES[req.body.role] ? req.body.role : null;
  if (!sec.emailValide(email) || !role) return res.redirect("/equipe?erreur=invitation");
  if (await db.une("SELECT id FROM utilisateurs WHERE email = ?", [email])) return res.redirect("/equipe?erreur=existe");
  // Une nouvelle invitation remplace l'ancienne pour le même e-mail
  await db.requete("UPDATE jetons SET utilise_le = ? WHERE type = 'invitation' AND organisation_id = ? AND email = ? AND utilise_le IS NULL", [new Date(), req.organisation.id, email]);
  const jeton = await creerJeton("invitation", { organisationId: req.organisation.id, email, role, invitePar: req.utilisateur.id }, 7 * JOUR);
  await envoyer({
    a: email,
    sujet: `Invitation à rejoindre ${req.organisation.nom} sur VoixBilan`,
    titre: "Vous êtes invité(e) à rejoindre une équipe",
    paragraphes: [
      "Bonjour,",
      `${req.utilisateur.nom} vous invite à rejoindre l'espace de ${req.organisation.nom} sur VoixBilan, en tant que ${ROLES[role]}.`,
      "VoixBilan permet de suivre les ventes, les dépenses et les crédits des commerçantes accompagnées par votre organisation.",
    ],
    bouton: { texte: "Rejoindre l'équipe", lien: `${urlApp()}/invitation?jeton=${jeton}` },
    note: "Cette invitation est valable 7 jours.",
  });
  res.redirect("/equipe?ok=invitation");
}));

router.post("/equipe/role", exigerAdmin, a(async (req, res) => {
  const id = Number(req.body.id);
  if (id && id !== req.utilisateur.id && ROLES[req.body.role]) {
    await db.requete("UPDATE utilisateurs SET role = ? WHERE id = ? AND organisation_id = ?", [req.body.role, id, req.organisation.id]);
  }
  res.redirect("/equipe?ok=role");
}));

router.post("/equipe/statut", exigerAdmin, a(async (req, res) => {
  const id = Number(req.body.id);
  const m = await db.une("SELECT id, actif FROM utilisateurs WHERE id = ? AND organisation_id = ?", [id, req.organisation.id]);
  if (m && m.id !== req.utilisateur.id) {
    await db.requete("UPDATE utilisateurs SET actif = ? WHERE id = ?", [m.actif ? 0 : 1, m.id]);
    if (m.actif) await db.requete("DELETE FROM sessions WHERE utilisateur_id = ?", [m.id]);
  }
  res.redirect("/equipe?ok=statut");
}));

router.post("/equipe/annuler-invitation", exigerAdmin, a(async (req, res) => {
  await db.requete("UPDATE jetons SET utilise_le = ? WHERE id = ? AND type = 'invitation' AND organisation_id = ?", [new Date(), Number(req.body.id), req.organisation.id]);
  res.redirect("/equipe?ok=annulation");
}));

module.exports = router;