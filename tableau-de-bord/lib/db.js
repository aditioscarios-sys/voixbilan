// lib/db.js : connexion à la base de données MySQL
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  maxIdle: 2,               // garde au plus 2 connexions inactives
  idleTimeout: 60000,       // ferme une connexion inactive après 1 minute
  enableKeepAlive: true,    // garde les connexions "éveillées"
  keepAliveInitialDelay: 10000,
  connectTimeout: 15000,
  timezone: "Z",
  charset: "utf8mb4",
});

// Erreurs de connexion coupée : on réessaie une fois avec une nouvelle connexion
const ERREURS_CONNEXION = ["ECONNRESET", "PROTOCOL_CONNECTION_LOST", "EPIPE", "ETIMEDOUT", "ECONNREFUSED"];

// Exécute une requête et renvoie les lignes (ou le résultat d'une insertion)
async function requete(sql, params = []) {
  const valeurs = params.map((p) => (p === undefined ? null : p));
  try {
    const [lignes] = await pool.execute(sql, valeurs);
    return lignes;
  } catch (erreur) {
    if (!ERREURS_CONNEXION.includes(erreur.code)) throw erreur;
    console.log(`Connexion à la base coupée (${erreur.code}), nouvel essai...`);
    const [lignes] = await pool.execute(sql, valeurs);
    return lignes;
  }
}

// Renvoie la première ligne, ou null
async function une(sql, params = []) {
  const lignes = await requete(sql, params);
  return lignes[0] || null;
}

// Exécute plusieurs requêtes ensemble : tout réussit, ou rien n'est enregistré
async function transaction(fonction) {
  const connexion = await pool.getConnection();
  try {
    await connexion.beginTransaction();
    const resultat = await fonction(connexion);
    await connexion.commit();
    return resultat;
  } catch (erreur) {
    await connexion.rollback().catch(() => {});
    throw erreur;
  } finally {
    connexion.release();
  }
}

module.exports = { pool, requete, une, transaction };