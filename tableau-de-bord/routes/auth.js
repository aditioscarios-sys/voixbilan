// routes/auth.js : inscription, confirmation, connexion, mot de passe oublié, invitations
const express = require("express");
const db = require("../lib/db");
const sec = require("../lib/securite");
const { envoyer, alerteMotDePasse, urlApp } = require("../lib/email");
const { creerJeton, lireJeton, utiliserJeton } = require("../lib/jetons");
const { creerSession, detruireSession } = require("../lib/session");
const { pageAuth, esc, note, champMotDePasse, optionsPays, optionsListe } = require("../lib/pages");
const { TYPES_ORGANISATION, ROLES, infosPays } = require("../lib/reference");

const router = express.Router();
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const HEURE = 3600 * 1000;
const REGLE_MDP = "Au moins 8 caractères, avec au moins une lettre et un chiffre.";
const ERREUR_REGLE = "Le mot de passe doit contenir au moins 8 caractères, avec au moins une lettre et un chiffre.";

const caseConditions = `<label class="case"><input type="checkbox" name="accepte" required><span>J'accepte les <a class="lien" href="/conditions" target="_blank">conditions d'utilisation</a> et la <a class="lien" href="/confidentialite" target="_blank">politique de confidentialité</a>.</span></label>`;

function pageLienInvalide(texte, lien = "/connexion", libelle = "Retour à la connexion") {
  return pageAuth("Lien non valable", `<h1>Lien non valable</h1><p class="sous-titre">${esc(texte)}</p><a class="bouton" href="${lien}">${esc(libelle)}</a>`);
}

function formaterTelephone(indicatif, numero) {
  const n = String(numero || "").replace(/[^\d+]/g, "");
  if (!n) return null;
  if (n.startsWith("+")) return n;
  return indicatif ? `+${indicatif} ${n}` : n;
}

async function envoyerVerification(utilisateurId, email, nom) {
  const jeton = await creerJeton("verification", { utilisateurId }, 24 * HEURE);
  await envoyer({
    a: email,
    sujet: "Confirmez votre adresse e-mail",
    titre: "Confirmez votre adresse e-mail",
    paragraphes: [`Bonjour ${nom},`, "Merci d'avoir créé le compte de votre organisation sur VoixBilan. Pour activer votre compte, confirmez votre adresse e-mail."],
    bouton: { texte: "Confirmer mon adresse", lien: `${urlApp()}/verifier?jeton=${jeton}` },
    note: "Ce lien est valable 24 heures. Si vous n'êtes pas à l'origine de cette inscription, ignorez cet e-mail.",
  });
}

// ---------- Inscription (2 étapes) ----------
function pageInscription(erreur = "", v = {}, etape = 1) {
  const premiere = etape === 1;
  return pageAuth("Créer un compte", `<h1>Créer le compte de votre organisation</h1>
    <p class="sous-titre">Vous pourrez inviter votre équipe ensuite.</p>
    ${erreur ? note("rouge", esc(erreur)) : ""}
    <form class="formulaire" method="post" action="/inscription">
      <fieldset class="etape"${premiere ? "" : " hidden"}>
        <p class="progression">Étape 1 sur 2 · Votre organisation</p>
        <div><label for="nom_organisation">Nom de l'organisation</label><input id="nom_organisation" name="nom_organisation" required maxlength="150" value="${esc(v.nom_organisation)}"></div>
        <div><label for="type">Type d'organisation</label><select id="type" name="type" required><option value="">Choisir</option>${optionsListe(TYPES_ORGANISATION, v.type)}</select></div>
        <div class="deux">
          <div><label for="pays">Pays</label><select id="pays" name="pays" required>${optionsPays(v.pays || "Bénin")}</select></div>
          <div><label for="ville">Ville</label><input id="ville" name="ville" required maxlength="100" value="${esc(v.ville)}"></div>
        </div>
        <div class="boutons"><a class="lien petit" href="/connexion">J'ai déjà un compte</a><button type="button" data-etape-suivante>Continuer</button></div>
      </fieldset>
      <fieldset class="etape"${premiere ? " hidden" : ""}>
        <p class="progression">Étape 2 sur 2 · Responsable du compte</p>
        <div class="deux">
          <div><label for="responsable">Nom et prénom</label><input id="responsable" name="responsable" required maxlength="150" autocomplete="name" value="${esc(v.responsable)}"></div>
          <div><label for="fonction">Fonction</label><input id="fonction" name="fonction" maxlength="100" placeholder="Exemple : chargée de suivi" value="${esc(v.fonction)}"></div>
        </div>
        <div class="deux">
          <div><label for="email">E-mail professionnel</label><input id="email" type="email" name="email" required autocomplete="email" value="${esc(v.email)}"></div>
          <div><label for="telephone">Téléphone</label><div class="telephone"><span id="indicatif">+229</span><input id="telephone" name="telephone" inputmode="tel" autocomplete="tel-national" placeholder="Sans l'indicatif" value="${esc(v.telephone)}"></div></div>
        </div>
        <div>
          <div class="deux">
            ${champMotDePasse("motdepasse", "Mot de passe", { autocomplete: "new-password" })}
            ${champMotDePasse("confirmation", "Confirmer le mot de passe", { autocomplete: "new-password" })}
          </div>
          <div class="petit" style="margin-top:6px">${REGLE_MDP}</div>
        </div>
        ${caseConditions}
        <div class="boutons"><button type="button" class="secondaire" data-etape-precedente>Retour</button><button type="submit">Créer le compte</button></div>
      </fieldset>
    </form>`, true);
}

