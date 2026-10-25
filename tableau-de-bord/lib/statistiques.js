// lib/statistiques.js : chiffres par commerçante et alertes
const db = require("./db");
const { debutDuMois, ajouterJours } = require("./temps");

const JOUR = 24 * 3600 * 1000;

function montant(n, devise) {
  const unite = devise === "XOF" || devise === "XAF" ? "F CFA" : devise;
  return `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(n) || 0))} ${unite}`;
}

// Filtre SQL par groupe ("aucun" = sans groupe, un nombre = ce groupe, null = tous)
function filtreGroupe(groupe, params) {
  if (groupe === "aucun") return " AND c.groupe_id IS NULL";
  if (groupe) { params.push(groupe); return " AND c.groupe_id = ?"; }
  return "";
}

// Ventes, dépenses et bénéfice entre deux dates, plus les crédits en cours (depuis le début)
async function chiffresParCommercante(orgId, debut, fin, groupe = null) {
  const params = [debut, fin, debut, fin, orgId];
  const filtre = filtreGroupe(groupe, params);
  const lignes = await db.requete(
    `SELECT o.commercante_id AS id,
       SUM(CASE WHEN o.type IN ('vente','credit_accorde') AND o.date_operation >= ? AND o.date_operation < ? THEN o.montant ELSE 0 END) AS ventes,
       SUM(CASE WHEN o.type IN ('depense','achat_stock') AND o.date_operation >= ? AND o.date_operation < ? THEN o.montant ELSE 0 END) AS depenses,
       SUM(CASE WHEN o.type = 'credit_accorde' THEN o.montant ELSE 0 END) - SUM(CASE WHEN o.type = 'remboursement' THEN o.montant ELSE 0 END) AS credits
     FROM operations o JOIN commercantes c ON c.id = o.commercante_id
     WHERE c.organisation_id = ? AND o.annulee = 0${filtre}
     GROUP BY o.commercante_id`,
    params
  );
  const resultat = new Map();
  for (const l of lignes) {
    const ventes = Number(l.ventes);
    const depenses = Number(l.depenses);
    resultat.set(l.id, { ventes, depenses, benefice: ventes - depenses, credits: Math.max(Number(l.credits), 0) });
  }
  return resultat;
}

function totaux(chiffres) {
  const t = { ventes: 0, depenses: 0, benefice: 0, credits: 0 };
  for (const v of chiffres.values()) { t.ventes += v.ventes; t.depenses += v.depenses; t.benefice += v.benefice; t.credits += v.credits; }
  return t;
}

// Commerçantes actives (non désactivées) de l'organisation, avec leur dernier message
async function listeCommercantes(orgId, groupe = null) {
  const params = [orgId];
  const filtre = filtreGroupe(groupe, params);
  return db.requete(
    `SELECT c.id, c.nom, c.groupe_id, g.nom AS groupe_nom, c.activee_le, c.date_creation,
       (SELECT MAX(m.date_message) FROM messages m WHERE m.commercante_id = c.id) AS dernier_message
     FROM commercantes c LEFT JOIN groupes g ON g.id = c.groupe_id
     WHERE c.organisation_id = ? AND c.actif = 1${filtre} ORDER BY c.nom`,
    params
  );
}

// Règles d'alerte
async function calculerAlertes(orgId, groupe, fmt) {
  const maintenant = new Date();
  const commercantes = await listeCommercantes(orgId, groupe);
  const mois = await chiffresParCommercante(orgId, debutDuMois(), maintenant, groupe);
  const debut7 = ajouterJours(maintenant, -6);
  const debut14 = ajouterJours(maintenant, -13);
  const recents = await chiffresParCommercante(orgId, debut7, maintenant, groupe);
  const precedents = await chiffresParCommercante(orgId, debut14, debut7, groupe);
  const alertes = [];

  for (const c of commercantes) {
    // Pas encore activée après 3 jours
    if (!c.activee_le) {
      const jours = Math.floor((maintenant - new Date(c.date_creation)) / JOUR);
      if (jours >= 3) alertes.push({ niveau: "surveiller", c, motif: "Pas encore activée", detail: `Ajoutée il y a ${jours} jours : le code n'a pas encore été envoyé au bot.` });
      continue;
    }
    // Aucun message depuis 3 jours
    const reference = c.dernier_message ? new Date(c.dernier_message) : new Date(c.activee_le);
    const silence = Math.floor((maintenant - reference) / JOUR);
    if (silence >= 3) {
      alertes.push({ niveau: "surveiller", c, motif: "Aucun message", detail: c.dernier_message ? `Dernier message il y a ${silence} jours.` : `Activée il y a ${silence} jours, aucun message depuis.` });
    }
    // Crédits à récupérer supérieurs à la moitié des ventes du mois
    const m = mois.get(c.id) || { ventes: 0, credits: 0 };
    if (m.credits > 0 && m.credits > 0.5 * m.ventes) {
      alertes.push({ niveau: "alerte", c, motif: "Crédits élevés", detail: `${fmt(m.credits)} à récupérer, pour ${fmt(m.ventes)} de ventes ce mois-ci.` });
    }
    // Bénéfice des 7 derniers jours en baisse de plus de 30 %
    const r = recents.get(c.id)?.benefice || 0;
    const p = precedents.get(c.id)?.benefice || 0;
    if (p > 0 && r < p * 0.7) {
      alertes.push({ niveau: "alerte", c, motif: "Bénéfice en baisse", detail: `${fmt(r)} sur les 7 derniers jours, contre ${fmt(p)} les 7 jours d'avant (${Math.round((1 - r / p) * 100)} % de moins).` });
    }
  }
  return alertes.sort((x, y) => (x.niveau === y.niveau ? 0 : x.niveau === "alerte" ? -1 : 1));
}

module.exports = { montant, chiffresParCommercante, totaux, listeCommercantes, calculerAlertes, filtreGroupe };