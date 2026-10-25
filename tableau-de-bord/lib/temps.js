// lib/temps.js : dates et heures à l'heure locale de VoixBilan (et non à celle du serveur)
const FUSEAU = process.env.FUSEAU || "Africa/Porto-Novo";

const dateFr = (d, avecHeure = true) => (d ? new Date(d).toLocaleString("fr-FR", {
  timeZone: FUSEAU, day: "2-digit", month: "2-digit", year: "numeric",
  ...(avecHeure ? { hour: "2-digit", minute: "2-digit" } : {}),
}) : "—");

// Décalage (en millisecondes) entre l'heure locale et l'heure universelle
function decalage(instant) {
  const local = new Date(instant.toLocaleString("en-US", { timeZone: FUSEAU }));
  const universel = new Date(instant.toLocaleString("en-US", { timeZone: "UTC" }));
  return local.getTime() - universel.getTime();
}

// Année, mois (1-12), jour et jour de la semaine (1 = lundi) à l'heure locale
function partiesLocales(instant = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: FUSEAU, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
    .formatToParts(instant).map((x) => [x.type, x.value]));
  const jours = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { annee: Number(p.year), mois: Number(p.month), jour: Number(p.day), jourSemaine: jours[p.weekday] };
}

// Minuit (heure locale) d'une date donnée
function minuit(annee, mois, jour) {
  const approx = new Date(Date.UTC(annee, mois - 1, jour));
  return new Date(approx.getTime() - decalage(approx));
}

const debutDuJour = (instant = new Date()) => { const p = partiesLocales(instant); return minuit(p.annee, p.mois, p.jour); };
const debutDuMois = (decalageMois = 0) => { const p = partiesLocales(); return minuit(p.annee, p.mois + decalageMois, 1); };
const debutDeSemaine = (instant = new Date()) => { const p = partiesLocales(instant); return minuit(p.annee, p.mois, p.jour - (p.jourSemaine - 1)); };
const ajouterJours = (instant, n) => { const p = partiesLocales(instant); return minuit(p.annee, p.mois, p.jour + n); };
const nomMois = (instant = new Date()) => instant.toLocaleString("fr-FR", { timeZone: FUSEAU, month: "long" });
const jourMois = (instant) => instant.toLocaleString("fr-FR", { timeZone: FUSEAU, day: "2-digit", month: "2-digit" });

module.exports = { FUSEAU, dateFr, partiesLocales, minuit, debutDuJour, debutDuMois, debutDeSemaine, ajouterJours, nomMois, jourMois };