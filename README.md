# Dual Subtitles — sous-titres français et chinois simultanés

Dual Subtitles est une extension locale pour Chrome et Edge qui affiche, pendant la
lecture d’une vidéo, deux lignes synchronisées : le français et le chinois simplifié.
Elle prend en charge directement YouTube, Netflix, Amazon Prime Video, CANAL+ et Apple
TV+. Une autre plateforme HTTPS peut être activée pour son domaine depuis le popup.

Le projet est conçu pour un usage personnel : l’extension lit la piste textuelle déjà
chargée par le lecteur quand elle est accessible, la traduit en avance par petits lots,
et retombe sur le texte visible dans la page si la piste complète n’est pas disponible.
Il ne télécharge pas la vidéo, ne capture pas l’audio, ne fait pas d’OCR et ne contourne
aucun DRM.

> **Important :** il faut activer un sous-titre natif dans le lecteur. Sans texte de
> sous-titre présent dans la page, l’extension n’a rien à traduire.

## Installation simple pour Windows

La version destinée aux utilisateurs ne demande ni Node.js, ni terminal, ni fichier
`.env`. Lancez `SubTranslateAI-Setup-<version>.exe`, ouvrez l’application puis cliquez sur
**Tout installer automatiquement**. SubTranslateAI installe l’outil officiel Ollama,
vérifie sa signature numérique et télécharge uniquement Hy‑MT2‑7B.

L’application contient trois écrans :

- **Accueil** : installation en un clic, état du serveur et activation de l’extension ;
- **Réglages** : démarrage Windows, mises à jour, délais, reprises, cache et statistiques ;
- **Aide** : mode d’emploi, dépannage et copie d’un diagnostic sans données de navigation.

Le guide utilisateur se trouve dans
[docs/INSTALLATION_WINDOWS.md](docs/INSTALLATION_WINDOWS.md). Le processus de publication
des mises à jour est décrit dans
[docs/PUBLIER_UNE_MISE_A_JOUR.md](docs/PUBLIER_UNE_MISE_A_JOUR.md).

Le dépôt contenant ce code doit rester **privé**. Les installateurs et les métadonnées
de mise à jour sont publiés dans un second dépôt GitHub public qui ne contient aucun
code source du logiciel.

## Ce que fait l’application

Pour chaque nouvelle ligne détectée :

- si la source est en français, le français original est conservé et seul le chinois
  est traduit ;
- si la source est en chinois, le chinois original est conservé et seul le français
  est traduit ;
- pour une autre langue, les versions française et chinoise sont produites ;
- le français et le chinois sont affichés ensemble dans un overlay indépendant du
  sous-titre natif.

Quand le lecteur expose une piste WebVTT, SRT, TTML/DFXP/IMSC ou timedtext YouTube,
l’extension commence le préchargement dès que la piste active est identifiée, avant même
la première ligne visible. Elle traduit les cues proches par lots prioritaires de quatre,
puis le reste en arrière-plan par lots allant jusqu’à douze. Un seek repriorise
automatiquement le nouveau passage.
Le bridge sait également suivre une playlist HLS déclarée comme `SUBTITLES` et regrouper
ses segments WebVTT, sans suivre les playlists audio ou vidéo.

La traduction peut utiliser **Ollama en local**, OpenCode Go, ou un mode hybride qui
essaie d’abord le modèle local puis emploie OpenCode Go uniquement en cas d’erreur. Le
modèle local recommandé est `Hy-MT2-7B` Q4 ; il tient sur une carte NVIDIA de 8 Go et
reste chargé trente minutes après le dernier appel. La clé API éventuelle reste
exclusivement dans le fichier `.env` du serveur local. Elle n’est jamais incluse dans
l’extension ni enregistrée dans `chrome.storage`.

## Architecture

```text
SubTranslateAI/
├── apps/
│   ├── extension/       Extension Chrome/Edge Manifest V3
│   └── local-server/    API Fastify, Ollama local et client OpenCode Go
├── packages/
│   └── shared/          Schémas Zod et types partagés
├── docs/
│   └── SELECTORS.md     Maintenance des sélecteurs des plateformes
├── .env.example
├── eslint.config.js
├── package.json
├── tsconfig.base.json
└── README.md
```

