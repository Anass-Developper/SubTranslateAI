# Publier une mise à jour Windows sans publier le code source

SubTranslateAI utilise deux dépôts GitHub séparés :

- `SubTranslateAI-source`, **privé**, contient tout le projet et le workflow de build ;
- `SubTranslateAI-releases`, **public**, contient seulement un README minimal et les
  Releases téléchargeables par l’application.

Ne rendez jamais le dépôt source public. GitHub joint automatiquement aux Releases les
archives du dépôt qui les héberge : les Releases doivent donc être créées uniquement
dans le dépôt public minimal.

## 1. Créer le dépôt public de diffusion

Créez un dépôt GitHub public nommé `SubTranslateAI-releases` avec un simple README, par
exemple :

```markdown
# SubTranslateAI — téléchargements

Ce dépôt contient uniquement les installateurs officiels et les fichiers nécessaires
aux mises à jour automatiques. Le code source de SubTranslateAI n'est pas publié ici.
```

N’ajoutez jamais le projet, une archive du projet, un fichier `.env`, une clé ou un
secret dans ce dépôt.

## 2. Créer le jeton de publication

Dans les paramètres GitHub du compte, créez un **fine-grained personal access token** :

- accès limité uniquement à `SubTranslateAI-releases` ;
- permission du dépôt `Contents: Read and write` ;
- durée d’expiration courte, puis renouvelez-le lorsqu’elle arrive à échéance.

Dans le dépôt source privé, ouvrez **Settings > Secrets and variables > Actions** puis
ajoutez :

| Type     | Nom                   | Valeur                                     |
| -------- | --------------------- | ------------------------------------------ |
| Variable | `RELEASES_REPOSITORY` | `proprietaire/SubTranslateAI-releases`     |
| Secret   | `RELEASES_TOKEN`      | le jeton finement limité créé précédemment |

Le jeton reste exclusivement dans les secrets GitHub Actions. Il ne doit jamais être
placé dans le code, l’installateur ou l’application installée.

## 3. Publier la première version

1. Vérifiez que la version de `apps/desktop/package.json` est la bonne.
2. Exécutez `npm run check`.
3. Créez un tag strictement identique à cette version, avec le préfixe `v`.
4. Poussez le tag vers le dépôt source privé.

Exemple pour la version `1.1.0` :

```powershell
git tag v1.1.0
git push origin v1.1.0
```

Le workflow `.github/workflows/release-windows.yml` exécute les tests, construit
l’installateur avec l’URL du dépôt public, puis y publie :

- `SubTranslateAI-Setup-<version>.exe` ;
- `SubTranslateAI-Setup-<version>.exe.blockmap` ;
- `latest.yml`.

La licence propriétaire est copiée dans les ressources de l’application installée.

Le workflow s’arrête avant la publication si le secret manque, si le nom du dépôt est
incorrect ou si le tag ne correspond pas à la version de l’application.

## 4. Publier les versions suivantes

1. Modifiez le logiciel dans le dépôt privé.
2. Augmentez `version` dans `apps/desktop/package.json`.
3. Exécutez `npm run check`.
4. Créez et poussez le nouveau tag.

Ne réutilisez jamais un numéro : l’auto-update n’installe que les versions strictement
supérieures à celle déjà présente.

## Construction locale

Pour construire manuellement un installateur connecté au dépôt public :

```powershell
$env:RELEASES_REPOSITORY = 'proprietaire/SubTranslateAI-releases'
npm run package:windows
```

Pour utiliser un autre hébergeur HTTPS statique :

```powershell
$env:SUBTRANSLATE_UPDATE_URL = 'https://exemple.fr/subtranslateai/updates'
npm run package:windows
```

Dans les deux cas, vérifiez le fichier `release/desktop/latest.yml` et téléversez
ensemble l’installateur, son `.blockmap` et `latest.yml`.

## Limite de confidentialité

Le dépôt public ne révèle pas le dépôt source, mais l’installateur reste téléchargeable
par toute personne connaissant son adresse. Un programme Electron peut être analysé :
ce schéma protège le code source original, pas contre toute rétro-ingénierie.
