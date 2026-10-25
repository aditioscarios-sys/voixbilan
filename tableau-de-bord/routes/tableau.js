// routes/tableau.js : tableau de bord (chiffres, graphique, groupes, classement) et page Alertes
const express = require("express");
const db = require("../lib/db");
const { pageApp, entete, esc, note } = require("../lib/pages");
const { FUSEAU, dateFr, debutDuMois, debutDeSemaine, ajouterJours, jourMois } = require("../lib/temps");
const { montant, chiffresParCommercante, totaux, listeCommercantes, calculerAlertes, filtreGroupe } = require("../lib/statistiques");

const router = express.Router();
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const exigerConnexion = (req, res, next) => (req.utilisateur ? next() : res.redirect("/connexion"));
const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

const PERIODES = { mois: "Ce mois-ci", mois_dernier: "Le mois dernier", trois_mois: "Les 3 derniers mois" };

// Début et fin de la période, et de la période précédente (pour la comparaison)
function bornes(periode) {
  const maintenant = new Date();
  if (periode === "mois_dernier") {
    const debut = debutDuMois(-1);
    return { debut, fin: debutDuMois(0), precedentDebut: debutDuMois(-2), precedentFin: debut };
  }
  if (periode === "trois_mois") {
    const debut = debutDuMois(-2);
    return { debut, fin: maintenant, precedentDebut: debutDuMois(-5), precedentFin: debut };
  }
  const debut = debutDuMois(0);
  const precedentDebut = debutDuMois(-1);
  return { debut, fin: maintenant, precedentDebut, precedentFin: new Date(precedentDebut.getTime() + (maintenant - debut)) };
}

async function lireFiltres(req) {
  const groupes = await db.requete("SELECT id, nom FROM groupes WHERE organisation_id = ? ORDER BY nom", [req.organisation.id]);
  const periode = PERIODES[req.query.periode] ? req.query.periode : "mois";
  const brut = String(req.query.groupe || "");
  const groupe = brut === "aucun" ? "aucun" : groupes.some((g) => g.id === Number(brut)) ? Number(brut) : null;
  return { groupes, periode, groupe };
}

function formulaireFiltres(action, { groupes, periode, groupe }, avecPeriode = true) {
  const optionsPeriodes = Object.entries(PERIODES).map(([cle, lib]) => `<option value="${cle}" ${cle === periode ? "selected" : ""}>${lib}</option>`).join("");
  const optionsGroupes = `<option value="">Tous les groupes</option>` +
    groupes.map((g) => `<option value="${g.id}" ${g.id === groupe ? "selected" : ""}>${esc(g.nom)}</option>`).join("") +
    (groupes.length ? `<option value="aucun" ${groupe === "aucun" ? "selected" : ""}>Sans groupe</option>` : "");
  return `<form class="filtres filtres-tableau" method="get" action="${action}">
    ${avecPeriode ? `<div><label for="periode">Période</label><select id="periode" name="periode" onchange="this.form.submit()">${optionsPeriodes}</select></div>` : ""}
    <div><label for="groupe">Groupe</label><select id="groupe" name="groupe" onchange="this.form.submit()">${optionsGroupes}</select></div>
    <noscript><div><button type="submit" class="secondaire">Afficher</button></div></noscript>
  </form>`;
}