Le flux de données possède deux chemins complémentaires :

```text
Piste horodatée chargée par le lecteur ──→ parseur VTT/SRT/TTML/JSON
                 │                                  │
                 │ indisponible                     ↓ lots prioritaires
                 ↓
Sous-titre visible ──→ MutationObserver ──→ traduction temps réel de secours
                                                    │
                                                    ↓
Serveur http://127.0.0.1:47831
        ↓ cache mémoire → cache SQLite → Ollama → OpenCode Go en secours
Réponse { sourceLanguage, fr, zh }
        ↓
Overlay français + chinois
```

Le fournisseur choisi reçoit uniquement les textes des cues, leurs identifiants
techniques et deux à quatre lignes de contexte. Les timecodes, cookies, URL signées,
manifestes, titre de la vidéo et historique de navigation ne lui sont jamais envoyés.
En mode `ollama`, aucun texte ne quitte la machine.

## Prérequis sous Windows

- Windows 10 ou Windows 11 en 64 bits ;
- Chrome 111+ ou une version récente de Microsoft Edge fondée sur Chromium ;
- Node.js 20.18 ou plus récent et npm 10.8 ou plus récent ;
- Ollama avec un modèle local, ou un abonnement OpenCode Go et une clé API valide ;
- un sous-titre textuel disponible sur la plateforme.

`better-sqlite3` fournit généralement un binaire Windows précompilé. Si son installation
doit compiler le module sur votre machine, installez également Python 3 et **Visual Studio
Build Tools 2022**, avec la charge de travail « Développement Desktop en C++ ».

## 1. Installer Node.js

### Méthode simple avec winget

Ouvrez PowerShell puis exécutez :

```powershell
winget install OpenJS.NodeJS.LTS
```

Fermez et rouvrez PowerShell, puis vérifiez l’installation :

```powershell
node --version
npm --version
```

Vous pouvez aussi télécharger la version LTS depuis le site officiel de Node.js. Évitez
d’installer les dépendances du projet avec plusieurs gestionnaires différents : les
commandes de ce guide utilisent npm et le fichier `package-lock.json` qu’il génère.

## 2. Installer les dépendances

Placez-vous à la racine du dépôt, c’est-à-dire dans le dossier qui contient ce README :

```powershell
cd C:\chemin\vers\SubTranslateAI
npm install
```

Une seule installation à la racine suffit. npm détecte les trois workspaces
`@dual-subtitles/shared`, `@dual-subtitles/local-server` et
`@dual-subtitles/extension`.

En cas d’échec concernant `better-sqlite3`, vérifiez d’abord que la version de Node est
prise en charge et que Windows est en 64 bits. Installez les outils de compilation cités
dans les prérequis uniquement si aucun binaire précompilé n’est disponible.

## 3. Créer le fichier `.env` du serveur

Copiez l’exemple dans le dossier du serveur :

```powershell
Copy-Item .env.example apps\local-server\.env
notepad apps\local-server\.env
```

Remplacez la valeur d’exemple par votre clé :

```dotenv
OPENCODE_GO_API_KEY=ma_cle_reelle
```

Ne mettez pas de guillemets autour de la clé et ne partagez jamais ce fichier. Les
fichiers `.env` sont ignorés par Git. La clé ne doit être copiée ni dans les sources de
l’extension, ni dans les outils de développement du navigateur.

Variables reconnues :

