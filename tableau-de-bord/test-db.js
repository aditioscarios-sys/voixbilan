// test-db.js : vérifie que l'ordinateur arrive à se connecter à la base sur Asura
require("dotenv").config();
const mysql = require("mysql2/promise");

(async () => {
  try {
    const connexion = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    const [lignes] = await connexion.query("SHOW TABLES");
    console.log("Connexion réussie. Tables trouvées :", lignes.map((l) => Object.values(l)[0]).join(", "));
    await connexion.end();
  } catch (erreur) {
    console.log("Erreur de connexion :", erreur.message);
  }
})();