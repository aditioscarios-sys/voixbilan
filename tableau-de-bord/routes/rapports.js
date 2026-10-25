// routes/rapports.js : rapports de suivi (aperçu, PDF par impression, export Excel)
const express = require("express");
const db = require("../lib/db");
const { pageApp, esc, note } = require("../lib/pages");
const { FUSEAU, dateFr, partiesLocales, minuit, debutDuMois } = require("../lib/temps");
const { montant, chiffresParCommercante, listeCommercantes, calculerAlertes, filtreGroupe } = require("../lib/statistiques");
const { infoLangue } = require("../lib/reference");

const router = express.Router();
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const exigerConnexion = (req, res, next) => (req.utilisateur ? next() : res.redirect("/connexion"));
const JOUR = 24 * 3600 * 1000;

const PERIODES = { mois: "Ce mois-ci", mois_dernier: "Le mois dernier", trois_mois: "Les 3 derniers mois", perso: "Dates au choix" };
const pourcent = (x) => `${Math.round(x * 100)} %`;
const dateLongue = (d) => d.toLocaleDateString("fr-FR", { timeZone: FUSEAU, day: "numeric", month: "long", year: "numeric" });
const jourLocal = (d) => new Date(d).toLocaleDateString("fr-CA", { timeZone: FUSEAU }); // format AAAA-MM-JJ

function lireDate(texte) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texte || ""));
  return m ? { annee: Number(m[1]), mois: Number(m[2]), jour: Number(m[3]) } : null;
}

// Période, groupe et dates choisis par l'utilisateur
async function lireParametres(req) {
  const groupes = await db.requete("SELECT id, nom FROM groupes WHERE organisation_id = ? ORDER BY nom", [req.organisation.id]);
  const brut = String(req.query.groupe || "");
  const groupe = brut === "aucun" ? "aucun" : groupes.some((g) => g.id === Number(brut)) ? Number(brut) : null;
  const maintenant = new Date();
  let periode = PERIODES[req.query.periode] ? req.query.periode : "mois";
  let debut;
  let fin;

  if (periode === "perso") {
    const du = lireDate(req.query.du);
    const au = lireDate(req.query.au);
    if (du && au) { debut = minuit(du.annee, du.mois, du.jour); fin = minuit(au.annee, au.mois, au.jour + 1); }
    if (fin > maintenant) fin = maintenant;
    if (!du || !au || !(fin > debut) || fin - debut > 400 * JOUR) periode = "mois";
  }
  if (periode === "mois") { debut = debutDuMois(0); fin = maintenant; }
  if (periode === "mois_dernier") { debut = debutDuMois(-1); fin = debutDuMois(0); }
  if (periode === "trois_mois") { debut = debutDuMois(-2); fin = maintenant; }

  const duree = fin - debut;
  return {
    groupes, groupe, periode, debut, fin,
    jusquAujourdhui: maintenant - fin < 60 * 1000, // la période se termine maintenant
    precedentDebut: new Date(debut.getTime() - duree), precedentFin: debut,
    du: jourLocal(debut), au: jourLocal(new Date(fin.getTime() - 1)),
  };
}