| Variable               |                     Valeur par défaut | Rôle                                                                            |
| ---------------------- | ------------------------------------: | ------------------------------------------------------------------------------- |
| `OPENCODE_GO_API_KEY`  |                                aucune | Clé OpenCode Go, requise en mode `opencode` ou comme secours du mode `hybrid`   |
| `TRANSLATION_PROVIDER` |                            `opencode` | `opencode`, `ollama` ou `hybrid`                                                |
| `OLLAMA_ENDPOINT`      |     `http://127.0.0.1:11434/api/chat` | API locale Ollama, obligatoirement en loopback                                  |
| `OLLAMA_MODEL`         | `hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M` | Modèle local demandé à Ollama                                                   |
| `OLLAMA_MODEL_TYPE`    |                               `hy-mt` | `hy-mt`, `translategemma` ou `chat-json`                                        |
| `OLLAMA_CONCURRENCY`   |                                   `2` | Nombre maximal de cues locales traduites en parallèle                           |
| `PORT`                 |                               `47831` | Port HTTP local                                                                 |
| `DATABASE_PATH`        |                 `./data/subtitles.db` | Emplacement du cache SQLite, relatif à `apps/local-server`                      |
| `LOG_LEVEL`            |                                `info` | Niveau des journaux Fastify/Pino                                                |
| `REQUEST_TIMEOUT_MS`   |                               `15000` | Délai maximal d’un appel au fournisseur                                         |
| `PROVIDER_MAX_RETRIES` |                                   `1` | Nombre de nouvelles tentatives après une erreur récupérable ou un JSON invalide |
| `RATE_LIMIT_MAX`       |                                 `120` | Nombre maximal de requêtes dans la fenêtre locale                               |
| `RATE_LIMIT_WINDOW_MS` |                               `60000` | Durée de cette fenêtre en millisecondes                                         |

Pour des raisons de sécurité, l’adresse d’écoute n’est pas configurable : le serveur se
lie exclusivement à `127.0.0.1`. Le rendre accessible sur le réseau local n’est pas un
cas d’usage pris en charge.

### Installer le moteur local recommandé

Sous Windows :

```powershell
winget install --id Ollama.Ollama --exact
ollama pull hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M
```

Puis utilisez dans `apps/local-server/.env` :

```dotenv
TRANSLATION_PROVIDER=hybrid
OLLAMA_MODEL=hf.co/tencent/Hy-MT2-7B-GGUF:Q4_K_M
OLLAMA_MODEL_TYPE=hy-mt
```

`hybrid` garde l’API comme secours en cas de service local arrêté, de modèle absent ou
de réponse invalide. Utilisez `ollama` pour garantir qu’aucun sous-titre ne soit envoyé
à un service distant, ou `opencode` pour conserver exclusivement le comportement
historique. Le serveur préchauffe le modèle en arrière-plan au démarrage afin d’éviter
que la première ligne visible supporte tout le temps de chargement GPU.

### Rejouer le benchmark de traduction

Le corpus contrôlé contient seize dialogues originaux de style film/série, répartis
entre français→chinois et chinois→français :

```powershell
npm run benchmark:translations --workspace @dual-subtitles/local-server -- `
  --providers opencode,translategemma,qwen,qwen35,hymt `
  --output benchmarks/latest-results.json
```

Le candidat généraliste supplémentaire utilise `qwen3.5:9b` et doit être téléchargé
avec `ollama pull qwen3.5:9b` avant de rejouer le comparatif complet.

Le rapport conserve les sorties, les latences, les erreurs, la validité de l’écriture
cible et une similarité chrF indicative. Une reformulation correcte pouvant avoir un
score inférieur à une référence unique, la comparaison automatique doit toujours être
complétée par une lecture bilingue.

## 4. Lancer le serveur local

En développement, avec redémarrage automatique après une modification :

```powershell
npm run dev:server
```

Laissez cette fenêtre PowerShell ouverte pendant la lecture. Dans une deuxième fenêtre,
vérifiez l’état du serveur :

```powershell
Invoke-RestMethod http://127.0.0.1:47831/health
```

Une réponse JSON avec un état sain confirme que l’extension pourra le joindre. Une clé
absente n’empêche pas nécessairement le démarrage ni la lecture du cache, mais toute
nouvelle traduction distante échouera clairement jusqu’à ce qu’une clé soit configurée.

## 5. Compiler l’extension

Pour produire une version complète une fois :

```powershell
npm run build:extension
```

