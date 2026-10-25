// scripts/demo.js : crée (ou recrée) l'organisation de démonstration avec des données fictives
// Lancer depuis le dossier tableau-de-bord : node scripts/demo.js
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const db = require("../lib/db");
const { chiffrerMotDePasse } = require("../lib/securite");
const { minuit, partiesLocales } = require("../lib/temps");

const EMAIL = (process.env.DEMO_EMAIL || "demo@voixbilan.com").toLowerCase();
const MOT_DE_PASSE = process.env.DEMO_MOT_DE_PASSE || "demo2026";
const NOM_ORG = "Association Femmes du Marché (démonstration)";
const SEMAINES = 8;

// Hasard reproductible : les mêmes données à chaque lancement
let graine = 20261025;
function hasard() { graine = (graine * 1664525 + 1013904223) % 4294967296; return graine / 4294967296; }
const entre = (min, max) => min + hasard() * (max - min);
const arrondi = (n, pas = 50) => Math.max(pas, Math.round(n / pas) * pas);
const choisir = (liste) => liste[Math.floor(hasard() * liste.length)];

// Une date à une heure donnée, n jours avant aujourd'hui (heure du Bénin)
function jourHeure(joursAvant, heure, minute = 0) {
  const p = partiesLocales();
  const m = minuit(p.annee, p.mois, p.jour - joursAvant);
  return new Date(m.getTime() + (heure * 60 + minute) * 60000);
}

// Commerçantes fictives (aucun vrai numéro de téléphone)
const COMMERCANTES = [
  { nom: "Afiavi H.", groupe: "Marché Dantokpa", activite: "Piment et tomates", langue: "fon", base: 9000, regularite: 0.85, clients: ["Maman Céline", "Tantie Reine"] },
  { nom: "Rosine A.", groupe: "Marché Dantokpa", activite: "Pagnes", langue: "francais", base: 22000, regularite: 0.7, clients: ["Madame Ahouandjinou", "Sœur Florence", "Maman Joséphine"], creditsEleves: true },
  { nom: "Bernadette D.", groupe: "Marché Dantokpa", activite: "Poisson fumé", langue: "fon", base: 12000, regularite: 0.8, clients: ["Tantie Pauline", "Maman Odette"] },
  { nom: "Clarisse A.", groupe: "Marché Dantokpa", activite: "Légumes frais", langue: "francais", base: 7000, regularite: 0.75, clients: ["Maman Alice"], silencieuse: 5 },
  { nom: "Germaine K.", groupe: "Marché de Calavi", activite: "Gari et farine de manioc", langue: "fon", base: 10000, regularite: 0.8, clients: ["Tantie Bernadette"], enBaisse: true },
  { nom: "Pélagie Z.", groupe: "Marché de Calavi", activite: "Huile rouge", langue: "francais", base: 15000, regularite: 0.65, clients: ["Maman Rose", "Madame Adjovi"] },
  { nom: "Odile H.", groupe: "Marché de Calavi", activite: "Fruits", langue: "fon", base: 6000, regularite: 0.9, clients: ["Tantie Agnès"] },
  { nom: "Victorine G.", groupe: "Marché de Calavi", activite: "Condiments et épices", langue: "francais", base: 8000, regularite: 0.6, clients: ["Maman Thérèse"] },
  { nom: "Mariette T.", groupe: "Marché de Calavi", activite: "Beignets", langue: "francais", enAttente: true },
];