// Nombre court pour le graphique (4,5 k, 1,2 M)
function compact(n) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M`;
  if (n >= 1000) return `${(n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k`;
  return String(Math.round(n));
}

// Période écrite en clair : "Du 1 octobre 2026 au 25 octobre 2026"
function periodeEnClair(debut, fin) {
  const options = { timeZone: FUSEAU, day: "numeric", month: "long", year: "numeric" };
  const a = debut.toLocaleDateString("fr-FR", options);
  const b = new Date(fin.getTime() - 1).toLocaleDateString("fr-FR", options);
  return a === b ? a : `Du ${a} au ${b}`;
}

// Graphique en barres (dessiné directement, sans bibliothèque externe)
function graphique(semaines) {
  const L = 640, H = 240, bas = 205, haut = 28;
  const max = Math.max(...semaines.map((s) => s.total), 1);
  const pas = L / semaines.length;
  const barres = semaines.map((s, i) => {
    const h = s.total > 0 ? Math.max((s.total / max) * (bas - haut), 3) : 0;
    const x = i * pas + pas * 0.2;
    const w = pas * 0.6;
    const y = bas - h;
    const cx = i * pas + pas / 2;
    return `<rect class="barre" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3"></rect>
      ${s.total > 0 ? `<text class="valeur-barre" x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle">${compact(s.total)}</text>` : ""}
      <text class="etiquette" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${jourMois(s.debut)}</text>`;
  }).join("");
  return `<svg class="graphique" viewBox="0 0 ${L} ${H}" role="img" aria-label="Ventes par semaine"><line class="axe" x1="0" y1="${bas}" x2="${L}" y2="${bas}"></line>${barres}</svg>`;
}

// =====================================================================
// TABLEAU DE BORD
// =====================================================================
router.get("/", exigerConnexion, a(async (req, res) => {
  const o = req.organisation;
  const u = req.utilisateur;
  const m = (n) => montant(n, o.devise);
  const bienvenue = req.query.bienvenue ? note("vert", "Votre adresse e-mail est confirmée. Bienvenue sur VoixBilan.") : "";

  // Aucune commerçante encore : on guide les premiers pas
  const total = Number((await db.une("SELECT COUNT(*) AS n FROM commercantes WHERE organisation_id = ?", [o.id])).n);
  if (total === 0) {
    const equipe = u.role === "administrateur" ? '<a class="lien" href="/equipe">Invitez votre équipe</a> : agents de terrain, responsables, partenaires.' : "Votre administrateur peut inviter d'autres membres de l'équipe.";
    return res.send(pageApp("Tableau de bord", req, `${entete("Tableau de bord", `${esc(o.nom)} · ${esc(o.ville)}, ${esc(o.pays)}`)}${bienvenue}
      <div class="bloc"><h2>Pour bien démarrer</h2><ol class="etapes">
        <li><a class="lien" href="/groupes">Créez vos groupes</a>, par marché ou par projet.</li>
        <li><a class="lien" href="/commercantes/ajouter">Ajoutez vos commerçantes</a> : chacune reçoit un code d'activation à 6 chiffres.</li>
        <li>Chaque commerçante envoie son code au numéro WhatsApp de VoixBilan, puis ses vocaux quand elle veut.</li>
        <li>${equipe}</li>
      </ol><p class="petit" style="margin:12px 0 0">Les chiffres apparaîtront ici dès les premiers messages des commerçantes.</p></div>`, "accueil"));
  }

  const filtres = await lireFiltres(req);
  const { periode, groupe, groupes } = filtres;
  const { debut, fin, precedentDebut, precedentFin } = bornes(periode);

  const commercantes = await listeCommercantes(o.id, groupe);
  const actuels = await chiffresParCommercante(o.id, debut, fin, groupe);
  const precedents = await chiffresParCommercante(o.id, precedentDebut, precedentFin, groupe);
  const t = totaux(actuels);
  const tp = totaux(precedents);

  // Commerçantes qui ont envoyé au moins un message pendant la période
  const paramsActives = [o.id, debut, fin];
  const filtreActives = filtreGroupe(groupe, paramsActives);
  const actives = Number((await db.une(
    `SELECT COUNT(DISTINCT m.commercante_id) AS n FROM messages m JOIN commercantes c ON c.id = m.commercante_id
     WHERE c.organisation_id = ? AND c.actif = 1 AND m.date_message >= ? AND m.date_message < ?${filtreActives}`, paramsActives)).n);
  const activees = commercantes.filter((c) => c.activee_le).length;
  const enAttente = commercantes.length - activees;

  let variation = "";
  if (tp.ventes > 0) {
    const v = Math.round(((t.ventes - tp.ventes) / tp.ventes) * 100);
    variation = `<div class="variation ${v >= 0 ? "vert" : "rouge"}">${v >= 0 ? "+" : ""}${v} % par rapport à la période précédente</div>`;
  }

  // Ventes des 8 dernières semaines (du lundi au dimanche)
  const premiereSemaine = debutDeSemaine(ajouterJours(new Date(), -49));
  const debuts = Array.from({ length: 8 }, (_, i) => ajouterJours(premiereSemaine, 7 * i));
  const paramsGraphique = [o.id, premiereSemaine];
  const filtreGraphique = filtreGroupe(groupe, paramsGraphique);
  const ventesSemaines = await db.requete(
    `SELECT o.date_operation AS d, o.montant FROM operations o JOIN commercantes c ON c.id = o.commercante_id
     WHERE c.organisation_id = ? AND o.annulee = 0 AND o.type IN ('vente','credit_accorde') AND o.date_operation >= ?${filtreGraphique}`, paramsGraphique);
  const semaines = debuts.map((d) => ({ debut: d, total: 0 }));
  for (const v of ventesSemaines) {
    const date = new Date(v.d);
    for (let i = debuts.length - 1; i >= 0; i--) if (date >= debuts[i]) { semaines[i].total += Number(v.montant); break; }
  }

  // Comparaison des groupes (seulement quand on regarde tous les groupes)
  let blocGroupes = "";
  if (groupes.length && !groupe) {
    const parGroupe = new Map(groupes.map((g) => [g.id, { nom: g.nom, nb: 0, ventes: 0, benefice: 0 }]));
    parGroupe.set(null, { nom: "Sans groupe", nb: 0, ventes: 0, benefice: 0 });
    for (const c of commercantes) {
      const g = parGroupe.get(c.groupe_id ?? null) || parGroupe.get(null);
      g.nb++;
      const ch = actuels.get(c.id);
      if (ch) { g.ventes += ch.ventes; g.benefice += ch.benefice; }
    }
    const lignes = [...parGroupe.values()].filter((g) => g.nb > 0).sort((x, y) => y.ventes - x.ventes).map((g) => `<tr>
      <td data-label="Groupe">${esc(g.nom)}</td><td data-label="Commerçantes">${g.nb}</td>
      <td data-label="Ventes" class="montant">${m(g.ventes)}</td><td data-label="Bénéfice" class="montant">${m(g.benefice)}</td></tr>`).join("");
    blocGroupes = `<div class="bloc"><h2>Comparaison des groupes</h2><table class="responsive"><thead><tr><th>Groupe</th><th>Commerçantes</th><th class="montant">Ventes</th><th class="montant">Bénéfice</th></tr></thead><tbody>${lignes}</tbody></table></div>`;
  }

  // Classement des commerçantes par ventes
  const classement = commercantes.filter((c) => c.activee_le)
    .map((c) => ({ c, ch: actuels.get(c.id) || { ventes: 0, benefice: 0, credits: 0 } }))
    .sort((x, y) => y.ch.ventes - x.ch.ventes).slice(0, 10);
  const lignesClassement = classement.map(({ c, ch }, i) => `<tr>
    <td data-label="Rang">${i + 1}</td>
    <td data-label="Commerçante"><div><a class="lien" href="/commercantes/${c.id}">${esc(c.nom)}</a><span class="petit">${esc(c.groupe_nom || "Sans groupe")}</span></div></td>
    <td data-label="Ventes" class="montant">${m(ch.ventes)}</td>
    <td data-label="Bénéfice" class="montant">${m(ch.benefice)}</td>
    <td data-label="Crédits à récupérer" class="montant">${m(ch.credits)}</td>
    <td data-label="Dernier message" class="petit">${dateFr(c.dernier_message)}</td></tr>`).join("");

  // Résumé des alertes
  const alertes = await calculerAlertes(o.id, groupe, m);
  const nbAlertes = alertes.filter((x) => x.niveau === "alerte").length;
  const nbSurveiller = alertes.length - nbAlertes;
  const lienAlertes = `/alertes${groupe ? `?groupe=${groupe}` : ""}`;
  const resumeAlertes = alertes.length
    ? note("orange", `${pluriel(nbAlertes, "alerte", "alertes")} et ${pluriel(nbSurveiller, "point", "points")} à surveiller. <a href="${lienAlertes}">Voir le détail</a>`)
    : note("vert", "Aucune alerte en ce moment.");

  res.send(pageApp("Tableau de bord", req, `<div class="entete-page entete-tableau">
      <div><h1>Tableau de bord</h1><p class="sous-titre">${esc(o.nom)} · ${periodeEnClair(debut, fin)}</p></div>
      ${formulaireFiltres("/", filtres)}
    </div>${bienvenue}
    ${resumeAlertes}
    <div class="chiffres">
      <div class="chiffre"><div class="libelle">Commerçantes actives</div><div class="valeur">${actives} / ${activees}</div><div class="variation petit">${enAttente ? `${pluriel(enAttente, "autre", "autres")} en attente d'activation` : "ont envoyé au moins un message"}</div></div>
      <div class="chiffre"><div class="libelle">Ventes</div><div class="valeur">${m(t.ventes)}</div>${variation}</div>
      <div class="chiffre"><div class="libelle">Bénéfice estimé</div><div class="valeur">${m(t.benefice)}</div></div>
      <div class="chiffre"><div class="libelle">Crédits à récupérer</div><div class="valeur">${m(t.credits)}</div><div class="variation petit">à ce jour</div></div>
    </div>
    <div class="${blocGroupes ? "grille-deux" : ""}">
      <div class="bloc"><h2>Ventes des 8 dernières semaines</h2>${graphique(semaines)}<p class="petit" style="margin:8px 0 0">Ventes payées et à crédit, par semaine (du lundi au dimanche).</p></div>
      ${blocGroupes}
    </div>
    <div class="bloc"><div class="entete-flex" style="margin-bottom:10px"><h2 style="margin:0">Classement des commerçantes</h2><a class="lien petit" href="/commercantes">Voir toutes les commerçantes</a></div>
      ${classement.length ? `<table class="responsive"><thead><tr><th>Rang</th><th>Commerçante</th><th class="montant">Ventes</th><th class="montant">Bénéfice</th><th class="montant">Crédits à récupérer</th><th>Dernier message</th></tr></thead><tbody>${lignesClassement}</tbody></table>`
        : `<p class="vide">Aucune commerçante activée pour l'instant.</p>`}
    </div>
    <p class="petit">Bénéfice estimé = ventes (payées et à crédit) moins dépenses et achats de stock. Les chiffres viennent des messages des commerçantes, compris par une intelligence artificielle : ils peuvent contenir des erreurs.</p>`, "accueil"));
}));

// =====================================================================
// ALERTES
// =====================================================================
router.get("/alertes", exigerConnexion, a(async (req, res) => {
  const o = req.organisation;
  const m = (n) => montant(n, o.devise);
  const filtres = await lireFiltres(req);
  const alertes = await calculerAlertes(o.id, filtres.groupe, m);

  const ligne = (x) => `<tr>
    <td data-label="Commerçante"><div><a class="lien" href="/commercantes/${x.c.id}">${esc(x.c.nom)}</a><span class="petit">${esc(x.c.groupe_nom || "Sans groupe")}</span></div></td>
    <td data-label="Motif"><span class="statut ${x.niveau === "alerte" ? "rouge" : "orange"}">${esc(x.motif)}</span></td>
    <td data-label="Détail">${esc(x.detail)}</td>
    <td data-label="Dernier message" class="petit">${dateFr(x.c.dernier_message)}</td></tr>`;
  const section = (titre, liste, vide) => `<div class="bloc"><h2>${titre} (${liste.length})</h2>
    ${liste.length ? `<table class="responsive"><thead><tr><th>Commerçante</th><th>Motif</th><th>Détail</th><th>Dernier message</th></tr></thead><tbody>${liste.map(ligne).join("")}</tbody></table>`
      : `<p class="vide">${vide}</p>`}</div>`;

  res.send(pageApp("Alertes", req, `<div class="entete-page entete-tableau">
      <div><h1>Alertes</h1><p class="sous-titre">Les commerçantes qui ont peut-être besoin d'un appel ou d'une visite.</p></div>
      ${formulaireFiltres("/alertes", filtres, false)}
    </div>
    ${section("Alertes", alertes.filter((x) => x.niveau === "alerte"), "Aucune alerte.")}
    ${section("À surveiller", alertes.filter((x) => x.niveau === "surveiller"), "Rien à surveiller.")}
    <div class="bloc"><h2>Comment les alertes sont calculées</h2>
      <p class="petit" style="margin:0 0 6px"><strong>Crédits élevés :</strong> les crédits à récupérer dépassent la moitié des ventes du mois.</p>
      <p class="petit" style="margin:0 0 6px"><strong>Bénéfice en baisse :</strong> le bénéfice des 7 derniers jours a baissé de plus de 30 % par rapport aux 7 jours d'avant.</p>
      <p class="petit" style="margin:0 0 6px"><strong>Aucun message :</strong> pas de message au bot depuis 3 jours ou plus.</p>
      <p class="petit" style="margin:0"><strong>Pas encore activée :</strong> ajoutée depuis 3 jours ou plus, sans avoir envoyé son code.</p>
    </div>`, "alertes"));
}));

module.exports = router;