Les fichiers à charger dans le navigateur se trouvent dans :

```text
apps/extension/dist
```

Pendant le développement, utilisez plutôt le mode surveillance :

```powershell
npm run dev:extension
```

Après une recompilation, ouvrez la page des extensions et cliquez sur le bouton de
rechargement de Dual Subtitles. Une extension non empaquetée n’est pas rechargée
automatiquement par Chrome ou Edge.

Pour lancer simultanément le serveur et la surveillance de l’extension :

```powershell
npm run dev
```

`Ctrl+C` arrête les deux processus.

## 6. Charger l’extension non empaquetée dans Chrome

1. Compilez l’extension avec `npm run build:extension`.
2. Ouvrez `chrome://extensions` dans Chrome.
3. Activez **Mode développeur** en haut à droite.
4. Cliquez sur **Charger l’extension non empaquetée**.
5. Sélectionnez le dossier `apps/extension/dist` — le dossier lui-même, pas son parent.
6. Épinglez Dual Subtitles depuis le menu des extensions pour accéder rapidement au
   popup.
7. Ouvrez le popup et utilisez **Tester la connexion** avec le serveur en cours
   d’exécution.

Si le manifeste a changé après une compilation, rechargez explicitement l’extension sur
`chrome://extensions`, puis actualisez l’onglet vidéo.

## 7. Charger l’extension dans Microsoft Edge

1. Compilez l’extension.
2. Ouvrez `edge://extensions`.
3. Activez **Mode développeur**.
4. Cliquez sur **Charger l’extension décompressée**.
5. Sélectionnez `apps/extension/dist`.
6. Épinglez l’extension et testez la connexion depuis son popup.

Edge peut demander de confirmer périodiquement l’utilisation d’extensions en mode
développeur. Ce message n’indique pas une erreur du projet.

## 8. Premier démarrage

1. Lancez le serveur avec `npm run dev:server`.
2. Vérifiez que l’adresse du serveur dans le popup est
   `http://127.0.0.1:47831`.
3. Activez l’extension globalement et pour la plateforme voulue.
4. Pour un site qui n’est pas dans la liste intégrée, ouvrez le popup sur ce site, cliquez
   sur **Activer sur ce site**, puis acceptez l’accès à ce domaine précis. L’onglet est
   rechargé automatiquement.
5. Ouvrez une vidéo et activez un sous-titre natif.
6. Démarrez la lecture jusqu’à l’apparition d’une ligne.

L’overlay affiche le français au-dessus du chinois par défaut. Le popup ou la page
d’options permet de modifier :

- l’activation générale et l’activation par plateforme ;
- l’activation persistante d’un autre site HTTPS, domaine par domaine ;
- l’ordre français/chinois ;
- la taille du texte et sa position verticale ;
- l’opacité du fond et l’ombre de lisibilité ;
- le masquage du sous-titre natif ;
- le mode diagnostic ;
- le préchargement de la piste complète, activé par défaut ;
- l’adresse du serveur et son test de connexion.

L’overlay a `pointer-events: none` : il ne bloque pas les clics, les contrôles du lecteur
ni les interactions en plein écran. Le raccourci **Ctrl+Maj+Y** active ou désactive le
double sous-titre. Il peut être modifié dans `chrome://extensions/shortcuts` ou
`edge://extensions/shortcuts`.

## 9. Activer les sous-titres natifs

### YouTube

Cliquez sur le bouton **Sous-titres (c)** / **CC** du lecteur, puis choisissez une langue
avec l’icône d’engrenage si nécessaire. Les sous-titres créés par l’auteur et les
sous-titres automatiques textuels sont utilisables. Attendez qu’une ligne soit réellement
visible avant de conclure que la détection ne fonctionne pas.

### Netflix

Pendant la lecture, ouvrez **Audio et sous-titres**, puis choisissez une piste de
sous-titres. Netflix peut modifier la structure du lecteur lors d’un changement de profil,
d’épisode ou de mode plein écran ; l’adaptateur observe ces navigations internes sans
exiger normalement d’actualisation.

