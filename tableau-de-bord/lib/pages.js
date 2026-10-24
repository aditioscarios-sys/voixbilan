// lib/pages.js : mise en page commune (design sobre, sans emoji, responsive)
const { PAYS, ROLES } = require("./reference");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const note = (type, texte) => `<div class="note ${type}">${texte}</div>`;

const CSS = `
:root{--texte:#1c1c1c;--doux:#6b6b6b;--ligne:#e4e4e1;--fond:#f7f7f5;--blanc:#fff;--accent:#24513f;--accent-clair:#eef3f0;--orange:#b45f06;--rouge:#a12622;--bord:#cfcfcb}
*{box-sizing:border-box}
[hidden]{display:none !important}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:"Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.5;background:var(--fond);color:var(--texte)}
h1{font-size:22px;font-weight:600;margin:0;line-height:1.3}
h2{font-size:16px;font-weight:600;margin:0 0 14px}
p{margin:0 0 12px}
a.lien{color:var(--accent);text-decoration:none;font-weight:500}a.lien:hover{text-decoration:underline}
.marque{font-size:18px;font-weight:700;letter-spacing:-.2px}
.petit{color:var(--doux);font-size:13px}.centre{text-align:center}
.sous-titre{color:var(--doux);margin:4px 0 0}

/* Pages d'accès (connexion, inscription...) */
body.acces{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 16px}
.panneau{background:var(--blanc);border:1px solid var(--ligne);border-radius:10px;padding:28px 32px;width:100%;max-width:440px}
.panneau.large{max-width:640px}
.panneau .marque{margin-bottom:16px}
.panneau .sous-titre{margin-bottom:18px}
.pied{color:var(--doux);font-size:13px;margin:12px 0 0;text-align:center}
.progression{font-size:13px;color:var(--doux);margin:0;font-weight:500;text-transform:uppercase;letter-spacing:.04em}
.boutons{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap}

/* Espace connecté */
.cadre{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}
.barre-laterale{position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--blanc);border-right:1px solid var(--ligne);padding:24px 16px;display:flex;flex-direction:column}
.haut-barre{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:28px}
.org{font-size:13px;color:var(--doux);margin-top:2px;overflow-wrap:anywhere}
.barre-laterale nav a,.barre-laterale .bas a{display:block;color:var(--texte);text-decoration:none;padding:9px 12px;border-radius:6px;margin-bottom:2px}
.barre-laterale nav a:hover,.barre-laterale nav a.actif,.barre-laterale .bas a:hover{background:var(--accent-clair);color:var(--accent)}
.bas{margin-top:auto;padding-top:16px;border-top:1px solid var(--ligne)}
.utilisateur{font-size:14px;padding:0 12px 8px;overflow-wrap:anywhere}.utilisateur span{display:block;color:var(--doux);font-size:12px}
main{padding:32px 40px;min-width:0}
.contenu{max-width:1080px;margin:0 auto}
.entete-page{padding-bottom:20px}
.bouton-icone{background:none;border:0;color:var(--texte);padding:6px;height:auto;cursor:pointer;display:inline-flex;align-items:center}
.bouton-icone:hover{opacity:.7}
.entete-mobile,.voile,.barre-laterale .fermer-menu{display:none}

/* Onglets */
.onglets{display:flex;gap:4px;border-bottom:1px solid var(--ligne);margin-bottom:20px;overflow-x:auto}
.onglets a{padding:10px 14px;color:var(--doux);text-decoration:none;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.onglets a:hover{color:var(--texte)}
.onglets a.actif{color:var(--accent);border-bottom-color:var(--accent);font-weight:500}

/* Blocs et tableaux */
.bloc{background:var(--blanc);border:1px solid var(--ligne);border-radius:8px;padding:20px 24px;margin-bottom:20px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:12px 10px;border-bottom:1px solid var(--ligne);vertical-align:middle}
thead th{color:var(--doux);font-weight:500;font-size:13px;white-space:nowrap}
tbody tr:last-child td,tbody tr:last-child th{border-bottom:0}
td .petit{display:block}
.infos th{width:200px;color:var(--doux);font-weight:400;font-size:14px}
.actions{text-align:right;white-space:nowrap}
.actions .en-ligne{justify-content:flex-end}

/* Statuts et messages */
.statut{display:inline-flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap}
.statut::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;flex-shrink:0}
.vert{color:var(--accent)}.orange{color:var(--orange)}.rouge{color:var(--rouge)}
.note{padding:10px 14px;border-left:3px solid currentColor;background:var(--blanc);margin-bottom:16px;font-size:14px;border-radius:0 6px 6px 0}
.panneau .note{background:var(--fond)}
.note a{color:inherit;font-weight:600}

/* Formulaires */
.formulaire{display:grid;gap:16px;max-width:640px}
fieldset{border:0;padding:0;margin:0;display:grid;gap:16px;min-width:0}
legend{font-weight:600;font-size:15px;margin-bottom:6px;padding:0}
.deux{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
label{font-size:14px;font-weight:500;display:block;margin-bottom:6px}
input,select{width:100%;height:42px;padding:0 12px;border:1px solid var(--bord);border-radius:6px;font-size:15px;font-family:inherit;background:var(--blanc);color:var(--texte)}
input:disabled{background:var(--fond);color:var(--doux)}
input:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-clair)}
button,.bouton{height:42px;padding:0 18px;border-radius:6px;font-size:14px;font-family:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;background:var(--accent);color:#fff;border:1px solid var(--accent);white-space:nowrap}
button:hover,.bouton:hover{opacity:.92}
button.secondaire{background:var(--blanc);color:var(--texte);border-color:var(--bord)}
button.danger{background:var(--blanc);color:var(--rouge);border-color:#e7c1bf}
.petit-bouton{height:34px;padding:0 12px;font-size:13px}
.en-ligne{display:inline-flex;gap:8px;align-items:center;margin:0}
.en-ligne select{width:auto;height:34px;font-size:13px;padding:0 8px}
.case{display:flex;gap:10px;align-items:flex-start;font-weight:400;margin:0}
.case input{width:16px;height:16px;margin:3px 0 0;flex-shrink:0}
.mdp{position:relative}.mdp input{padding-right:46px}
.oeil{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:none;border:0;color:var(--doux);padding:8px;height:auto;cursor:pointer;display:flex}
.oeil:hover{color:var(--texte);opacity:1}
.telephone{display:flex}
.telephone span{display:flex;align-items:center;justify-content:center;padding:0 12px;min-width:64px;border:1px solid var(--bord);border-right:0;border-radius:6px 0 0 6px;background:var(--fond);color:var(--doux)}
.telephone input{border-radius:0 6px 6px 0;min-width:0}
.droite{display:flex;justify-content:flex-end;margin-top:-8px}.droite a{font-size:13px}
.ligne-formulaire{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto;gap:12px;align-items:end}

/* Volet repliable (inviter un membre) */
details.volet{margin-bottom:20px}
details.volet>summary{list-style:none;display:inline-flex;align-items:center;height:42px;padding:0 18px;border-radius:6px;background:var(--accent);color:#fff;border:1px solid var(--accent);cursor:pointer;font-size:14px}
details.volet>summary::-webkit-details-marker{display:none}
details.volet[open]>summary{background:var(--blanc);color:var(--texte);border-color:var(--bord)}
.volet-contenu{margin-top:12px}

.etapes{margin:0;padding-left:20px}.etapes li{margin-bottom:8px}
.texte-legal p{margin:0 0 12px}

/* Tablette et téléphone */
@media(max-width:860px){
  .cadre{grid-template-columns:minmax(0,1fr)}
  .entete-mobile{display:flex;position:sticky;top:0;z-index:20;background:var(--blanc);border-bottom:1px solid var(--ligne);padding:10px 16px;align-items:center;justify-content:space-between}
  .barre-laterale{position:fixed;top:0;left:0;bottom:0;width:280px;max-width:85vw;height:auto;z-index:40;transform:translateX(-100%);transition:transform .2s ease;box-shadow:0 0 24px rgba(0,0,0,.12)}
  .menu-ouvert .barre-laterale{transform:none}
  .menu-ouvert .voile{display:block;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:30}
  .barre-laterale .fermer-menu{display:inline-flex}
  main{padding:20px 16px}
  .bloc{padding:16px}
  .deux,.ligne-formulaire{grid-template-columns:minmax(0,1fr)}
  .ligne-formulaire button{width:100%}
  table.responsive thead{display:none}
  table.responsive,table.responsive tbody,table.responsive tr,table.responsive td{display:block;width:100%}
  table.responsive tr{border:1px solid var(--ligne);border-radius:8px;padding:4px 14px;margin-bottom:12px}
  table.responsive td{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--ligne);text-align:right}
  table.responsive tbody tr:last-child td:not(:last-child){border-bottom:1px solid var(--ligne)}
  table.responsive td:last-child{border-bottom:0}
  table.responsive td::before{content:attr(data-label);color:var(--doux);font-size:13px;text-align:left;flex-shrink:0}
  table.responsive td.actions{justify-content:flex-end;flex-wrap:wrap}
  table.responsive td.actions::before{content:none}
  table.responsive td:empty{display:none}
  .infos th{width:40%}
}
@media(max-width:480px){
  .panneau{padding:24px 18px}
  h1{font-size:20px}
  .en-ligne{flex-wrap:wrap;justify-content:flex-end}
  .boutons button{flex:1}
}
`;