router.get("/inscription", (req, res) => {
  if (req.utilisateur) return res.redirect("/");
  res.send(pageInscription());
});

router.post("/inscription", a(async (req, res) => {
  const v = req.body;
  const email = sec.normEmail(v.email);
  const pays = infosPays(v.pays);
  const erreur =
    !sec.texte(v.nom_organisation) ? "Indiquez le nom de l'organisation." :
    !TYPES_ORGANISATION.includes(v.type) ? "Choisissez le type d'organisation." :
    !sec.texte(v.ville) ? "Indiquez la ville." :
    !sec.texte(v.responsable) ? "Indiquez le nom du responsable." :
    !sec.emailValide(email) ? "L'adresse e-mail n'est pas valide." :
    !sec.motDePasseValide(v.motdepasse) ? ERREUR_REGLE :
    v.motdepasse !== v.confirmation ? "Les deux mots de passe ne sont pas identiques." :
    !v.accepte ? "Vous devez accepter les conditions d'utilisation et la politique de confidentialité." : "";
  // En cas d'erreur, on rouvre l'étape concernée
  const etapeErreur = !sec.texte(v.nom_organisation) || !TYPES_ORGANISATION.includes(v.type) || !sec.texte(v.ville) ? 1 : 2;
  if (erreur) return res.send(pageInscription(erreur, v, etapeErreur));
  if (await db.une("SELECT id FROM utilisateurs WHERE email = ?", [email])) {
    return res.send(pageInscription("Un compte existe déjà avec cette adresse e-mail. Vous pouvez vous connecter.", v, 2));
  }

  const responsable = sec.majuscule(v.responsable);
  const maintenant = new Date();
  const utilisateurId = await db.transaction(async (c) => {
    const [o] = await c.execute(
      "INSERT INTO organisations (nom, type, pays, ville, devise, telephone, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [sec.majuscule(v.nom_organisation), v.type, pays.nom, sec.majuscule(v.ville, 100), pays.devise, formaterTelephone(pays.indicatif, v.telephone), maintenant]
    );
    const [u] = await c.execute(
      "INSERT INTO utilisateurs (organisation_id, nom, fonction, email, mot_de_passe, role, email_verifie, actif, date_creation) VALUES (?, ?, ?, ?, ?, 'administrateur', 0, 1, ?)",
      [o.insertId, responsable, sec.majuscule(v.fonction, 100) || null, email, sec.chiffrerMotDePasse(v.motdepasse), maintenant]
    );
    return u.insertId;
  });

  await envoyerVerification(utilisateurId, email, responsable);
  res.redirect("/verification-envoyee?email=" + encodeURIComponent(email));
}));