### Amazon Prime Video

Pendant la lecture, ouvrez l’icône **Sous-titres et audio** puis sélectionnez une langue.
Selon le domaine et la version du lecteur, la structure HTML peut différer. Les domaines
Prime Video ainsi que les pages Amazon Video prises en charge par le manifeste utilisent
le même adaptateur.

### CANAL+

Ouvrez une vidéo, un replay ou un direct sur `www.canalplus.com`, puis choisissez une
piste dans le menu des sous-titres. L’adaptateur reconnaît notamment le rendu textuel de
RxPlayer et conserve le fallback réseau/DOM si le lecteur évolue.

### Apple TV+

Sur `tv.apple.com`, démarrez le programme puis activez une langue depuis le menu des
sous-titres. Les pistes HLS WebVTT peuvent être préchargées lorsqu’elles sont exposées au
lecteur ; sinon la traduction continue ligne par ligne.

### Autres plateformes

Ouvrez le service de streaming, cliquez sur l’icône de l’extension puis sur **Activer sur
ce site**. Chrome ou Edge demande uniquement l’accès au domaine affiché, enregistre les
deux scripts de détection et recharge l’onglet. Le réglage **Autres plateformes** doit
rester activé. Cette activation générique couvre notamment les lecteurs standards Shaka,
Video.js, JW Player, Plyr, Bitmovin et RxPlayer lorsqu’ils exposent du texte accessible.

Choisissez n’importe quelle langue disponible. Si le français est disponible, il sera
conservé tel quel ; même principe pour le chinois. Une piste anglaise ou dans une autre
langue sera traduite vers les deux langues cibles.

## 10. Diagnostic des plateformes

Les lecteurs web évoluent régulièrement. Le mode debug permet de distinguer un problème
de connexion d’un sélecteur devenu obsolète.

1. Vérifiez `/health` et le bouton **Tester la connexion**.
2. Activez **Mode debug** dans le popup ou la page d’options.
3. Rechargez l’extension si elle vient d’être recompilée, puis actualisez l’onglet vidéo.
4. Activez une piste de sous-titres et lisez un passage avec des dialogues.
5. Consultez le panneau de diagnostic dans l’overlay. Il montre le texte détecté, le
   sélecteur retenu, les éléments candidats, l’avancement `preload` de la piste et son
   éventuelle erreur séparée `preload.lastError`.
6. Cliquez sur **Copier les diagnostics** avant de signaler le problème.

Interprétation rapide :

| Observation                                    | Cause probable                                                      | Action                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Aucun candidat et aucun texte                  | Sous-titre inactif ou DOM de la plateforme modifié                  | Réactiver la piste, puis suivre le [guide des sélecteurs](docs/SELECTORS.md)                              |
| Candidats présents, texte vide                 | Conteneur technique, ligne masquée ou sélecteur trop large          | Comparer l’élément visible dans les DevTools et resserrer le sélecteur                                    |
| Texte correct, aucune traduction               | Serveur arrêté, clé/API ou validation en erreur                     | Tester `/health`, consulter le terminal du serveur et le code HTTP                                        |
| `preload.total` reste à `0`                    | La piste interne n’est pas accessible ou son format a changé        | Le fallback DOM continue ; tester une autre piste et conserver le diagnostic                              |
| Le texte est traduit mais l’overlay est absent | Extension désactivée, plateforme désactivée ou style du plein écran | Vérifier les options, le raccourci et quitter/réactiver le plein écran                                    |
| Une ancienne phrase apparaît brièvement        | Requête ancienne en vol                                             | Vérifier que la version courante annule les requêtes obsolètes ; ne pas augmenter exagérément le debounce |

### Contrôle ciblé par plateforme

- **YouTube :** testez d’abord une vidéo publique avec le bouton CC visible. Si le texte
  existe dans le panneau de transcription mais pas à l’écran, activez bien la piste dans
  le lecteur. Lors d’une navigation vers une autre vidéo, laissez apparaître une nouvelle
  ligne : l’adaptateur doit se rattacher au nouveau lecteur.