const OEIL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const OEIL_BARRE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2"/><path d="M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const ICONE_MENU = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const ICONE_FERMER = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const SCRIPT = `<script>
var OEIL=${JSON.stringify(OEIL)},OEIL_BARRE=${JSON.stringify(OEIL_BARRE)};
document.querySelectorAll("[data-oeil]").forEach(function(b){b.addEventListener("click",function(){
  var i=document.getElementById(b.getAttribute("data-oeil"));var v=i.type==="password";
  i.type=v?"text":"password";b.innerHTML=v?OEIL_BARRE:OEIL;b.setAttribute("aria-label",v?"Masquer le mot de passe":"Afficher le mot de passe");});});
var p=document.getElementById("pays"),ind=document.getElementById("indicatif");
if(p&&ind){var maj=function(){var o=p.options[p.selectedIndex];ind.textContent=o&&o.getAttribute("data-indicatif")?"+"+o.getAttribute("data-indicatif"):"+";};p.addEventListener("change",maj);maj();}
document.querySelectorAll("[data-menu]").forEach(function(e){e.addEventListener("click",function(){
  document.body.classList.toggle("menu-ouvert",e.getAttribute("data-menu")==="ouvrir");});});
document.addEventListener("keydown",function(e){if(e.key==="Escape")document.body.classList.remove("menu-ouvert");});
document.querySelectorAll("form[data-confirmer]").forEach(function(f){f.addEventListener("submit",function(e){
  if(!confirm(f.getAttribute("data-confirmer")))e.preventDefault();});});
document.querySelectorAll("[data-etape-suivante]").forEach(function(b){b.addEventListener("click",function(){
  var etape=b.closest(".etape");var champs=etape.querySelectorAll("input,select");
  for(var i=0;i<champs.length;i++){if(!champs[i].checkValidity()){champs[i].reportValidity();return;}}
  var suivante=etape.nextElementSibling;etape.hidden=true;
  if(suivante){suivante.hidden=false;var c=suivante.querySelector("input,select");if(c)c.focus();window.scrollTo(0,0);}});});
document.querySelectorAll("[data-etape-precedente]").forEach(function(b){b.addEventListener("click",function(){
  var etape=b.closest(".etape");var precedente=etape.previousElementSibling;etape.hidden=true;
  if(precedente){precedente.hidden=false;window.scrollTo(0,0);}});});
</script>`;