// ---------- Confirmation de l'e-mail ----------
router.get("/verification-envoyee", (req, res) => {
  const email = sec.normEmail(req.query.email);
  res.send(pageAuth("Vérifiez votre e-mail", `<h1>Vérifiez votre boîte e-mail</h1>
    <p class="sous-titre">Nous avons envoyé un lien de confirmation à <strong>${esc(email)}</strong>. Cliquez sur ce lien pour activer votre compte.</p>
    ${req.query.renvoye ? note("vert", "Un nouvel e-mail vient d'être envoyé.") : ""}
    <p class="petit">Vous ne trouvez pas l'e-mail ? Pensez à regarder dans les courriers indésirables.</p>
    <form method="post" action="/renvoyer-verification" style="margin:16px 0"><input type="hidden" name="email" value="${esc(email)}"><button type="submit" class="secondaire">Renvoyer l'e-mail</button></form>
    <p class="petit centre"><a class="lien" href="/connexion">Retour à la connexion</a></p>`));
});

router.post("/renvoyer-verification", a(async (req, res) => {
  const email = sec.normEmail(req.body.email);
  const u = await db.une("SELECT id, nom, email_verifie FROM utilisateurs WHERE email = ?", [email]);
  if (u && !u.email_verifie) await envoyerVerification(u.id, email, u.nom);
  res.redirect("/verification-envoyee?renvoye=1&email=" + encodeURIComponent(email));
}));

router.get("/verifier", a(async (req, res) => {
  const j = await lireJeton("verification", req.query.jeton);
  if (!j) return res.send(pageLienInvalide("Ce lien de confirmation n'est plus valable. Connectez-vous pour en recevoir un nouveau."));
  await db.requete("UPDATE utilisateurs SET email_verifie = 1 WHERE id = ?", [j.utilisateur_id]);
  await utiliserJeton(j.id);
  const u = await db.une("SELECT u.nom, u.email, o.nom AS org FROM utilisateurs u JOIN organisations o ON o.id = u.organisation_id WHERE u.id = ?", [j.utilisateur_id]);
  await envoyer({
    a: u.email,
    sujet: "Bienvenue sur VoixBilan",
    titre: "Bienvenue sur VoixBilan",
    paragraphes: [
      `Bonjour ${u.nom},`,
      `Le compte de ${u.org} est maintenant actif. Voici comment démarrer :`,
      "1. Créez vos groupes, par marché ou par projet.",
      "2. Ajoutez vos commerçantes : chacune reçoit un code d'activation à 6 chiffres.",
      "3. Chaque commerçante envoie son code au numéro WhatsApp de VoixBilan, puis ses vocaux chaque jour. Vous suivez ses chiffres dans votre tableau de bord.",
      "Vous pouvez aussi inviter vos collègues depuis le menu Équipe.",
    ],
    bouton: { texte: "Ouvrir mon tableau de bord", lien: urlApp() },
  });
  await creerSession(res, j.utilisateur_id);
  res.redirect("/?bienvenue=1");
}));

// ---------- Connexion ----------
const MESSAGES = { reinit: "Votre mot de passe a été modifié. Vous pouvez vous connecter.", deconnecte: "Vous êtes déconnecté." };