// Tous les calculs du rapport
async function calculerRapport(org, p) {
  // Seulement les commerçantes déjà inscrites à la fin de la période
  const toutes = await listeCommercantes(org.id, p.groupe);
  const commercantes = toutes.filter((c) => new Date(c.date_creation) < p.fin);
  const ids = new Set(commercantes.map((c) => c.id));
  const activeeAvantFin = (c) => c.activee_le && new Date(c.activee_le) < p.fin;

  const actuels = await chiffresParCommercante(org.id, p.debut, p.fin, p.groupe);
  const precedents = await chiffresParCommercante(org.id, p.precedentDebut, p.precedentFin, p.groupe);

  // Nombre d'opérations, crédits accordés et remboursements de la période
  const params = [org.id, p.debut, p.fin];
  const filtre = filtreGroupe(p.groupe, params);
  const operations = await db.requete(
    `SELECT o.commercante_id AS id, COUNT(*) AS nb,
       SUM(CASE WHEN o.type = 'credit_accorde' THEN o.montant ELSE 0 END) AS accordes,
       SUM(CASE WHEN o.type = 'remboursement' THEN o.montant ELSE 0 END) AS rembourses
     FROM operations o JOIN commercantes c ON c.id = o.commercante_id
     WHERE c.organisation_id = ? AND o.annulee = 0 AND o.date_operation >= ? AND o.date_operation < ?${filtre}
     GROUP BY o.commercante_id`,
    params
  );
  const parOperations = new Map(operations.map((x) => [x.id, { nb: Number(x.nb), accordes: Number(x.accordes), rembourses: Number(x.rembourses) }]));

  // Crédits encore dus à la fin de la période (et non aujourd'hui)
  const params3 = [org.id, p.fin];
  const filtre3 = filtreGroupe(p.groupe, params3);
  const dus = await db.requete(
    `SELECT o.commercante_id AS id,
       SUM(CASE WHEN o.type = 'credit_accorde' THEN o.montant ELSE 0 END) - SUM(CASE WHEN o.type = 'remboursement' THEN o.montant ELSE 0 END) AS du
     FROM operations o JOIN commercantes c ON c.id = o.commercante_id
     WHERE c.organisation_id = ? AND o.annulee = 0 AND o.date_operation < ?${filtre3}
     GROUP BY o.commercante_id`,
    params3
  );
  const duFinPeriode = new Map(dus.map((x) => [x.id, Math.max(Number(x.du), 0)]));

  // Jours avec au moins un message (tenue des comptes)
  const params2 = [org.id, p.debut, p.fin];
  const filtre2 = filtreGroupe(p.groupe, params2);
  const messages = await db.requete(
    `SELECT m.commercante_id AS id, m.date_message AS d FROM messages m JOIN commercantes c ON c.id = m.commercante_id
     WHERE c.organisation_id = ? AND m.date_message >= ? AND m.date_message < ?${filtre2}`,
    params2
  );
  const jours = new Map();
  for (const x of messages) {
    if (!jours.has(x.id)) jours.set(x.id, new Set());
    jours.get(x.id).add(jourLocal(x.d));
  }
  const nbJoursPeriode = Math.max(1, Math.round((p.fin - p.debut) / JOUR));
  const seuilRegulier = Math.max(1, Math.ceil(nbJoursPeriode / 7)); // au moins un jour par semaine, en moyenne

  // Une ligne par commerçante
  const lignes = commercantes.map((c) => {
    const ch = actuels.get(c.id) || { ventes: 0, depenses: 0, benefice: 0 };
    const op = parOperations.get(c.id) || { nb: 0, accordes: 0, rembourses: 0 };
    const nbJours = jours.get(c.id)?.size || 0;
    return {
      c, ventes: ch.ventes, depenses: ch.depenses, benefice: ch.benefice, ...op,
      credits: duFinPeriode.get(c.id) || 0, jours: nbJours, reguliere: nbJours >= seuilRegulier, activee: !!activeeAvantFin(c),
    };
  });
  const activees = lignes.filter((l) => l.activee);
  const actives = activees.filter((l) => l.jours > 0);
  const somme = (liste, champ) => liste.reduce((s, l) => s + l[champ], 0);
  const total = { ventes: somme(lignes, "ventes"), depenses: somme(lignes, "depenses"), benefice: somme(lignes, "benefice"),
    credits: somme(lignes, "credits"), accordes: somme(lignes, "accordes"), rembourses: somme(lignes, "rembourses"), operations: somme(lignes, "nb") };
  let ventesPrecedentes = 0;
  for (const [id, v] of precedents) if (ids.has(id)) ventesPrecedentes += v.ventes;

  // Évolution sur les 3 mois qui se terminent avec la période
  const dernier = partiesLocales(new Date(p.fin.getTime() - 1));
  const mois = [];
  for (let k = 2; k >= 0; k--) {
    const debutMois = minuit(dernier.annee, dernier.mois - k, 1);
    let finMois = minuit(dernier.annee, dernier.mois - k + 1, 1);
    if (finMois > new Date()) finMois = new Date();
    const ch = await chiffresParCommercante(org.id, debutMois, finMois, p.groupe);
    let ventes = 0, depenses = 0, nb = 0;
    for (const [id, v] of ch) {
      if (!ids.has(id)) continue;
      ventes += v.ventes; depenses += v.depenses;
      if (v.ventes > 0 || v.depenses > 0) nb++;
    }
    mois.push({ libelle: debutMois.toLocaleDateString("fr-FR", { timeZone: FUSEAU, month: "long", year: "numeric" }), ventes, depenses, benefice: ventes - depenses, nb });
  }

  // Comparaison des groupes
  const parGroupe = new Map();
  for (const l of lignes) {
    const nom = l.c.groupe_nom || "Sans groupe";
    if (!parGroupe.has(nom)) parGroupe.set(nom, { nom, inscrites: 0, actives: 0, ventes: 0, benefice: 0 });
    const g = parGroupe.get(nom);
    g.inscrites++;
    if (l.activee && l.jours > 0) g.actives++;
    g.ventes += l.ventes;
    g.benefice += l.benefice;
  }

  // Points d'attention : seulement pour une période qui se termine aujourd'hui
  const alertes = p.jusquAujourdhui ? await calculerAlertes(org.id, p.groupe, (n) => montant(n, org.devise)) : null;
  return { lignes, activees, actives, total, ventesPrecedentes, nbJoursPeriode, mois, groupes: [...parGroupe.values()].sort((x, y) => y.ventes - x.ventes), alertes };
}