function champMotDePasse(nom, libelle, { autocomplete = "current-password", aide = "" } = {}) {
  const id = "mdp-" + nom;
  return `<div><label for="${id}">${libelle}</label><div class="mdp">
    <input id="${id}" name="${nom}" type="password" required autocomplete="${autocomplete}">
    <button type="button" class="oeil" data-oeil="${id}" aria-label="Afficher le mot de passe">${OEIL}</button></div>
    ${aide ? `<div class="petit" style="margin-top:6px">${aide}</div>` : ""}</div>`;
}

function optionsPays(selection = "Bénin") {
  const zones = [...new Set(PAYS.map((p) => p.zone))];
  return zones.map((z) => `<optgroup label="${esc(z)}">${PAYS.filter((p) => p.zone === z)
    .map((p) => `<option value="${esc(p.nom)}" data-indicatif="${p.indicatif}" ${p.nom === selection ? "selected" : ""}>${esc(p.nom)}</option>`).join("")}</optgroup>`).join("");
}

const optionsListe = (liste, selection) => liste.map((x) => `<option value="${esc(x)}" ${x === selection ? "selected" : ""}>${esc(x)}</option>`).join("");

// En-tête de page (titre et sous-titre déjà sécurisés par l'appelant)
const entete = (titre, sousTitre = "") => `<div class="entete-page"><h1>${titre}</h1>${sousTitre ? `<p class="sous-titre">${sousTitre}</p>` : ""}</div>`;

