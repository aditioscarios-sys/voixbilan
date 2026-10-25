// routes/commercantes.js : groupes, commerçantes, codes d'activation et fiches
const express = require("express");
const crypto = require("crypto");
const db = require("../lib/db");
const sec = require("../lib/securite");
const { pageApp, entete, esc, note } = require("../lib/pages");
const { infosPays, languesPour, infoLangue, consigneLangue, STATUTS_LANGUE } = require("../lib/reference");

const router = express.Router();
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const TYPES_GROUPE = { marche: "Marché", projet: "Projet", autre: "Autre" };
const TYPES_OPERATION = { vente: "Vente", depense: "Dépense", achat_stock: "Achat de stock", credit_accorde: "Crédit accordé", remboursement: "Remboursement" };

const exigerConnexion = (req, res, next) => (req.utilisateur ? next() : res.redirect("/connexion"));
const exigerEdition = (req, res, next) => {
  if (!req.utilisateur) return res.redirect("/connexion");
  if (req.utilisateur.role === "lecture") {
    return res.status(403).send(pageApp("Accès refusé", req, entete("Accès refusé", "Votre rôle (Lecture seule) permet de consulter, mais pas de modifier.")));
  }
  next();
};
const peutModifier = (req) => req.utilisateur.role !== "lecture";