async function principal() {
  console.log("Création de l'organisation de démonstration...");
  const maintenant = new Date();
  const debut = jourHeure(SEMAINES * 7 + 2, 8);

  // 1. Supprimer l'ancienne démonstration (tout est effacé en cascade)
  const ancien = await db.une("SELECT organisation_id FROM utilisateurs WHERE email = ?", [EMAIL]);
  if (ancien) {
    await db.requete("DELETE FROM organisations WHERE id = ?", [ancien.organisation_id]);
    console.log("Ancienne démonstration supprimée.");
  }

  // 2. Organisation et compte de connexion
  const org = await db.requete(
    "INSERT INTO organisations (nom, type, pays, ville, devise, telephone, date_creation) VALUES (?, 'Association', 'Bénin', 'Cotonou', 'XOF', NULL, ?)",
    [NOM_ORG, debut]
  );
  const orgId = org.insertId;
  await db.requete(
    "INSERT INTO utilisateurs (organisation_id, nom, fonction, email, mot_de_passe, role, email_verifie, actif, date_creation) VALUES (?, 'Compte de démonstration', 'Chargée de suivi', ?, ?, 'administrateur', 1, 1, ?)",
    [orgId, EMAIL, chiffrerMotDePasse(MOT_DE_PASSE), debut]
  );

  // 3. Groupes
  const groupes = {};
  for (const nom of ["Marché Dantokpa", "Marché de Calavi"]) {
    const g = await db.requete("INSERT INTO groupes (organisation_id, nom, type, date_creation) VALUES (?, ?, 'marche', ?)", [orgId, nom, debut]);
    groupes[nom] = g.insertId;
  }

  // 4. Commerçantes, messages et opérations
  let n = 0, nbMessages = 0, nbOperations = 0;
  for (const def of COMMERCANTES) {
    n++;
    const marche = def.groupe.replace("Marché de ", "").replace("Marché ", "");

    // Commerçante ajoutée il y a 4 jours, pas encore activée
    if (def.enAttente) {
      const code = String(100000 + Math.floor(hasard() * 900000));
      await db.requete(
        "INSERT INTO commercantes (organisation_id, groupe_id, nom, langue, activite, marche, accord_suivi, accord_vocaux, code_activation, actif, date_creation) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, 1, ?)",
        [orgId, groupes[def.groupe], def.nom, def.langue, def.activite, marche, code, jourHeure(4, 10)]
      ).catch(() => {});
      console.log(`  ${def.nom} : en attente d'activation`);
      continue;
    }

    const joursDepuis = SEMAINES * 7 - Math.floor(entre(0, 4));
    const activeeLe = jourHeure(joursDepuis, 9);
    const c = await db.requete(
      "INSERT INTO commercantes (organisation_id, groupe_id, nom, identifiant_whatsapp, langue, activite, marche, accord_suivi, accord_vocaux, activee_le, actif, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, 1, ?)",
      [orgId, groupes[def.groupe], def.nom, `demo-${orgId}-${n}`, def.langue, def.activite, marche, activeeLe, new Date(activeeLe.getTime() - 86400000)]
    );
    const dus = {}; // reste dû par client

    for (let j = joursDepuis - 1; j >= 0; j--) {
      if (def.silencieuse && j < def.silencieuse) continue;          // silencieuse depuis quelques jours
      let regularite = def.regularite;
      if (def.enBaisse && j < 7) regularite *= 0.35;                  // activité en baisse cette semaine
      if (hasard() > regularite) continue;
      const date = jourHeure(j, 17 + Math.floor(entre(0, 3)), Math.floor(entre(0, 59)));
      if (date > maintenant) continue;

      const ops = [{ type: "vente", montant: arrondi(def.base * entre(0.7, 1.3)), produit: null, client: null, description: "Ventes de la journée" }];
      if (hasard() < 0.5) ops.push({ type: "depense", montant: arrondi(entre(200, 1200)), produit: "transport", client: null, description: "Transport" });
      if (hasard() < 0.18) ops.push({ type: "achat_stock", montant: arrondi(def.base * entre(1.5, 3)), produit: null, client: null, description: "Achat de marchandises" });
      const client = choisir(def.clients);
      if (hasard() < (def.creditsEleves ? 0.45 : 0.2)) {
        const mt = arrondi(def.base * (def.creditsEleves ? entre(0.8, 1.6) : entre(0.2, 0.6)));
        ops.push({ type: "credit_accorde", montant: mt, produit: null, client, description: `Vente à crédit à ${client}` });
        dus[client] = (dus[client] || 0) + mt;
      } else if (!def.creditsEleves && (dus[client] || 0) > 0 && hasard() < 0.35) {
        const mt = Math.min(dus[client], arrondi(dus[client] * entre(0.4, 1)));
        ops.push({ type: "remboursement", montant: mt, produit: null, client, description: `Remboursement de ${client}` });
        dus[client] -= mt;
      }

      const m = await db.requete(
        "INSERT INTO messages (commercante_id, date_message, type, langue, transcription, intention, modele, statut) VALUES (?, ?, ?, ?, 'Message de démonstration (données fictives)', 'enregistrer', 'demonstration', 'enregistre')",
        [c.insertId, date, hasard() < 0.75 ? "vocal" : "texte", def.langue]
      );
      await db.pool.query(
        "INSERT INTO operations (message_id, commercante_id, date_operation, type, montant, produit, client, description, annulee) VALUES ?",
        [ops.map((op) => [m.insertId, c.insertId, date, op.type, op.montant, op.produit, op.client, op.description, 0])]
      );
      nbMessages++;
      nbOperations += ops.length;
    }
    console.log(`  ${def.nom} : prête`);
  }

  console.log(`\nDémonstration prête : ${n} commerçantes, ${nbMessages} messages, ${nbOperations} opérations.`);
  console.log(`Connexion : ${EMAIL} / ${MOT_DE_PASSE}`);
}

principal()
  .catch((e) => { console.error("Erreur :", e.message); process.exitCode = 1; })
  .finally(() => db.pool.end());