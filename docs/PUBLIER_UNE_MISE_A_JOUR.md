# Publier une mise à jour Windows

SubTranslateAI utilise deux dépôts publics séparés :

- `SubTranslateAI` contient le code source et le workflow de construction ;
- `SubTranslateAI-Releases` contient uniquement les installateurs et les métadonnées utilisées par la mise à jour automatique.

Cette séparation garde un canal de téléchargement simple et empêche les archives automatiques du dépôt source d'apparaître à côté des installateurs.

## Configuration GitHub

Dans les paramètres du dépôt source, créez :

| Type     | Nom                   | Valeur                                     |
| -------- | --------------------- | ------------------------------------------ |
| Variable | `RELEASES_REPOSITORY` | `Anass-Developper/SubTranslateAI-Releases` |
| Secret   | `RELEASES_TOKEN`      | un jeton limité au dépôt de releases       |

Le jeton finement limité doit avoir uniquement `Contents: Read and write` sur `SubTranslateAI-Releases`. Donnez-lui une durée d'expiration et renouvelez-le avant son échéance. Il ne doit jamais être placé dans le code, l'installateur ou un diagnostic.

## Publier une version

1. Augmentez `version` dans `apps/desktop/package.json`.
2. Ajoutez les changements utilisateur dans `CHANGELOG.md`.
3. Exécutez `npm run check`.
4. Committez et poussez les changements sur `main`.
5. Créez un tag strictement identique à la version avec le préfixe `v`, puis poussez-le.

Exemple :

```powershell
git tag v1.2.0
git push origin v1.2.0
```

Le workflow `.github/workflows/release-windows.yml` revérifie le projet, construit l'installateur avec l'URL du canal public, puis publie ensemble :

- `SubTranslateAI-Setup-<version>.exe` ;
- `SubTranslateAI-Setup-<version>.exe.blockmap` ;
- `latest.yml`.

Le workflow s'arrête si le secret manque, si le dépôt cible est invalide ou si le tag ne correspond pas à la version de l'application. Ne réutilisez jamais un numéro de version ou un tag.

## Construction locale

```powershell
$env:RELEASES_REPOSITORY = 'Anass-Developper/SubTranslateAI-Releases'
npm run package:windows
```

Avant toute publication manuelle, vérifiez `release/desktop/latest.yml` et téléversez toujours l'installateur, son `.blockmap` et `latest.yml` dans la même release.

## Sécurité de la chaîne de publication

- protégez le compte GitHub avec une clé d'accès ou une authentification à deux facteurs ;
- ne lancez une release que depuis un commit vérifié sur `main` ;
- examinez les mises à jour Dependabot avant de les fusionner ;
- révoquez immédiatement `RELEASES_TOKEN` s'il apparaît ailleurs que dans GitHub Actions ;
- signez l'installateur Windows dès qu'un certificat de signature de code est disponible.
