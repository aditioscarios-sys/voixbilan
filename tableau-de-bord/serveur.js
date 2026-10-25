// serveur.js : point de départ du tableau de bord VoixBilan
require("dotenv").config();
const express = require("express");
const { chargerSession } = require("./lib/session");
const { pageAuth } = require("./lib/pages");

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false }));

// En-têtes de sécurité
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use(chargerSession);
app.use(require("./routes/auth"));
app.use(require("./routes/compte"));
app.use(require("./routes/commercantes"));
// Page introuvable
app.use((req, res) => {
  res.status(404).send(pageAuth("Page introuvable", `<h1>Page introuvable</h1><p class="sous-titre">Cette page n'existe pas.</p><a class="bouton" href="/">Retour</a>`));
});

// Erreur inattendue
app.use((err, req, res, next) => {
  console.error("Erreur :", err);
  res.status(500).send(pageAuth("Erreur", `<h1>Une erreur est survenue</h1><p class="sous-titre">Merci de réessayer dans un instant.</p><a class="bouton" href="/">Retour</a>`));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Tableau de bord VoixBilan : http://localhost:${PORT}`));