const dateFr = (d, avecHeure = true) => (d ? new Date(d).toLocaleString("fr-FR", avecHeure
  ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
  : { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

function montant(n, devise) {
  const unite = devise === "XOF" || devise === "XAF" ? "F CFA" : devise;
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(n) || 0))} ${unite}`;
}

function formaterTelephone(indicatif, numero) {
  const n = String(numero || "").replace(/[^\d+]/g, "");
  if (!n) return null;
  if (n.startsWith("+")) return n;
  return indicatif ? `+${indicatif} ${n}` : n;
}

function statutCommercante(c) {
  if (!c.actif) return '<span class="statut rouge">Désactivée</span>';
  if (!c.activee_le) return '<span class="statut orange">En attente d\'activation</span>';
  return '<span class="statut vert">Active</span>';
}

// Code à 6 chiffres, unique
async function nouveauCode() {
  for (let i = 0; i < 20; i++) {
    const code = String(crypto.randomInt(100000, 1000000));
    if (!(await db.une("SELECT id FROM commercantes WHERE code_activation = ?", [code]))) return code;
  }
  throw new Error("Impossible de générer un code unique");
}

const enteteAvecBouton = (titre, sousTitre, bouton = "") =>
  `<div class="entete-page entete-flex"><div><h1>${titre}</h1>${sousTitre ? `<p class="sous-titre">${sousTitre}</p>` : ""}</div>${bouton}</div>`;

// =====================================================================
// GROUPES
// =====================================================================
const OK_GROUPE = { cree: "Le groupe a été créé.", modifie: "Le groupe a été modifié.", supprime: "Le groupe a été supprimé. Ses commerçantes sont maintenant sans groupe." };
const ERR_GROUPE = { nom: "Indiquez le nom du groupe.", existe: "Un groupe porte déjà ce nom." };

router.get("/groupes", exigerConnexion, a(async (req, res) => {
  const groupes = await db.requete(
    `SELECT g.id, g.nom, g.type, g.description, COUNT(c.id) AS nb
     FROM groupes g LEFT JOIN commercantes c ON c.groupe_id = g.id AND c.actif = 1
     WHERE g.organisation_id = ? GROUP BY g.id, g.nom, g.type, g.description ORDER BY g.nom`,
    [req.organisation.id]
  );
  const edition = peutModifier(req);
  const enModif = Number(req.query.modifier);
  const optionsType = (choisi) => Object.entries(TYPES_GROUPE).map(([cle, lib]) => `<option value="${cle}" ${cle === choisi ? "selected" : ""}>${lib}</option>`).join("");
  const messages = (OK_GROUPE[req.query.ok] ? note("vert", OK_GROUPE[req.query.ok]) : "") + (ERR_GROUPE[req.query.erreur] ? note("rouge", ERR_GROUPE[req.query.erreur]) : "");

  const lignes = groupes.map((g) => {
    if (edition && enModif === g.id) {
      return `<tr><td colspan="4"><form class="ligne-formulaire" method="post" action="/groupes/modifier">
        <input type="hidden" name="id" value="${g.id}">
        <div><label>Nom du groupe</label><input name="nom" required maxlength="120" value="${esc(g.nom)}"></div>
        <div><label>Type</label><select name="type">${optionsType(g.type)}</select></div>
        <div class="en-ligne"><a class="lien petit" href="/groupes">Annuler</a><button type="submit">Enregistrer</button></div>
      </form></td></tr>`;
    }
    const actions = edition ? `<a class="lien petit" href="/groupes?modifier=${g.id}">Renommer</a>
      <form method="post" action="/groupes/supprimer" class="en-ligne" data-confirmer="Supprimer le groupe ${esc(g.nom)} ? Ses commerçantes ne seront pas supprimées, elles seront simplement sans groupe."><input type="hidden" name="id" value="${g.id}"><button type="submit" class="danger petit-bouton">Supprimer</button></form>` : "";
    return `<tr>
      <td data-label="Groupe"><div>${esc(g.nom)}${g.description ? `<span class="petit">${esc(g.description)}</span>` : ""}</div></td>
      <td data-label="Type">${TYPES_GROUPE[g.type] || ""}</td>
      <td data-label="Commerçantes"><a class="lien" href="/commercantes?groupe=${g.id}">${g.nb}</a></td>
      <td class="actions"><div class="en-ligne">${actions}</div></td></tr>`;
  }).join("");

  const formulaire = edition ? `<details class="volet"${req.query.erreur ? " open" : ""}><summary>Créer un groupe</summary>
    <div class="bloc volet-contenu"><form class="ligne-formulaire" method="post" action="/groupes">
      <div><label for="nom">Nom du groupe</label><input id="nom" name="nom" required maxlength="120" placeholder="Exemple : Marché Dantokpa"></div>
      <div><label for="type">Type</label><select id="type" name="type">${optionsType("marche")}</select></div>
      <div><button type="submit">Créer le groupe</button></div>
    </form></div></details>` : "";

  res.send(pageApp("Groupes", req, `${entete("Groupes", "Rangez vos commerçantes par marché ou par projet, pour comparer leurs résultats.")}${messages}${formulaire}
    <div class="bloc"><h2>Vos groupes (${groupes.length})</h2>
    ${groupes.length ? `<table class="responsive"><thead><tr><th>Groupe</th><th>Type</th><th>Commerçantes actives</th><th></th></tr></thead><tbody>${lignes}</tbody></table>`
      : `<p class="vide">Aucun groupe pour l'instant.${edition ? " Créez-en un avec le bouton ci-dessus." : ""}</p>`}</div>`, "groupes"));
}));

router.post("/groupes", exigerEdition, a(async (req, res) => {
  const nom = sec.majuscule(req.body.nom, 120);
  const type = TYPES_GROUPE[req.body.type] ? req.body.type : "marche";
  if (!nom) return res.redirect("/groupes?erreur=nom");
  try {
    await db.requete("INSERT INTO groupes (organisation_id, nom, type, date_creation) VALUES (?, ?, ?, ?)", [req.organisation.id, nom, type, new Date()]);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.redirect("/groupes?erreur=existe");
    throw e;
  }
  res.redirect("/groupes?ok=cree");
}));

router.post("/groupes/modifier", exigerEdition, a(async (req, res) => {
  const nom = sec.majuscule(req.body.nom, 120);
  const type = TYPES_GROUPE[req.body.type] ? req.body.type : "marche";
  if (!nom) return res.redirect("/groupes?erreur=nom");
  try {
    await db.requete("UPDATE groupes SET nom = ?, type = ? WHERE id = ? AND organisation_id = ?", [nom, type, Number(req.body.id), req.organisation.id]);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.redirect("/groupes?erreur=existe");
    throw e;
  }
  res.redirect("/groupes?ok=modifie");
}));

router.post("/groupes/supprimer", exigerEdition, a(async (req, res) => {
  await db.requete("DELETE FROM groupes WHERE id = ? AND organisation_id = ?", [Number(req.body.id), req.organisation.id]);
  res.redirect("/groupes?ok=supprime");
}));

// =====================================================================
// COMMERÇANTES : LISTE
// =====================================================================
router.get("/commercantes", exigerConnexion, a(async (req, res) => {
  const o = req.organisation;
  const groupes = await db.requete("SELECT id, nom FROM groupes WHERE organisation_id = ? ORDER BY nom", [o.id]);
  const filtreGroupe = String(req.query.groupe || "");
  const recherche = sec.texte(req.query.q, 80);

  let sql = `SELECT c.id, c.nom, c.activite, c.marche, c.langue, c.actif, c.activee_le, g.nom AS groupe_nom,
               (SELECT MAX(m.date_message) FROM messages m WHERE m.commercante_id = c.id) AS dernier_message
             FROM commercantes c LEFT JOIN groupes g ON g.id = c.groupe_id
             WHERE c.organisation_id = ?`;
  const params = [o.id];
  if (filtreGroupe === "aucun") sql += " AND c.groupe_id IS NULL";
  else if (Number(filtreGroupe)) { sql += " AND c.groupe_id = ?"; params.push(Number(filtreGroupe)); }
  if (recherche) { sql += " AND (c.nom LIKE ? OR c.telephone LIKE ? OR c.marche LIKE ?)"; params.push(`%${recherche}%`, `%${recherche}%`, `%${recherche}%`); }
  sql += " ORDER BY c.actif DESC, c.nom";
  const liste = await db.requete(sql, params);

  const optionsGroupes = `<option value="">Tous les groupes</option>` +
    groupes.map((g) => `<option value="${g.id}" ${String(g.id) === filtreGroupe ? "selected" : ""}>${esc(g.nom)}</option>`).join("") +
    `<option value="aucun" ${filtreGroupe === "aucun" ? "selected" : ""}>Sans groupe</option>`;

  const lignes = liste.map((c) => `<tr>
    <td data-label="Nom"><div><a class="lien" href="/commercantes/${c.id}">${esc(c.nom)}</a>${c.activite ? `<span class="petit">${esc(c.activite)}</span>` : ""}</div></td>
    <td data-label="Groupe">${esc(c.groupe_nom || "Sans groupe")}</td>
    <td data-label="Langue">${esc(infoLangue(o.pays, c.langue).nom)}</td>
    <td data-label="Statut">${statutCommercante(c)}</td>
    <td data-label="Dernier message" class="petit">${dateFr(c.dernier_message)}</td>
    <td class="actions"><a class="lien petit" href="/commercantes/${c.id}">Voir la fiche</a></td></tr>`).join("");

  const bouton = peutModifier(req) ? `<a class="bouton" href="/commercantes/ajouter">Ajouter une commerçante</a>` : "";
  const filtresActifs = filtreGroupe || recherche;

  res.send(pageApp("Commerçantes", req, `${enteteAvecBouton("Commerçantes", "Les commerçantes accompagnées par votre organisation.", bouton)}
       ${req.query.ok === "supprimee" ? note("vert", "La commerçante et toutes ses données ont été supprimées.") : ""}
    <form class="filtres" method="get" action="/commercantes">
      <div><label for="q">Rechercher</label><input id="q" name="q" placeholder="Nom, téléphone ou marché" value="${esc(recherche)}"></div>
            <div><label for="groupe">Filtrer par groupe</label><select id="groupe" name="groupe">${optionsGroupes}</select></div>
      <div class="en-ligne">${filtresActifs ? `<a class="lien petit" href="/commercantes">Effacer</a>` : ""}<button type="submit" class="secondaire">Filtrer</button></div>
    </form>
    <div class="bloc"><h2>${liste.length} commerçante${liste.length > 1 ? "s" : ""}</h2>
    ${liste.length ? `<table class="responsive"><thead><tr><th>Nom</th><th>Groupe</th><th>Langue</th><th>Statut</th><th>Dernier message</th><th></th></tr></thead><tbody>${lignes}</tbody></table>`
      : `<p class="vide">${filtresActifs ? "Aucune commerçante ne correspond à cette recherche." : "Aucune commerçante pour l'instant."}</p>`}</div>`, "commercantes"));
}));

// =====================================================================
// COMMERÇANTES : AJOUTER ET MODIFIER
// =====================================================================
function pageFormulaire(req, { v = {}, groupes, erreur = "", action, titre, sousTitre, bouton, retour }) {
  const o = req.organisation;
  const pays = infosPays(o.pays);
  const langueChoisie = v.langue || "francais";
  const telephone = String(v.telephone || "").replace(pays.indicatif ? `+${pays.indicatif} ` : "\u0000", "");

  const optionsGroupes = `<option value="">Sans groupe</option>` +
    groupes.map((g) => `<option value="${g.id}" ${Number(v.groupe_id) === g.id ? "selected" : ""}>${esc(g.nom)}</option>`).join("");
  const optionsLangues = languesPour(o.pays).map((l) =>
    `<option value="${l.code}" data-consigne="${esc(consigneLangue(l))}" ${langueChoisie === l.code ? "selected" : ""}>${esc(l.nom)} · ${esc(STATUTS_LANGUE[l.statut])}</option>`).join("");
  const sansGroupe = !groupes.length && peutModifier(req)
    ? note("orange", 'Vous n\'avez pas encore de groupe. Vous pouvez <a href="/groupes">en créer un</a>, ou ajouter la commerçante sans groupe.') : "";

  return pageApp(titre, req, `${entete(titre, sousTitre)}${erreur ? note("rouge", esc(erreur)) : ""}${sansGroupe}
    <div class="bloc"><form class="formulaire" method="post" action="${action}">
      <div class="deux">
        <div><label for="nom">Nom et prénom</label><input id="nom" name="nom" required maxlength="150" value="${esc(v.nom)}"></div>
        <div><label for="telephone">Téléphone WhatsApp</label><div class="telephone"><span>${pays.indicatif ? "+" + pays.indicatif : "+"}</span><input id="telephone" name="telephone" inputmode="tel" placeholder="Sans l'indicatif" value="${esc(telephone)}"></div></div>
      </div>
      <div class="deux">
        <div><label for="groupe_id">Groupe</label><select id="groupe_id" name="groupe_id">${optionsGroupes}</select></div>
        <div><label for="langue">Langue</label><select id="langue" name="langue">${optionsLangues}</select></div>
      </div>
      <div id="consigne" class="consigne"></div>
      <div class="deux">
        <div><label for="activite">Activité</label><input id="activite" name="activite" maxlength="120" placeholder="Exemple : vente de légumes" value="${esc(v.activite)}"></div>
        <div><label for="marche">Marché ou quartier</label><input id="marche" name="marche" maxlength="120" placeholder="Exemple : Dantokpa" value="${esc(v.marche)}"></div>
      </div>
      <label class="case"><input type="checkbox" name="accord_suivi" required ${v.accord_suivi ? "checked" : ""}><span>La commerçante accepte que l'organisation suive ses ventes, dépenses et crédits.</span></label>
      <label class="case"><input type="checkbox" name="accord_vocaux" ${v.accord_vocaux ? "checked" : ""}><span>Elle accepte aussi que ses vocaux soient conservés pour améliorer la compréhension de sa langue (facultatif).</span></label>
      <div class="boutons"><a class="lien" href="${retour}">Annuler</a><button type="submit">${bouton}</button></div>
    </form></div>
    <script>(function(){var s=document.getElementById("langue"),c=document.getElementById("consigne");
      function maj(){var o=s.options[s.selectedIndex];c.textContent=o?o.getAttribute("data-consigne"):"";}
      s.addEventListener("change",maj);maj();})();</script>`, "commercantes");
}

function lireFormulaire(req, groupes) {
  const v = req.body;
  const pays = infosPays(req.organisation.pays);
  const codesLangues = languesPour(req.organisation.pays).map((l) => l.code);
  const groupeId = Number(v.groupe_id) || null;
  const erreur =
    !sec.texte(v.nom) ? "Indiquez le nom de la commerçante." :
    groupeId && !groupes.some((g) => g.id === groupeId) ? "Ce groupe n'existe pas." :
    !codesLangues.includes(v.langue) ? "Choisissez une langue dans la liste." :
    !v.accord_suivi ? "La commerçante doit avoir accepté le suivi de ses chiffres." : "";
  return {
    erreur,
    donnees: {
      nom: sec.majuscule(v.nom),
      telephone: formaterTelephone(pays.indicatif, v.telephone),
      groupe_id: groupeId,
      langue: v.langue,
      activite: sec.majuscule(v.activite, 120) || null,
      marche: sec.majuscule(v.marche, 120) || null,
      accord_vocaux: v.accord_vocaux ? 1 : 0,
    },
  };
}

const lireGroupes = (orgId) => db.requete("SELECT id, nom FROM groupes WHERE organisation_id = ? ORDER BY nom", [orgId]);

router.get("/commercantes/ajouter", exigerEdition, a(async (req, res) => {
  const groupes = await lireGroupes(req.organisation.id);
  const groupeDefaut = Number(req.query.groupe) || "";
  res.send(pageFormulaire(req, { v: { groupe_id: groupeDefaut }, groupes, action: "/commercantes/ajouter", titre: "Ajouter une commerçante",
    sousTitre: "Elle recevra un code d'activation à envoyer au bot WhatsApp.", bouton: "Ajouter et obtenir le code", retour: "/commercantes" }));
}));

router.post("/commercantes/ajouter", exigerEdition, a(async (req, res) => {
  const groupes = await lireGroupes(req.organisation.id);
  const { erreur, donnees } = lireFormulaire(req, groupes);
  if (erreur) {
    return res.send(pageFormulaire(req, { v: req.body, groupes, erreur, action: "/commercantes/ajouter", titre: "Ajouter une commerçante",
      sousTitre: "Elle recevra un code d'activation à envoyer au bot WhatsApp.", bouton: "Ajouter et obtenir le code", retour: "/commercantes" }));
  }
  const code = await nouveauCode();
  const r = await db.requete(
    `INSERT INTO commercantes (organisation_id, groupe_id, nom, telephone, langue, activite, marche, accord_suivi, accord_vocaux, code_activation, ajoutee_par, actif, date_creation)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1, ?)`,
    [req.organisation.id, donnees.groupe_id, donnees.nom, donnees.telephone, donnees.langue, donnees.activite, donnees.marche, donnees.accord_vocaux, code, req.utilisateur.id, new Date()]
  );
  res.redirect(`/commercantes/${r.insertId}?ok=ajoutee`);
}));

async function lireCommercante(req) {
  return db.une(
    `SELECT c.*, g.nom AS groupe_nom, u.nom AS ajoutee_par_nom
     FROM commercantes c LEFT JOIN groupes g ON g.id = c.groupe_id LEFT JOIN utilisateurs u ON u.id = c.ajoutee_par
     WHERE c.id = ? AND c.organisation_id = ?`,
    [Number(req.params.id), req.organisation.id]
  );
}

const PAGE_INTROUVABLE = (req) => pageApp("Introuvable", req, `${entete("Commerçante introuvable", "Elle n'existe pas ou n'appartient pas à votre organisation.")}<a class="bouton" href="/commercantes">Retour à la liste</a>`, "commercantes");

router.get("/commercantes/:id/modifier", exigerEdition, a(async (req, res) => {
  const c = await lireCommercante(req);
  if (!c) return res.status(404).send(PAGE_INTROUVABLE(req));
  const groupes = await lireGroupes(req.organisation.id);
  res.send(pageFormulaire(req, { v: c, groupes, action: `/commercantes/${c.id}/modifier`, titre: "Modifier la commerçante",
    sousTitre: esc(c.nom), bouton: "Enregistrer", retour: `/commercantes/${c.id}` }));
}));

router.post("/commercantes/:id/modifier", exigerEdition, a(async (req, res) => {
  const c = await lireCommercante(req);
  if (!c) return res.status(404).send(PAGE_INTROUVABLE(req));
  const groupes = await lireGroupes(req.organisation.id);
  const { erreur, donnees } = lireFormulaire(req, groupes);
  if (erreur) {
    return res.send(pageFormulaire(req, { v: { ...req.body, telephone: req.body.telephone }, groupes, erreur, action: `/commercantes/${c.id}/modifier`,
      titre: "Modifier la commerçante", sousTitre: esc(c.nom), bouton: "Enregistrer", retour: `/commercantes/${c.id}` }));
  }
  await db.requete(
    "UPDATE commercantes SET nom = ?, telephone = ?, groupe_id = ?, langue = ?, activite = ?, marche = ?, accord_vocaux = ? WHERE id = ? AND organisation_id = ?",
    [donnees.nom, donnees.telephone, donnees.groupe_id, donnees.langue, donnees.activite, donnees.marche, donnees.accord_vocaux, c.id, req.organisation.id]
  );
  res.redirect(`/commercantes/${c.id}?ok=modifiee`);
}));

router.post("/commercantes/:id/code", exigerEdition, a(async (req, res) => {
  const c = await lireCommercante(req);
  if (!c) return res.status(404).send(PAGE_INTROUVABLE(req));
  await db.requete("UPDATE commercantes SET code_activation = ? WHERE id = ?", [await nouveauCode(), c.id]);
  res.redirect(`/commercantes/${c.id}?ok=code`);
}));

router.post("/commercantes/:id/statut", exigerEdition, a(async (req, res) => {
  const c = await lireCommercante(req);
  if (!c) return res.status(404).send(PAGE_INTROUVABLE(req));
  await db.requete("UPDATE commercantes SET actif = ? WHERE id = ?", [c.actif ? 0 : 1, c.id]);
  res.redirect(`/commercantes/${c.id}?ok=${c.actif ? "desactivee" : "reactivee"}`);
}));
router.post("/commercantes/:id/supprimer", exigerEdition, a(async (req, res) => {
  if (req.utilisateur.role !== "administrateur") {
    return res.status(403).send(pageApp("Accès refusé", req, entete("Accès refusé", "Seul un administrateur peut supprimer une commerçante.")));
  }
  const c = await lireCommercante(req);
  if (!c) return res.status(404).send(PAGE_INTROUVABLE(req));
  if (sec.texte(req.body.confirmation).toUpperCase() !== "SUPPRIMER") return res.redirect(`/commercantes/${c.id}?erreur=confirmation`);
  // Les messages et opérations sont effacés automatiquement avec elle
  await db.requete("DELETE FROM commercantes WHERE id = ? AND organisation_id = ?", [c.id, req.organisation.id]);
  res.redirect("/commercantes?ok=supprimee");
}));

// =====================================================================
// COMMERÇANTES : FICHE
// =====================================================================
const OK_FICHE = {
  ajoutee: "La commerçante a été ajoutée. Donnez-lui maintenant son code d'activation.",
  modifiee: "Les informations ont été enregistrées.",
  code: "Un nouveau code a été généré. L'ancien code ne fonctionne plus.",
  desactivee: "La commerçante a été désactivée. Le bot ne prendra plus ses messages.",
  reactivee: "La commerçante a été réactivée.",
};

router.get("/commercantes/:id", exigerConnexion, a(async (req, res) => {
  const c = await lireCommercante(req);
  if (!c) return res.status(404).send(PAGE_INTROUVABLE(req));
  const o = req.organisation;
  const edition = peutModifier(req);
  const langue = infoLangue(o.pays, c.langue);
  const m = (n) => montant(n, o.devise);

  // Chiffres du mois en cours
  const maintenant = new Date();
  const debutMois = new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
  const totaux = await db.requete(
    "SELECT type, SUM(montant) AS total FROM operations WHERE commercante_id = ? AND annulee = 0 AND date_operation >= ? GROUP BY type",
    [c.id, debutMois]
  );
  const t = Object.fromEntries(totaux.map((r) => [r.type, Number(r.total)]));
  const ventes = (t.vente || 0) + (t.credit_accorde || 0);
  const depenses = (t.depense || 0) + (t.achat_stock || 0);
  const benefice = ventes - depenses;

  // Qui lui doit de l'argent (tous les crédits non remboursés)
  const dettes = await db.requete(
    `SELECT client,
       SUM(CASE WHEN type = 'credit_accorde' THEN montant ELSE 0 END) - SUM(CASE WHEN type = 'remboursement' THEN montant ELSE 0 END) AS reste
     FROM operations WHERE commercante_id = ? AND annulee = 0 AND client IS NOT NULL AND client <> ''
     GROUP BY client HAVING reste > 0 ORDER BY reste DESC`,
    [c.id]
  );
  const totalDettes = dettes.reduce((s, d) => s + Number(d.reste), 0);

  const operations = await db.requete(
    "SELECT * FROM operations WHERE commercante_id = ? AND annulee = 0 ORDER BY date_operation DESC, id DESC LIMIT 15",
    [c.id]
  );

  // Boutons d'action
  const actions = edition ? `<div class="en-ligne">
      <a class="bouton secondaire" style="background:#fff;color:var(--texte);border-color:var(--bord)" href="/commercantes/${c.id}/modifier">Modifier</a>
      <form method="post" action="/commercantes/${c.id}/statut" class="en-ligne"${c.actif ? ` data-confirmer="Désactiver ${esc(c.nom)} ? Le bot ne prendra plus ses messages."` : ""}>
        <button type="submit" class="${c.actif ? "danger" : "secondaire"}">${c.actif ? "Désactiver" : "Réactiver"}</button></form>
    </div>` : "";

  // Bloc du code d'activation
  const numeroBot = process.env.NUMERO_BOT_AFFICHE || "(numéro du bot à configurer)";
  const blocCode = c.code_activation ? `<div class="bloc code-bloc">
      <h2>${c.activee_le ? "Nouveau code d'activation (changement de téléphone)" : "Code d'activation"}</h2>
      <div class="code">${esc(c.code_activation)}</div>
      <ol class="etapes">
        <li>La commerçante enregistre le numéro WhatsApp de VoixBilan : <strong>${esc(numeroBot)}</strong></li>
        <li>Elle envoie ce code au bot, par écrit ou à la voix.</li>
        <li>Ensuite, elle envoie ses ventes, dépenses et crédits, quand elle veut.</li>
      </ol>
      <div class="consigne" style="margin-top:12px">${esc(consigneLangue(langue))}</div>
      ${edition ? `<form method="post" action="/commercantes/${c.id}/code" data-confirmer="Générer un nouveau code ? L'ancien ne fonctionnera plus." style="margin-top:14px"><button type="submit" class="secondaire petit-bouton">Générer un nouveau code</button></form>` : ""}
    </div>` : "";

  const lignesOperations = operations.map((op) => {
    const detail = [op.produit, op.quantite ? `${Number(op.quantite)} unité(s)` : "", op.client, op.description].filter(Boolean).map(esc).join(" · ");
    return `<tr>
      <td data-label="Date" class="petit">${dateFr(op.date_operation)}</td>
      <td data-label="Opération">${TYPES_OPERATION[op.type] || op.type}</td>
      <td data-label="Détail">${detail || "—"}</td>
      <td data-label="Montant" class="montant">${m(op.montant)}</td></tr>`;
  }).join("");

  const lignesDettes = dettes.map((d) => `<tr><td data-label="Client">${esc(d.client)}</td><td data-label="Reste à payer" class="montant">${m(d.reste)}</td></tr>`).join("");

  const infos = `<table class="infos"><tbody>
      <tr><th>Téléphone</th><td>${esc(c.telephone || "—")}</td></tr>
      <tr><th>Groupe</th><td>${esc(c.groupe_nom || "Sans groupe")}</td></tr>
      <tr><th>Langue</th><td>${esc(langue.nom)} <span class="petit" style="display:inline">· ${esc(STATUTS_LANGUE[langue.statut])}</span></td></tr>
      <tr><th>Activité</th><td>${esc(c.activite || "—")}</td></tr>
      <tr><th>Marché</th><td>${esc(c.marche || "—")}</td></tr>
      <tr><th>Ajoutée le</th><td>${dateFr(c.date_creation, false)}${c.ajoutee_par_nom ? ` par ${esc(c.ajoutee_par_nom)}` : ""}</td></tr>
      <tr><th>Activée le</th><td>${c.activee_le ? dateFr(c.activee_le) : "Pas encore"}</td></tr>
      <tr><th>Vocaux conservés</th><td>${c.accord_vocaux ? "Oui, avec son accord" : "Non"}</td></tr>
    </tbody></table>`;

  const nomMois = maintenant.toLocaleString("fr-FR", { month: "long" });
  const sousTitre = [c.groupe_nom, c.activite, c.marche].filter(Boolean).map(esc).join(" · ");

  res.send(pageApp(c.nom, req, `
    <p style="margin:0 0 8px"><a class="lien petit" href="/commercantes">Retour à la liste</a></p>
    ${enteteAvecBouton(`${esc(c.nom)} <span style="font-size:14px;font-weight:400;vertical-align:middle">${statutCommercante(c)}</span>`, sousTitre, actions)}
        ${OK_FICHE[req.query.ok] ? note("vert", OK_FICHE[req.query.ok]) : ""}
    ${req.query.erreur === "confirmation" ? note("rouge", "Pour supprimer, tapez exactement le mot SUPPRIMER.") : ""}
    ${blocCode}
    <div class="chiffres">
      <div class="chiffre"><div class="libelle">Ventes (${nomMois})</div><div class="valeur">${m(ventes)}</div></div>
      <div class="chiffre"><div class="libelle">Dépenses et achats</div><div class="valeur">${m(depenses)}</div></div>
      <div class="chiffre"><div class="libelle">Bénéfice estimé</div><div class="valeur">${m(benefice)}</div></div>
      <div class="chiffre"><div class="libelle">Crédits à récupérer</div><div class="valeur">${m(totalDettes)}</div></div>
    </div>
    <div class="bloc"><h2>Dernières opérations</h2>
      ${operations.length ? `<table class="responsive"><thead><tr><th>Date</th><th>Opération</th><th>Détail</th><th class="montant">Montant</th></tr></thead><tbody>${lignesOperations}</tbody></table>`
        : `<p class="vide">Aucune opération pour l'instant. Elles apparaîtront ici dès que la commerçante enverra ses messages au bot.</p>`}
    </div>
    <div class="grille-deux">
      <div class="bloc"><h2>Qui lui doit de l'argent</h2>
        ${dettes.length ? `<table class="responsive"><thead><tr><th>Client</th><th class="montant">Reste à payer</th></tr></thead><tbody>${lignesDettes}</tbody></table>`
          : `<p class="vide">Aucun crédit en cours.</p>`}
      </div>
           <div class="bloc"><h2>Informations</h2>${infos}</div>
    </div>
    ${req.utilisateur.role === "administrateur" ? `<div class="bloc">
      <h2>Supprimer la commerçante</h2>
      <p class="petit">Toutes ses données (messages et opérations) seront effacées définitivement. Si elle arrête simplement d'utiliser VoixBilan, préférez « Désactiver » : son historique est conservé.</p>
      <form class="ligne-formulaire" method="post" action="/commercantes/${c.id}/supprimer" data-confirmer="Supprimer définitivement ${esc(c.nom)} et toutes ses données ? Cette action est irréversible.">
        <div><label for="confirmation">Tapez SUPPRIMER pour confirmer</label><input id="confirmation" name="confirmation" required autocomplete="off"></div>
        <div></div>
        <div><button type="submit" class="danger">Supprimer définitivement</button></div>
      </form>
    </div>` : ""}`, "commercantes"));
}));

module.exports = router;