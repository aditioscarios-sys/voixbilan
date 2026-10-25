// lib/demo.js : compte de démonstration (actions bloquées pour que tous les visiteurs puissent tester)
const EMAIL_DEMO = () => (process.env.DEMO_EMAIL || "demo@voixbilan.com").toLowerCase();
const estDemo = (req) => !!req.utilisateur && req.utilisateur.email === EMAIL_DEMO();

// Actions interdites dans le compte de démonstration
const ACTIONS_BLOQUEES = [
  /^\/parametres\//,                          // organisation, profil, mot de passe
  /^\/equipe\//,                              // invitations, rôles, désactivation
  /^\/commercantes\/\d+\/(supprimer|statut)$/, // supprimer ou désactiver une commerçante
  /^\/groupes\/supprimer$/,                   // supprimer un groupe
];

function protegerDemo(req, res, next) {
  if (req.method === "POST" && estDemo(req) && ACTIONS_BLOQUEES.some((r) => r.test(req.path))) {
    const { pageApp, entete } = require("./pages");
    return res.status(403).send(pageApp("Action indisponible", req,
      `${entete("Action indisponible en démonstration", "Pour que tous les visiteurs puissent tester, ce compte ne permet pas de modifier les paramètres ou l'équipe, ni de supprimer ou désactiver des commerçantes.")}
       <a class="bouton" href="javascript:history.back()">Retour</a>`));
  }
  next();
}

module.exports = { EMAIL_DEMO, estDemo, protegerDemo };