// Onglets : liste de [clé, libellé]
const onglets = (base, liste, actif) => `<nav class="onglets">${liste.map(([cle, libelle]) => `<a href="${base}?onglet=${cle}" class="${cle === actif ? "actif" : ""}">${libelle}</a>`).join("")}</nav>`;

const tete = (titre) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titre)} | VoixBilan</title><style>${CSS}</style></head>`;

function pageAuth(titre, contenu, large = false) {
  return `${tete(titre)}<body class="acces"><div class="panneau${large ? " large" : ""}"><div class="marque">VoixBilan</div>${contenu}</div>
  <p class="pied">Carnet de comptes vocal pour les commerçantes</p>${SCRIPT}</body></html>`;
}

function pageApp(titre, req, contenu, actif = "") {
  const u = req.utilisateur;
  const o = req.organisation;
  const lien = (href, texte, cle) => `<a href="${href}" class="${actif === cle ? "actif" : ""}">${texte}</a>`;
  const menu = [lien("/", "Tableau de bord", "accueil")];
  if (u.role === "administrateur") menu.push(lien("/equipe", "Équipe", "equipe"));
  menu.push(lien("/parametres", "Paramètres", "parametres"));
  return `${tete(titre)}<body>
  <header class="entete-mobile"><span class="marque">VoixBilan</span><button type="button" class="bouton-icone" data-menu="ouvrir" aria-label="Ouvrir le menu">${ICONE_MENU}</button></header>
  <div class="voile" data-menu="fermer"></div>
  <div class="cadre">
    <aside class="barre-laterale">
      <div class="haut-barre"><div><div class="marque">VoixBilan</div><div class="org">${esc(o.nom)}</div></div>
        <button type="button" class="bouton-icone fermer-menu" data-menu="fermer" aria-label="Fermer le menu">${ICONE_FERMER}</button></div>
      <nav>${menu.join("")}</nav>
      <div class="bas"><div class="utilisateur">${esc(u.nom)}<span>${esc(ROLES[u.role])}</span></div><a href="/deconnexion">Se déconnecter</a></div>
    </aside>
    <main><div class="contenu">${contenu}</div></main>
  </div>${SCRIPT}</body></html>`;
}

module.exports = { esc, note, champMotDePasse, optionsPays, optionsListe, entete, onglets, pageAuth, pageApp };