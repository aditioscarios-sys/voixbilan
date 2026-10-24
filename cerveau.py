# cerveau.py : le cerveau de VoixBilan
# Utilisation :
#   python cerveau.py              -> analyse test.ogg
#   python cerveau.py fon1.ogg     -> analyse le vocal fon1.ogg
#   python cerveau.py texte        -> tu écris une phrase (français ou fon)

import os
import sys
import json
import time
from dotenv import load_dotenv
from google import genai
from google.genai import types

# 1. Charger la clé secrète
load_dotenv()
cle = os.getenv("GEMINI_API_KEY")
if not cle:
    print("❌ Clé introuvable. Vérifie ton fichier .env")
    sys.exit()

client = genai.Client(api_key=cle)

# 2. Les modèles Gemini à essayer, dans l'ordre
MODELES = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]

# 3. Les instructions données à l'IA
INSTRUCTIONS = """
Tu es le comptable de VoixBilan, un carnet de comptes pour les commerçantes du Bénin.
La commerçante raconte sa journée, en français ou en fon (fongbé).
Ta mission : trouver chaque opération et répondre UNIQUEMENT en JSON, avec ce format :

{
  "transcription": "ce que la commerçante a dit, mot pour mot, dans sa langue",
  "langue": "francais" ou "fon",
  "traduction_francais": "la traduction en français si elle a parlé fon, sinon null",
  "operations": [
    {
      "type": "vente" | "depense" | "achat_stock" | "credit_accorde" | "remboursement",
      "montant": nombre en FCFA,
      "produit": "texte ou null",
      "quantite": nombre ou null,
      "client": "nom ou null",
      "description": "explication courte"
    }
  ],
  "a_confirmer": "une question si un montant ou un nom n'est pas clair, sinon null"
}

Règles :
- "francs", "F", "CFA" veulent dire FCFA.
- Les montants peuvent être dits en mots, en français ou en fon : convertis-les en nombres.
- Une vente à crédit compte comme "credit_accorde" avec le nom du client.
- Le transport, le repas, le loyer sont des "depense".
- N'invente jamais un montant. Si tu as un doute, remplis "a_confirmer".
"""

# 4. Les formats audio acceptés
TYPES_AUDIO = {
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
}

# 5. Envoyer à l'IA (2 essais par modèle, puis modèle suivant)
def analyser(contenu):
    for modele in MODELES:
        for essai in range(2):
            debut = time.time()
            try:
                reponse = client.models.generate_content(
                    model=modele,
                    contents=contenu,
                    config=types.GenerateContentConfig(
                        system_instruction=INSTRUCTIONS,
                        response_mime_type="application/json",
                        temperature=0,
                        thinking_config=types.ThinkingConfig(thinking_level="minimal" if "lite" in modele else "low"),
                    ),
                )
                duree = round(time.time() - debut, 1)
                print(f"(modèle utilisé : {modele} - réponse en {duree} secondes)")
                return json.loads(reponse.text)
            except Exception as erreur:
                duree = round(time.time() - debut, 1)
                message = str(erreur)[:120]
                print(f"⚠️ {modele} (essai {essai + 1}) n'a pas marché ({duree} s) : {message}")
                if "503" in message or "UNAVAILABLE" in message:
                    time.sleep(5)  # surchargé : on attend 5 secondes et on réessaie
                else:
                    break  # autre erreur : on passe au modèle suivant
    return None

# 6. Programme principal
choix = sys.argv[1] if len(sys.argv) > 1 else "test.ogg"

if choix == "texte":
    texte = input("✍️ Écris la journée de la commerçante : ")
    contenu = [texte]
else:
    fichier = choix
    extension = os.path.splitext(fichier)[1].lower()
    type_mime = TYPES_AUDIO.get(extension)
    if not os.path.exists(fichier) or not type_mime:
        print(f"❌ Fichier introuvable ou format non accepté : {fichier}")
        sys.exit()
    print(f"🎙️ Vocal : {fichier}. Envoi à l'IA...")
    with open(fichier, "rb") as f:
        audio = f.read()
    contenu = [types.Part.from_bytes(data=audio, mime_type=type_mime)]

resultat = analyser(contenu)

if resultat:
    print("\n✅ Résultat :")
    print(json.dumps(resultat, indent=2, ensure_ascii=False))
else:
    print("❌ L'IA n'a pas pu répondre.")