function pageConnexion({ erreur = "", message = "", email = "", nonVerifie = false, bloque = false } = {}) {
  const lienReinit = bloque ? ` Vous avez oublié votre mot de passe ? <a href="/mot-de-passe-oublie">Réinitialisez-le</a>.` : "";
  return pageAuth("Connexion", `<h1>Connexion</h1><p class="sous-titre">Espace des organisations</p>
    ${message ? note("vert", esc(message)) : ""}${erreur ? note("rouge", esc(erreur) + lienReinit) : ""}
    ${nonVerifie ? `<form method="post" action="/renvoyer-verification" style="margin-bottom:16px"><input type="hidden" name="email" value="${esc(email)}"><button type="submit" class="secondaire">Renvoyer l'e-mail de confirmation</button></form>` : ""}
    <form class="formulaire" method="post" action="/connexion">
      <div><label for="email">E-mail</label><input id="email" type="email" name="email" required autocomplete="email" value="${esc(email)}"></div>
      ${champMotDePasse("motdepasse", "Mot de passe")}
      <div class="droite"><a class="lien" href="/mot-de-passe-oublie">Mot de passe oublié ?</a></div>
      <div><button type="submit">Se connecter</button></div>
      <p class="petit centre" style="margin:0">Pas encore de compte ? <a class="lien" href="/inscription">Créer un compte</a></p>
    </form>`);
}

router.get("/connexion", (req, res) => {
  if (req.utilisateur) return res.redirect("/");
  res.send(pageConnexion({ message: MESSAGES[req.query.message] || "" }));
});

router.post("/connexion", a(async (req, res) => {
  const email = sec.normEmail(req.body.email);
  const depuis = new Date(Date.now() - 15 * 60 * 1000);
  const echecs = await db.une("SELECT COUNT(*) AS n FROM tentatives_connexion WHERE email = ? AND reussie = 0 AND date_tentative > ?", [email, depuis]);
  if (Number(echecs.n) >= 5) return res.send(pageConnexion({ erreur: "Trop de tentatives. Pour votre sécurité, réessayez dans 15 minutes.", email, bloque: true }));

  const u = await db.une("SELECT * FROM utilisateurs WHERE email = ?", [email]);
  const correct = !!u && sec.verifierMotDePasse(req.body.motdepasse, u.mot_de_passe);
  await db.requete("INSERT INTO tentatives_connexion (email, ip, reussie, date_tentative) VALUES (?, ?, ?, ?)", [email, req.ip, correct ? 1 : 0, new Date()]);

  if (!correct) return res.send(pageConnexion({ erreur: "E-mail ou mot de passe incorrect.", email }));
  if (!u.actif) return res.send(pageConnexion({ erreur: "Ce compte a été désactivé par l'administrateur de votre organisation.", email }));
  if (!u.email_verifie) return res.send(pageConnexion({ erreur: "Votre adresse e-mail n'est pas encore confirmée. Cliquez sur le lien reçu par e-mail.", email, nonVerifie: true }));

  await creerSession(res, u.id);
  res.redirect("/");
}));

router.get("/deconnexion", a(async (req, res) => {
  await detruireSession(req, res);
  res.redirect("/connexion?message=deconnecte");
}));

// ---------- Mot de passe oublié ----------
router.get("/mot-de-passe-oublie", (req, res) => {
  res.send(pageAuth("Mot de passe oublié", `<h1>Mot de passe oublié</h1>
    <p class="sous-titre">Indiquez l'adresse e-mail de votre compte. Nous vous enverrons un lien pour choisir un nouveau mot de passe.</p>
    <form class="formulaire" method="post" action="/mot-de-passe-oublie">
      <div><label for="email">E-mail</label><input id="email" type="email" name="email" required autocomplete="email"></div>
      <div><button type="submit">Envoyer le lien</button></div>
      <p class="petit centre" style="margin:0"><a class="lien" href="/connexion">Retour à la connexion</a></p>
    </form>`));
});

router.post("/mot-de-passe-oublie", a(async (req, res) => {
  const email = sec.normEmail(req.body.email);
  const u = await db.une("SELECT id, nom, actif FROM utilisateurs WHERE email = ?", [email]);
  if (u && u.actif) {
    const jeton = await creerJeton("reinitialisation", { utilisateurId: u.id }, HEURE);
    await envoyer({
      a: email,
      sujet: "Réinitialisation de votre mot de passe",
      titre: "Choisissez un nouveau mot de passe",
      paragraphes: [`Bonjour ${u.nom},`, "Vous avez demandé à réinitialiser le mot de passe de votre compte VoixBilan."],
      bouton: { texte: "Choisir un nouveau mot de passe", lien: `${urlApp()}/reinitialiser?jeton=${jeton}` },
      note: "Ce lien est valable 1 heure. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : votre mot de passe ne changera pas.",
    });
  }
  res.send(pageAuth("Vérifiez votre e-mail", `<h1>Vérifiez votre boîte e-mail</h1>
    <p class="sous-titre">Si un compte existe avec l'adresse <strong>${esc(email)}</strong>, vous allez recevoir un lien pour choisir un nouveau mot de passe. Ce lien est valable 1 heure.</p>
    <p class="petit centre" style="margin:0"><a class="lien" href="/connexion">Retour à la connexion</a></p>`));
}));

function pageReinit(jeton, erreur = "") {
  return pageAuth("Nouveau mot de passe", `<h1>Choisir un nouveau mot de passe</h1><p class="sous-titre">Choisissez un mot de passe que vous n'utilisez pas ailleurs.</p>${erreur ? note("rouge", esc(erreur)) : ""}
    <form class="formulaire" method="post" action="/reinitialiser"><input type="hidden" name="jeton" value="${esc(jeton)}">
      ${champMotDePasse("motdepasse", "Nouveau mot de passe", { autocomplete: "new-password", aide: REGLE_MDP })}
      ${champMotDePasse("confirmation", "Confirmer le mot de passe", { autocomplete: "new-password" })}
      <div><button type="submit">Enregistrer</button></div>
    </form>`);
}
const LIEN_REINIT_INVALIDE = () => pageLienInvalide("Ce lien n'est plus valable. Faites une nouvelle demande.", "/mot-de-passe-oublie", "Nouvelle demande");

router.get("/reinitialiser", a(async (req, res) => {
  if (!(await lireJeton("reinitialisation", req.query.jeton))) return res.send(LIEN_REINIT_INVALIDE());
  res.send(pageReinit(req.query.jeton));
}));

router.post("/reinitialiser", a(async (req, res) => {
  const j = await lireJeton("reinitialisation", req.body.jeton);
  if (!j) return res.send(LIEN_REINIT_INVALIDE());
  if (!sec.motDePasseValide(req.body.motdepasse)) return res.send(pageReinit(req.body.jeton, ERREUR_REGLE));
  if (req.body.motdepasse !== req.body.confirmation) return res.send(pageReinit(req.body.jeton, "Les deux mots de passe ne sont pas identiques."));
  await db.requete("UPDATE utilisateurs SET mot_de_passe = ?, email_verifie = 1 WHERE id = ?", [sec.chiffrerMotDePasse(req.body.motdepasse), j.utilisateur_id]);
  await utiliserJeton(j.id);
  await db.requete("DELETE FROM sessions WHERE utilisateur_id = ?", [j.utilisateur_id]);
  await alerteMotDePasse(await db.une("SELECT nom, email FROM utilisateurs WHERE id = ?", [j.utilisateur_id]));
  res.redirect("/connexion?message=reinit");
}));

// ---------- Rejoindre une équipe (lien d'invitation) ----------
async function lireInvitation(jeton) {
  const j = await lireJeton("invitation", jeton);
  if (!j) return null;
  const o = await db.une("SELECT nom FROM organisations WHERE id = ?", [j.organisation_id]);
  return o ? { ...j, org_nom: o.nom } : null;
}

function pageInvitation(jeton, inv, erreur = "", v = {}) {
  return pageAuth("Rejoindre l'équipe", `<h1>Rejoindre ${esc(inv.org_nom)}</h1>
    <p class="sous-titre">Vous êtes invité(e) en tant que <strong>${esc(ROLES[inv.role])}</strong>. Complétez vos informations pour activer votre accès.</p>
    ${erreur ? note("rouge", esc(erreur)) : ""}
    <form class="formulaire" method="post" action="/invitation"><input type="hidden" name="jeton" value="${esc(jeton)}">
      <div><label>E-mail</label><input value="${esc(inv.email)}" disabled></div>
      <div class="deux">
        <div><label for="nom">Nom et prénom</label><input id="nom" name="nom" required maxlength="150" value="${esc(v.nom)}"></div>
        <div><label for="fonction">Fonction</label><input id="fonction" name="fonction" maxlength="100" value="${esc(v.fonction)}"></div>
      </div>
      <div>
        <div class="deux">
          ${champMotDePasse("motdepasse", "Mot de passe", { autocomplete: "new-password" })}
          ${champMotDePasse("confirmation", "Confirmer le mot de passe", { autocomplete: "new-password" })}
        </div>
        <div class="petit" style="margin-top:6px">${REGLE_MDP}</div>
      </div>
      ${caseConditions}
      <div><button type="submit">Rejoindre l'équipe</button></div>
    </form>`, true);
}
const INVITATION_INVALIDE = () => pageLienInvalide("Cette invitation n'est plus valable. Demandez à l'administrateur de votre organisation de vous en envoyer une nouvelle.");

router.get("/invitation", a(async (req, res) => {
  const inv = await lireInvitation(req.query.jeton);
  if (!inv) return res.send(INVITATION_INVALIDE());
  res.send(pageInvitation(req.query.jeton, inv));
}));

router.post("/invitation", a(async (req, res) => {
  const v = req.body;
  const inv = await lireInvitation(v.jeton);
  if (!inv) return res.send(INVITATION_INVALIDE());
  const erreur =
    !sec.texte(v.nom) ? "Indiquez votre nom." :
    !sec.motDePasseValide(v.motdepasse) ? ERREUR_REGLE :
    v.motdepasse !== v.confirmation ? "Les deux mots de passe ne sont pas identiques." :
    !v.accepte ? "Vous devez accepter les conditions d'utilisation et la politique de confidentialité." : "";
  if (erreur) return res.send(pageInvitation(v.jeton, inv, erreur, v));
  if (await db.une("SELECT id FROM utilisateurs WHERE email = ?", [inv.email])) {
    return res.send(pageInvitation(v.jeton, inv, "Un compte existe déjà avec cette adresse e-mail.", v));
  }
  const r = await db.requete(
    "INSERT INTO utilisateurs (organisation_id, nom, fonction, email, mot_de_passe, role, email_verifie, actif, date_creation) VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)",
    [inv.organisation_id, sec.majuscule(v.nom), sec.majuscule(v.fonction, 100) || null, inv.email, sec.chiffrerMotDePasse(v.motdepasse), inv.role, new Date()]
  );
  await utiliserJeton(inv.id);
  await creerSession(res, r.insertId);
  res.redirect("/");
}));

// ---------- Pages légales (version provisoire) ----------
router.get("/conditions", (req, res) => {
  res.send(pageAuth("Conditions d'utilisation", `<h1>Conditions d'utilisation</h1><p class="sous-titre">Version provisoire, à faire valider par un juriste.</p><div class="texte-legal">
    <p>VoixBilan est un service qui permet aux organisations d'accompagner des commerçantes : ces dernières enregistrent leurs ventes, dépenses et crédits par messages WhatsApp, et l'organisation consulte leurs chiffres dans un tableau de bord.</p>
    <p>L'organisation s'engage à n'inscrire que des commerçantes qui ont donné leur accord, à garder ses identifiants confidentiels et à utiliser les données uniquement pour accompagner ces commerçantes.</p>
    <p>Les chiffres sont calculés à partir des messages des commerçantes, compris par une intelligence artificielle. Ils peuvent contenir des erreurs et doivent être vérifiés avant toute décision importante.</p>
    <p>VoixBilan est en phase pilote. Le service peut évoluer ou être interrompu.</p></div>
    <p style="margin:0"><a class="lien" href="/inscription">Retour</a></p>`, true));
});

router.get("/confidentialite", (req, res) => {
  res.send(pageAuth("Politique de confidentialité", `<h1>Politique de confidentialité</h1><p class="sous-titre">Version provisoire, à faire valider par un juriste.</p><div class="texte-legal">
    <p>Nous collectons les informations des organisations et de leurs utilisateurs (nom, e-mail, téléphone) et, pour les commerçantes, leur nom, leur numéro WhatsApp, leurs messages et les opérations qui en sont extraites.</p>
    <p>Ces données servent uniquement à fournir le service. Chaque organisation ne voit que ses propres commerçantes. Les données ne sont pas vendues.</p>
    <p>Les messages sont analysés par un service d'intelligence artificielle (Google Gemini). Les vocaux ne sont conservés que si la commerçante a donné son accord explicite.</p>
    <p>Les mots de passe sont chiffrés. Pour toute demande d'accès, de correction ou de suppression de données, contactez l'organisation qui vous accompagne ou VoixBilan.</p></div>
    <p style="margin:0"><a class="lien" href="/inscription">Retour</a></p>`, true));
});

module.exports = router;