// lib/reference.js : listes de référence (pays, monnaies, types, rôles, langues)

const ZONE_A = "Zone A : Afrique de l'Ouest (UEMOA)";
const ZONE_B = "Zone B : Afrique centrale (CEMAC)";
const ZONE_C = "Autre pays francophone";

const PAYS = [
  { nom: "Bénin", zone: ZONE_A, devise: "XOF", indicatif: "229" },
  { nom: "Burkina Faso", zone: ZONE_A, devise: "XOF", indicatif: "226" },
  { nom: "Côte d'Ivoire", zone: ZONE_A, devise: "XOF", indicatif: "225" },
  { nom: "Guinée-Bissau", zone: ZONE_A, devise: "XOF", indicatif: "245" },
  { nom: "Mali", zone: ZONE_A, devise: "XOF", indicatif: "223" },
  { nom: "Niger", zone: ZONE_A, devise: "XOF", indicatif: "227" },
  { nom: "Sénégal", zone: ZONE_A, devise: "XOF", indicatif: "221" },
  { nom: "Togo", zone: ZONE_A, devise: "XOF", indicatif: "228" },
  { nom: "Cameroun", zone: ZONE_B, devise: "XAF", indicatif: "237" },
  { nom: "Centrafrique", zone: ZONE_B, devise: "XAF", indicatif: "236" },
  { nom: "Congo", zone: ZONE_B, devise: "XAF", indicatif: "242" },
  { nom: "Gabon", zone: ZONE_B, devise: "XAF", indicatif: "241" },
  { nom: "Guinée équatoriale", zone: ZONE_B, devise: "XAF", indicatif: "240" },
  { nom: "Tchad", zone: ZONE_B, devise: "XAF", indicatif: "235" },
  { nom: "Guinée-Conakry", zone: ZONE_C, devise: "GNF", indicatif: "224" },
  { nom: "Autre pays", zone: "Autre", devise: "USD", indicatif: "" },
];

const infosPays = (nom) => PAYS.find((p) => p.nom === nom) || PAYS[PAYS.length - 1];

const DEVISES = ["XOF", "XAF", "GNF", "USD", "EUR", "GHS", "NGN"];

const TYPES_ORGANISATION = [
  "ONG", "Association", "Coopérative", "Groupement de femmes",
  "Institution de microfinance", "Programme ou projet public", "Entreprise", "Autre",
];

const ROLES = { administrateur: "Administrateur", agent: "Agent", lecture: "Lecture seule" };
const DESCRIPTION_ROLES = {
  administrateur: "Gère tout, y compris l'équipe et les paramètres.",
  agent: "Ajoute et suit les commerçantes.",
  lecture: "Consulte les chiffres et télécharge les rapports, sans rien modifier.",
};

// Langues des commerçantes
const STATUTS_LANGUE = {
  disponible: "Disponible",
  montants_fr: "Disponible, montants en français",
  experimental: "Expérimental",
  bientot: "Bientôt",
};
const L = (code, nom, statut) => ({ code, nom, statut });
const LANGUES_PAR_PAYS = {
  "Bénin": [L("fon", "Fon", "montants_fr"), L("yoruba", "Yoruba", "experimental"), L("peul", "Peul", "experimental"), L("bariba", "Bariba", "bientot"), L("dendi", "Dendi", "bientot"), L("mina", "Mina", "bientot")],
  "Burkina Faso": [L("moore", "Mooré", "experimental"), L("dioula", "Dioula", "experimental"), L("fulfulde", "Fulfuldé", "experimental"), L("gulmancema", "Gulmancema", "bientot")],
  "Côte d'Ivoire": [L("baoule", "Baoulé", "experimental"), L("dioula", "Dioula", "experimental")],
  "Guinée-Bissau": [L("peul", "Peul", "experimental"), L("kriol", "Kriol", "bientot")],
  "Mali": [L("bambara", "Bambara", "experimental")],
  "Niger": [L("haoussa", "Haoussa", "experimental"), L("zarma", "Zarma", "bientot")],
  "Sénégal": [L("wolof", "Wolof", "experimental"), L("pulaar", "Pulaar", "experimental"), L("serere", "Sérère", "bientot")],
  "Togo": [L("ewe", "Éwé", "experimental"), L("mina", "Mina", "bientot"), L("kabiye", "Kabiyè", "bientot"), L("tem", "Tem", "bientot")],
  "Cameroun": [L("fulfulde", "Fulfuldé", "experimental"), L("ewondo", "Ewondo", "bientot"), L("duala", "Duala", "bientot"), L("basaa", "Basaa", "bientot")],
  "Centrafrique": [L("sango", "Sango", "experimental")],
  "Congo": [L("lingala", "Lingala", "experimental"), L("kituba", "Kituba", "experimental")],
  "Gabon": [L("fang", "Fang", "bientot"), L("punu", "Punu", "bientot")],
  "Guinée équatoriale": [L("fang", "Fang", "bientot")],
  "Tchad": [L("arabe_tchadien", "Arabe tchadien", "bientot"), L("sara", "Sara", "bientot")],
  "Guinée-Conakry": [L("pular", "Pular", "experimental"), L("soussou", "Soussou", "experimental"), L("malinke", "Malinké", "bientot")],
};

// Le français est toujours proposé, en premier
const languesPour = (pays) => [L("francais", "Français", "disponible"), ...(LANGUES_PAR_PAYS[pays] || [])];
const infoLangue = (pays, code) => languesPour(pays).find((l) => l.code === code) || L(code, code, "bientot");

// Consigne à donner à la commerçante selon le statut de sa langue
function consigneLangue(langue) {
  if (langue.statut === "disponible") return "La commerçante peut parler ou écrire en français.";
  if (langue.statut === "montants_fr") return `Expliquez à la commerçante de parler en ${langue.nom}, mais de dire les montants en français.`;
  if (langue.statut === "experimental") return `Le ${langue.nom} est en test : le bot demandera une confirmation avant d'enregistrer chaque message. Les montants dits en français restent les plus fiables.`;
  return `Le ${langue.nom} n'est pas encore compris par l'IA. Pour l'instant, la commerçante parle en français.`;
}

module.exports = { PAYS, infosPays, DEVISES, TYPES_ORGANISATION, ROLES, DESCRIPTION_ROLES, STATUTS_LANGUE, languesPour, infoLangue, consigneLangue };