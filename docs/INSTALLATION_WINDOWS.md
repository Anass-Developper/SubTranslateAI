# Installer SubTranslateAI sous Windows

## Prérequis

- Windows 10 22H2 ou Windows 11, 64 bits ;
- Chrome ou Microsoft Edge ;
- une carte graphique NVIDIA ou AMD récente avec 8 Go de VRAM recommandés ;
- environ 10 Go d’espace libre pour Ollama, l’application et Hy‑MT2‑7B.

## Installation simplifiée

1. Téléchargez et lancez la dernière version de `SubTranslateAI-Setup-<version>.exe` depuis le [dépôt officiel](https://github.com/Anass-Developper/SubTranslateAI-Releases/releases/latest).
2. Ouvrez SubTranslateAI depuis le Bureau ou le menu Démarrer.
3. Cliquez sur **Tout installer automatiquement**.
4. Confirmez le téléchargement : l’application récupère l’installateur officiel Ollama,
   vérifie sa signature numérique, l’installe dans le profil Windows puis télécharge
   Hy‑MT2‑7B (environ 4,6 Go).
5. Dans la carte **Activer l’extension**, cliquez sur **Ouvrir le dossier**.
6. Cliquez sur **Chrome** ou **Edge**, activez le mode développeur puis choisissez
   **Charger l’extension non empaquetée**.
7. Sélectionnez le dossier ouvert par SubTranslateAI.

Cette dernière étape est imposée tant que l’extension n’est pas publiée dans les boutiques Chrome/Edge. Elle n’est nécessaire qu’une fois par navigateur.

## Utilisation

Laissez SubTranslateAI ouvert pendant la vidéo. Activez une piste de sous-titres dans le
lecteur, puis utilisez le bouton de l’extension pour activer le double sous-titrage.

L’application ne démarre pas avec Windows. Les mises à jour, le délai de traduction, les nouvelles tentatives et la taille du cache sont modifiables dans l’onglet **Réglages**. Quand vous fermez SubTranslateAI, le processus Ollama lancé par l’application est également arrêté.

## Mises à jour

Une version publiée est détectée et téléchargée en arrière-plan. Quand elle est prête,
SubTranslateAI affiche **Redémarrer et installer**. Les mises à jour nécessitent la
version installée par `SubTranslateAI-Setup`, pas l’ancien exécutable portable.

## Dépannage

- Consultez l’onglet **Aide** pour les instructions intégrées.
- Utilisez **Copier le diagnostic** avant de demander de l’aide.
- Si SmartScreen apparaît, c’est parce que l’installateur ne possède pas encore de certificat commercial de signature de code. Vérifiez qu’il vient du dépôt officiel.
- Ollama et les modèles peuvent être désinstallés séparément depuis les paramètres
  Windows. SubTranslateAI ne supprime jamais automatiquement un modèle utilisateur.

## Confidentialité

Cette édition utilise uniquement Ollama et Hy‑MT2‑7B sur `127.0.0.1`. Elle ne contient
aucune clé OpenCode Go et n’envoie pas les sous-titres à une API distante.