- **Netflix :** testez hors puis en plein écran. Copiez les diagnostics dans les deux
  modes, car Netflix peut employer des conteneurs différents. Vérifiez que le sous-titre
  natif n’a pas été masqué avant d’avoir validé la détection.
- **Prime Video :** notez le domaine utilisé (`primevideo.com` ou une page Amazon Video)
  et testez hors plein écran. Les classes générées changent souvent ; privilégiez les
  attributs sémantiques et conservez plusieurs sélecteurs de secours.
- **CANAL+ / Apple TV+ :** testez hors puis en plein écran et vérifiez le nom de
  l’adaptateur dans le diagnostic. Pour Apple TV+, `preload.total` peut progresser après
  la découverte de la playlist HLS.
- **Autre site :** si le popup ne peut pas copier le diagnostic, utilisez d’abord
  **Activer sur ce site**, acceptez la permission, puis laissez l’onglet se recharger.

Les sélecteurs centralisés se trouvent dans
`apps/extension/src/adapters/selectors.ts`. La procédure complète de modification, de
test et de retour arrière est décrite dans [docs/SELECTORS.md](docs/SELECTORS.md).

Les diagnostics peuvent contenir le texte actuellement affiché. Relisez-les avant de les
partager ; ils ne doivent jamais contenir de clé API, mais une réplique de dialogue peut
être soumise au droit d’auteur ou révéler ce que vous regardez.

## API locale

Le serveur accepte uniquement les connexions sur `127.0.0.1`. Les routes principales
sont :

| Méthode  | Route              | Usage                                                               |
| -------- | ------------------ | ------------------------------------------------------------------- |
| `GET`    | `/health`          | Vérifier que le serveur répond                                      |
| `POST`   | `/translate`       | Traduire une ligne et consulter/renseigner les caches               |
| `POST`   | `/translate/batch` | Traduire 1 à 40 cues en un appel fournisseur pour les lignes misses |
| `GET`    | `/settings`        | Lire les réglages du serveur                                        |
| `PUT`    | `/settings`        | Mettre à jour les réglages validés                                  |
| `GET`    | `/stats`           | Obtenir les compteurs de traductions et de cache                    |
| `DELETE` | `/cache`           | Vider les caches mémoire et SQLite                                  |

Exemple de requête, utile pour un diagnostic indépendant de l’extension :

```powershell
$body = @{
  id = 'test-1'
  text = "I didn't know you were here."
  detectedLanguage = 'en'
  previousLines = @('Where have you been?', "I've been looking for you.")
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:47831/translate `
  -ContentType 'application/json' `
  -Body $body
```

La réponse respecte cette forme :

```json
{
  "id": "test-1",
  "sourceLanguage": "en",
  "fr": "Je ne savais pas que tu étais ici.",
  "zh": "我不知道你在这里。",
  "cached": false
}
```

Toutes les entrées sont validées avec Zod et la taille du corps est limitée. Le serveur
normalise le texte, élimine les doublons, regroupe les fragments rapprochés côté client
et consulte un LRU en mémoire puis SQLite avant d’appeler le fournisseur choisi. Une traduction
déjà rencontrée peut donc être réutilisée dans une autre vidéo.

La route batch conserve l’ordre des `cueId`, déduplique les textes identiques, sert les
hits directement depuis SQLite et envoie toutes les lignes restantes dans un seul objet
JSON au modèle. Chaque résultat réussi est persisté séparément : un lot partiellement
déjà connu ne retraduit pas les lignes présentes dans le cache.

Avec OpenCode Go, le mode de raisonnement DeepSeek est désactivé afin de
réserver les tokens à la réponse JSON et de réduire la latence. Si un lot renvoie malgré
tout un JSON vide ou tronqué, le serveur le retente puis le divise une seule fois en deux
sous-lots séquentiels ; cette récupération est bornée pour éviter une rafale d’appels.

Le bouton **Vider le cache** appelle `DELETE /cache`. Cette opération supprime les
traductions mémorisées localement ; les lignes suivantes pourront déclencher de nouveaux
appels facturés par votre abonnement.