// Styles propres au rapport, dont la mise en page pour l'impression (PDF)
const STYLE_RAPPORT = `<style>
.filtres-rapport{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.2fr) auto;gap:12px;align-items:end;margin-bottom:16px}
.boutons-rapport{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:20px}
.entete-rapport{border-bottom:2px solid var(--accent);padding-bottom:14px;margin-bottom:20px}
.entete-rapport .marque-rapport{font-size:13px;color:var(--doux);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.entete-rapport h1{margin-bottom:6px}
.rapport h2{font-size:15px;margin-bottom:12px}
.rapport .numero{color:var(--accent);margin-right:6px}
.methode p{font-size:13px;color:var(--doux);margin:0 0 8px}
@media(max-width:860px){.filtres-rapport{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.filtres-rapport>div:last-child{grid-column:1/-1}}
@media print{
  @page{size:A4;margin:14mm}
  body{background:#fff !important;font-size:12px}
  .barre-laterale,.entete-mobile,.voile,.ne-pas-imprimer{display:none !important}
  .cadre{display:block !important}
  main{padding:0 !important}
  .contenu{max-width:none !important}
  .bloc{border:1px solid #ddd !important;padding:12px 14px !important;margin-bottom:12px !important;break-inside:avoid;page-break-inside:avoid}
  .chiffres{grid-template-columns:repeat(4,minmax(0,1fr)) !important;gap:8px !important;margin-bottom:12px !important}
  .chiffre{padding:10px 12px !important}
  .chiffre .valeur{font-size:15px !important}
  table.responsive{display:table !important;width:100% !important}
  table.responsive tbody{display:table-row-group !important}
  table.responsive thead{display:table-header-group !important}
  table.responsive tr{display:table-row !important;border:0 !important;padding:0 !important;margin:0 !important;break-inside:avoid}
  table.responsive td{display:table-cell !important;text-align:left !important;padding:6px 8px !important;border-bottom:1px solid #ddd !important}
  table.responsive td.montant{text-align:right !important}
  table.responsive td::before{content:none !important}
  th,td{font-size:11px !important}
}
</style>`;

// =====================================================================
// PAGE RAPPORTS
// =====================================================================
router.get("/rapports", exigerConnexion, a(async (req, res) => {
  const o = req.organisation;
  const m = (n) => montant(n, o.devise);
  const p = await lireParametres(req);
  const r = await calculerRapport(o, p);

  const nomGroupe = p.groupe === "aucun" ? "Sans groupe" : p.groupe ? (p.groupes.find((g) => g.id === p.groupe)?.nom || "") : "Tous les groupes";
  const lienExport = "/rapports/export?" + new URLSearchParams({ periode: p.periode, du: p.du, au: p.au, groupe: p.groupe ? String(p.groupe) : "" }).toString();

  // Formulaire des choix
  const optionsPeriodes = Object.entries(PERIODES).map(([cle, lib]) => `<option value="${cle}" ${cle === p.periode ? "selected" : ""}>${lib}</option>`).join("");
  const optionsGroupes = `<option value="">Tous les groupes</option>` +
    p.groupes.map((g) => `<option value="${g.id}" ${g.id === p.groupe ? "selected" : ""}>${esc(g.nom)}</option>`).join("") +
    (p.groupes.length ? `<option value="aucun" ${p.groupe === "aucun" ? "selected" : ""}>Sans groupe</option>` : "");
  const formulaire = `<form class="filtres-rapport ne-pas-imprimer" method="get" action="/rapports" id="choix-rapport">
      <div><label for="periode">Période</label><select id="periode" name="periode">${optionsPeriodes}</select></div>
      <div><label for="du">Du</label><input type="date" id="du" name="du" value="${p.du}"></div>
      <div><label for="au">Au</label><input type="date" id="au" name="au" value="${p.au}"></div>
      <div><label for="groupe">Groupe</label><select id="groupe" name="groupe">${optionsGroupes}</select></div>
      <div><button type="submit" class="secondaire">Afficher</button></div>
    </form>
    <script>(function(){var f=document.getElementById("choix-rapport"),p=document.getElementById("periode");
      ["du","au"].forEach(function(id){document.getElementById(id).addEventListener("change",function(){p.value="perso";});});
      p.addEventListener("change",function(){if(p.value!=="perso")f.submit();});
      document.getElementById("groupe").addEventListener("change",function(){f.submit();});})();</script>
    <div class="boutons-rapport ne-pas-imprimer">
      <button type="button" onclick="window.print()">Télécharger en PDF</button>
      <a class="bouton" style="background:#fff;color:var(--texte);border-color:var(--bord)" href="${esc(lienExport)}">Exporter en Excel</a>
      <span class="petit">Pour le PDF, choisissez « Enregistrer au format PDF » dans la fenêtre qui s'ouvre.</span>
    </div>`;

  const entete = `<div class="entete-rapport">
      <div class="marque-rapport">VoixBilan · Rapport de suivi</div>
      <h1>${esc(o.nom)}</h1>
      <p class="sous-titre" style="margin:0">Période : du ${dateLongue(p.debut)} au ${dateLongue(new Date(p.fin.getTime() - 1))} · Groupe : ${esc(nomGroupe)}</p>
      <p class="petit" style="margin:4px 0 0">Rapport généré le ${dateFr(new Date())} (heure du Bénin)</p>
    </div>`;

  if (!r.lignes.length) {
    return res.send(pageApp("Rapports", req, `${STYLE_RAPPORT}${formulaire}<div class="rapport">${entete}${note("orange", "Aucune commerçante n'était inscrite pendant cette période, pour cette sélection.")}</div>`, "rapports"));
  }

  const t = r.total;
  const nbActivees = r.activees.length;
  const nbActives = r.actives.length;
  const joursMoyens = nbActivees ? r.activees.reduce((s, l) => s + l.jours, 0) / nbActivees : 0;
  const regulieres = nbActivees ? r.activees.filter((l) => l.reguliere).length / nbActivees : 0;
  const beneficeMoyen = nbActives ? t.benefice / nbActives : 0;
  let variation = "Pas de données sur la période précédente pour comparer.";
  if (r.ventesPrecedentes > 0) {
    const v = Math.round(((t.ventes - r.ventesPrecedentes) / r.ventesPrecedentes) * 100);
    variation = `Ventes ${v >= 0 ? "en hausse" : "en baisse"} de ${Math.abs(v)} % par rapport à la période précédente de même durée (${m(r.ventesPrecedentes)}).`;
  }
  const chiffre = (libelle, valeur, detail = "") => `<div class="chiffre"><div class="libelle">${libelle}</div><div class="valeur">${valeur}</div>${detail ? `<div class="variation petit">${detail}</div>` : ""}</div>`;

  const lignesMois = r.mois.map((x) => `<tr><td data-label="Mois">${esc(x.libelle)}</td><td data-label="Commerçantes avec des opérations">${x.nb}</td>
    <td data-label="Ventes" class="montant">${m(x.ventes)}</td><td data-label="Dépenses" class="montant">${m(x.depenses)}</td><td data-label="Bénéfice" class="montant">${m(x.benefice)}</td></tr>`).join("");

  const blocGroupes = !p.groupe && r.groupes.length > 1 ? `<div class="bloc"><h2><span class="numero">5.</span>Comparaison des groupes</h2>
    <table class="responsive"><thead><tr><th>Groupe</th><th>Inscrites</th><th>Actives</th><th class="montant">Ventes</th><th class="montant">Bénéfice</th><th class="montant">Bénéfice moyen</th></tr></thead><tbody>
    ${r.groupes.map((g) => `<tr><td data-label="Groupe">${esc(g.nom)}</td><td data-label="Inscrites">${g.inscrites}</td><td data-label="Actives">${g.actives}</td>
      <td data-label="Ventes" class="montant">${m(g.ventes)}</td><td data-label="Bénéfice" class="montant">${m(g.benefice)}</td>
      <td data-label="Bénéfice moyen" class="montant">${m(g.actives ? g.benefice / g.actives : 0)}</td></tr>`).join("")}</tbody></table></div>` : "";
  const n = (x) => (blocGroupes ? x : x - 1); // numérotation des sections

  const lignesDetail = [...r.lignes].sort((x, y) => y.ventes - x.ventes).map((l) => `<tr>
    <td data-label="Commerçante">${esc(l.c.nom)}</td><td data-label="Groupe">${esc(l.c.groupe_nom || "Sans groupe")}</td>
    <td data-label="Jours actifs">${l.jours}</td><td data-label="Ventes" class="montant">${m(l.ventes)}</td>
    <td data-label="Bénéfice" class="montant">${m(l.benefice)}</td><td data-label="À récupérer (fin de période)" class="montant">${m(l.credits)}</td></tr>`).join("");

  let blocAlertes;
  if (!r.alertes) {
    blocAlertes = `<p class="vide">Les points d'attention décrivent la situation actuelle : ils apparaissent pour une période qui se termine aujourd'hui.</p>`;
  } else if (!r.alertes.length) {
    blocAlertes = `<p class="vide">Aucun point d'attention à la date du rapport.</p>`;
  } else {
    blocAlertes = `<table class="responsive"><thead><tr><th>Commerçante</th><th>Motif</th><th>Détail</th></tr></thead><tbody>${r.alertes.map((x) => `<tr>
      <td data-label="Commerçante">${esc(x.c.nom)}</td><td data-label="Motif"><span class="statut ${x.niveau === "alerte" ? "rouge" : "orange"}">${esc(x.motif)}</span></td>
      <td data-label="Détail">${esc(x.detail)}</td></tr>`).join("")}</tbody></table>`;
  }

  res.send(pageApp("Rapports", req, `${STYLE_RAPPORT}${formulaire}
    <div class="rapport">${entete}
      <div class="bloc"><h2><span class="numero">1.</span>Portée</h2>
        <div class="chiffres">
          ${chiffre("Commerçantes inscrites", r.lignes.length, "à la fin de la période")}
          ${chiffre("Activées sur WhatsApp", nbActivees, "à la fin de la période")}
          ${chiffre("Actives sur la période", nbActives, "au moins un message")}
          ${chiffre("Taux d'activité", nbActivees ? pourcent(nbActives / nbActivees) : "—", "actives / activées")}
        </div></div>

      <div class="bloc"><h2><span class="numero">2.</span>Tenue des comptes</h2>
        <div class="chiffres">
          ${chiffre("Jours avec enregistrements", `${joursMoyens.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} / ${r.nbJoursPeriode}`, "en moyenne par commerçante activée")}
          ${chiffre("Commerçantes régulières", nbActivees ? pourcent(regulieres) : "—", "au moins un jour par semaine")}
          ${chiffre("Opérations enregistrées", t.operations.toLocaleString("fr-FR"))}
          ${chiffre("Opérations par commerçante", nbActives ? Math.round(t.operations / nbActives) : 0, "en moyenne, actives")}
        </div></div>

      <div class="bloc"><h2><span class="numero">3.</span>Résultats économiques</h2>
        <div class="chiffres">
          ${chiffre("Ventes", m(t.ventes), "payées et à crédit")}
          ${chiffre("Dépenses et achats", m(t.depenses))}
          ${chiffre("Bénéfice estimé", m(t.benefice))}
          ${chiffre("Bénéfice moyen", m(beneficeMoyen), "par commerçante active")}
        </div>
        <p class="petit" style="margin:0 0 12px">${variation}</p>
        <table class="responsive"><thead><tr><th>Mois</th><th>Commerçantes avec des opérations</th><th class="montant">Ventes</th><th class="montant">Dépenses</th><th class="montant">Bénéfice</th></tr></thead><tbody>${lignesMois}</tbody></table>
      </div>

      <div class="bloc"><h2><span class="numero">4.</span>Crédits accordés aux clients</h2>
        <div class="chiffres">
          ${chiffre("Crédits accordés", m(t.accordes), "sur la période")}
          ${chiffre("Remboursements reçus", m(t.rembourses), "sur la période")}
          ${chiffre("Taux de recouvrement", t.accordes > 0 ? pourcent(t.rembourses / t.accordes) : "—", "remboursés / accordés")}
          ${chiffre("À récupérer auprès des clients", m(t.credits), "à la fin de la période")}
        </div></div>

      ${blocGroupes}

      <div class="bloc"><h2><span class="numero">${n(6)}.</span>Détail par commerçante</h2>
        <table class="responsive"><thead><tr><th>Commerçante</th><th>Groupe</th><th>Jours actifs</th><th class="montant">Ventes</th><th class="montant">Bénéfice</th><th class="montant">À récupérer (fin de période)</th></tr></thead><tbody>${lignesDetail}</tbody></table>
      </div>

      <div class="bloc"><h2><span class="numero">${n(7)}.</span>Points d'attention</h2>${blocAlertes}</div>

      <div class="bloc methode"><h2><span class="numero">${n(8)}.</span>Méthode et limites</h2>
        <p>Les chiffres proviennent des messages (vocaux ou écrits) envoyés par les commerçantes au service WhatsApp VoixBilan, au fil de leurs activités. Ils sont interprétés par une intelligence artificielle, puis enregistrés. Ce sont des données déclarées par les commerçantes : elles ne sont pas auditées.</p>
        <p>Bénéfice estimé = ventes (payées et à crédit) moins dépenses et achats de stock. Une commerçante est « active » si elle a envoyé au moins un message sur la période, et « régulière » si elle a enregistré au moins un jour par semaine en moyenne. Les effectifs (inscrites, activées) et les montants encore dus sont calculés à la fin de la période.</p>
        <p>Les crédits sont ceux que les commerçantes accordent à leurs clients ; ils ne concernent pas les prêts qu'elles reçoivent. Ce rapport ne mesure pas encore les emplois créés, l'épargne ni le pouvoir de décision.</p>
      </div>
    </div>`, "rapports"));
}));