## Gestion des erreurs

- **Serveur arrêté :** la vidéo n’est jamais bloquée. L’overlay signale discrètement
  « Serveur de traduction indisponible » et la connexion est retentée périodiquement.
- **Aucun sous-titre :** l’overlay reste vide ; activez une piste textuelle dans le lecteur.
- **Clé invalide (`401`) :** corrigez `OPENCODE_GO_API_KEY`, puis redémarrez le serveur.
- **Quota ou cadence (`429`) :** ralentissez les essais et attendez la fin de la fenêtre
  indiquée par le fournisseur ; les lignes déjà en cache restent utilisables.
- **Erreur OpenCode Go (`5xx`) ou réseau :** la ligne originale est conservée. Une
  nouvelle tentative limitée est effectuée ; aucune traduction appartenant à une autre
  phrase ne doit être affichée.
- **Réponse JSON invalide :** le serveur tente d’extraire le JSON, le valide avec Zod,
  puis effectue au plus le nombre de nouvelles tentatives configuré.

## Tests

Exécuter tous les tests des workspaces :

```powershell
npm test
```

Exécuter une suite précise :

```powershell
npm run test --workspace @dual-subtitles/shared
npm run test --workspace @dual-subtitles/local-server
npm run test --workspace @dual-subtitles/extension
```

Les tests couvrent notamment les schémas partagés, la normalisation, les doublons, le
choix des langues, le parsing JSON du fournisseur, les erreurs HTTP, les caches, le
regroupement des fragments, les parseurs de pistes, la priorisation du préchargement,
les réponses batch et les adaptateurs à partir de fixtures HTML.

Mode surveillance dans un workspace :

```powershell
npm run test:watch --workspace @dual-subtitles/extension
```

## Qualité et commandes disponibles

Toutes les commandes suivantes s’exécutent depuis la racine :

| Commande                  | Effet                                                          |
| ------------------------- | -------------------------------------------------------------- |
| `npm run dev`             | Lance le serveur et la compilation surveillée de l’extension   |
| `npm run dev:server`      | Lance uniquement Fastify avec rechargement automatique         |
| `npm run dev:extension`   | Reconstruit l’extension à chaque modification                  |
| `npm run build`           | Compile shared, serveur, puis extension dans cet ordre         |
| `npm run build:shared`    | Compile seulement les types partagés                           |
| `npm run build:server`    | Prépare le package partagé puis compile le serveur             |
| `npm run build:extension` | Prépare le package partagé puis compile l’extension            |
| `npm test`                | Exécute les tests de tous les workspaces                       |
| `npm run lint`            | Analyse tout le monorepo avec ESLint                           |
| `npm run lint:fix`        | Corrige les problèmes ESLint qui peuvent l’être sans ambiguïté |
| `npm run typecheck`       | Exécute les vérifications TypeScript disponibles               |
| `npm run format`          | Formate les fichiers avec Prettier                             |
| `npm run format:check`    | Vérifie le formatage sans modifier les fichiers                |
| `npm run check`           | Enchaîne format, lint, tests et build                          |

## Compilation et lancement en production locale

Construisez tous les composants :

```powershell
npm run build
```

Lancez ensuite le serveur compilé :

```powershell
npm run start --workspace @dual-subtitles/local-server
```

Chargez `apps/extension/dist` comme extension non empaquetée. « Production locale »
signifie ici que le TypeScript a été compilé et que le serveur ne tourne pas sous le
watcher de développement ; il reste volontairement accessible uniquement depuis votre
ordinateur.

Après une mise à jour du code :

1. arrêtez le serveur avec `Ctrl+C` ;
2. exécutez `npm run check` ;
3. relancez le serveur compilé ;
4. rechargez l’extension dans la page des extensions ;
5. actualisez les onglets vidéo déjà ouverts.

## Dépannage

### `npm install` échoue sur `better-sqlite3`