// =====================================================================
// EXPORT EXCEL (fichier CSV)
// =====================================================================
router.get("/rapports/export", exigerConnexion, a(async (req, res) => {
  const o = req.organisation;
  const p = await lireParametres(req);
  const r = await calculerRapport(o, p);
  const cellule = (v) => { const s = String(v ?? ""); return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const entetes = ["Nom", "Groupe", "Langue", "Statut à la fin de la période", "Date d'activation", "Jours actifs", "Opérations", `Ventes (${o.devise})`, `Dépenses (${o.devise})`,
    `Bénéfice (${o.devise})`, `Crédits accordés (${o.devise})`, `Remboursements reçus (${o.devise})`, `Dû à la fin de la période (${o.devise})`, "Dernier message"];
  const lignes = [...r.lignes].sort((x, y) => x.c.nom.localeCompare(y.c.nom, "fr")).map((l) => [
    l.c.nom, l.c.groupe_nom || "Sans groupe", infoLangue(o.pays, l.c.langue || "francais").nom, l.activee ? "Active" : "Pas encore activée",
    l.activee ? dateFr(l.c.activee_le, false) : "", l.jours, l.nb, Math.round(l.ventes), Math.round(l.depenses),
    Math.round(l.benefice), Math.round(l.accordes), Math.round(l.rembourses), Math.round(l.credits), l.c.dernier_message ? dateFr(l.c.dernier_message) : "",
  ]);
  const titre = [[`Rapport VoixBilan : ${o.nom}`], [`Période : du ${p.du} au ${p.au}`], [""]];
  const csv = "\uFEFF" + [...titre, entetes, ...lignes].map((l) => l.map(cellule).join(";")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="voixbilan-rapport-${p.du}-au-${p.au}.csv"`);
  res.send(csv);
}));

module.exports = router;