Utilisez une version LTS de Node prise en charge, supprimez uniquement l’installation
incomplète si nécessaire, puis relancez `npm install`. Si npm tente une compilation,
installez Python 3 et Visual Studio Build Tools avec les outils C++. Ne copiez pas un
fichier `.node` téléchargé depuis une source non officielle.

### Le test de connexion échoue

Vérifiez que le terminal du serveur est encore ouvert et que l’URL vaut exactement
`http://127.0.0.1:47831`, sans chemin supplémentaire. Testez `/health` avec PowerShell.
Si vous avez changé `PORT`, appliquez le même port dans les options de l’extension.

### Le serveur répond mais OpenCode Go renvoie `401`

La clé est absente, expirée ou mal copiée. Modifiez `apps/local-server/.env`, vérifiez
qu’il n’existe pas d’espace ou de guillemet ajouté à la valeur, puis redémarrez le
serveur. N’essayez jamais de résoudre ce problème en plaçant la clé dans l’extension.

### Les sous-titres natifs sont visibles mais rien n’est détecté

Activez le mode debug, copiez les diagnostics et consultez
[docs/SELECTORS.md](docs/SELECTORS.md). Vérifiez aussi que la plateforme est activée dans
les options et que l’onglet a été actualisé après le chargement initial de l’extension.

### Le cache SQLite est verrouillé ou non accessible

Arrêtez les autres instances du serveur. Vérifiez que le dossier indiqué par
`DATABASE_PATH` est accessible en écriture et qu’un logiciel de synchronisation ne
verrouille pas le fichier. Ne supprimez pas manuellement les fichiers `-wal` ou `-shm`
pendant que le serveur fonctionne ; utilisez la route ou le bouton de vidage du cache.

### L’overlay gêne le sous-titre natif

Modifiez la position verticale ou activez le masquage du sous-titre natif après avoir
confirmé que la détection fonctionne. Vous pouvez inverser l’ordre des langues et réduire
la taille du texte depuis les options.

## Sécurité, confidentialité et limites

- Le serveur écoute uniquement sur `127.0.0.1`.
- La clé OpenCode Go reste dans `apps/local-server/.env`.
- Seuls les textes du lot courant, leurs `cueId` et quelques lignes précédentes sont
  traités. En mode `ollama`, ils restent entièrement sur la machine.
- Aucune télémétrie et aucune collecte de données ne sont intégrées.
- Le titre, l’URL complète, le profil, l’historique et la vidéo ne sont pas envoyés.
- Les données entrantes et les réponses du modèle sont validées.
- Les requêtes ont une taille, une cadence et un délai maximal limités.

En mode `opencode`, ou lorsqu’un secours distant du mode `hybrid` est déclenché, le texte
nécessaire quitte néanmoins votre ordinateur et est traité par OpenCode Go/DeepSeek.
Choisissez `TRANSLATION_PROVIDER=ollama` si aucun texte ne doit sortir de la machine.

Le préchargement dépend d’interfaces internes des lecteurs : YouTube est généralement le
plus fiable ; Netflix, Prime Video, CANAL+ et Apple TV+ peuvent employer des URL signées,
des Web Workers ou des segments qui changent sans préavis. HLS/WebVTT est pris en charge,
mais les sous-titres `stpp`/`wvtt` encapsulés dans du MP4 ne sont pas encore décodés. Si
l’extraction échoue, le pipeline DOM, les Shadow DOM ouverts et les `video.textTracks`
restent les chemins de secours. Un Shadow DOM fermé, un lecteur dans une iframe tierce ou
un rendu uniquement dans une image/canvas peut rester inaccessible. Les directs ne
peuvent précharger que les cues déjà publiées. Les pistes audio sans texte, Whisper,
l’OCR, la capture vidéo et le contournement des protections de contenu ne sont pas pris
en charge.

## Licence

Le code source est propriétaire et ne doit pas être publié. Le logiciel compilé est
fourni sous une [licence d’utilisation personnelle](LICENSE), non commerciale, non
redistribuable et sans garantie. Les contenus vidéo et les plateformes restent soumis
à leurs propres licences et conditions d’utilisation.
