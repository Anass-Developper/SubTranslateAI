# Guide de maintenance des sélecteurs de sous-titres

YouTube, Netflix, Prime Video, CANAL+ et Apple TV+ peuvent modifier leur lecteur sans
préavis. Ce guide
explique comment identifier un changement de DOM, mettre à jour les sélecteurs sans
affaiblir les autres plateformes et vérifier la correction.

Cette procédure ne sert qu’à lire le texte déjà affiché dans la page. Elle ne doit pas
être utilisée pour accéder au flux vidéo, contourner un DRM, capturer l’audio ou extraire
des sous-titres qui ne sont pas proposés à l’utilisateur.

## Emplacement des sélecteurs

Tous les sélecteurs spécifiques aux plateformes sont centralisés dans :

```text
apps/extension/src/adapters/selectors.ts
```

Les adaptateurs sont séparés pour YouTube, Netflix, Prime Video, CANAL+, Apple TV+ et la
détection générique dans `apps/extension/src/adapters/`. Ne placez pas un sélecteur Netflix directement dans
le content script ou dans le composant d’overlay : la centralisation permet de relire,
tester et annuler facilement une modification.

Les sélecteurs sont essayés dans l’ordre. Placez d’abord le sélecteur le plus précis et
le plus stable, puis les variantes connues, et terminez éventuellement par un secours
plus général. Un secours trop général peut mélanger le dialogue avec les contrôles du
lecteur ou les sous-titres cachés.

## Avant de modifier le code

Éliminez d’abord les causes qui ne viennent pas d’un sélecteur :

1. démarrez le serveur et vérifiez `http://127.0.0.1:47831/health` ;
2. vérifiez que l’extension et la plateforme sont activées ;
3. activez réellement une piste de sous-titres dans le lecteur ;
4. attendez une scène parlée avec une ligne visible ;
5. testez hors plein écran puis en plein écran ;
6. rechargez l’extension et actualisez l’onglet si le code vient d’être recompilé.

Activez ensuite **Mode debug** dans le popup ou la page d’options. Le panneau de
diagnostic de l’overlay affiche :

- le texte actuellement détecté ;
- le sélecteur qui a trouvé ce texte ;
- les éléments candidats présents dans la page ;
- un bouton permettant de copier l’ensemble du diagnostic.

Copiez les diagnostics lorsque la ligne est visible. Faites si possible une capture pour
le mode normal et une autre pour le plein écran. Relisez le texte avant de le partager :
le diagnostic peut contenir une réplique affichée, mais ne doit jamais contenir la clé
API.

## Examiner la page avec les DevTools

1. Mettez la vidéo en pause sur une ligne de sous-titre.
2. Ouvrez les outils de développement avec `F12` ou `Ctrl+Maj+I`.
3. Activez l’outil de sélection avec `Ctrl+Maj+C`.
4. Cliquez directement sur les lettres du sous-titre natif.
5. Dans l’onglet **Elements**, remontez jusqu’au plus petit conteneur qui contient toute
   la ligne visible, mais ni menu ni texte d’accessibilité caché.
6. Notez ses attributs et ceux de ses parents proches.

Dans la Console, vérifiez un candidat sans modifier la page :

```js
document.querySelectorAll('VOTRE_SELECTEUR');
```

Puis inspectez uniquement les textes et leur visibilité :

```js
[...document.querySelectorAll('VOTRE_SELECTEUR')].map((element) => ({
  text: element.textContent?.trim(),
  connected: element.isConnected,
  display: getComputedStyle(element).display,
  visibility: getComputedStyle(element).visibility,
  rect: element.getBoundingClientRect().toJSON(),
}));
```

Ne collez jamais dans la Console un script reçu d’une personne ou d’un site que vous ne
comprenez pas. Les deux commandes ci-dessus ne font que consulter les éléments.

## Choisir un sélecteur robuste

Privilégiez, dans cet ordre approximatif :

1. un attribut stable lié au rôle du composant (`data-*`, rôle ou identifiant lisible) ;
2. une classe sémantique propre aux sous-titres et déjà stable sur plusieurs vidéos ;
3. une relation courte avec un conteneur de lecteur stable ;
4. une combinaison limitée de classes comme sélecteur de secours.

Évitez :

- les classes minifiées ou avec un suffixe qui ressemble à un hash ;
- `:nth-child(...)` et les chemins copiés intégralement par le navigateur ;
- les sélecteurs dépendant d’un texte français comme « Sous-titres » ;
- les attributs qui changent à chaque session ;
- les sélecteurs globaux tels que `span`, `[role="button"]` ou `[aria-live]` seuls ;
- les conteneurs comprenant simultanément l’ancienne ligne masquée et la nouvelle ligne ;
- une dépendance à la position verticale ou à une résolution précise.

Un bon sélecteur doit trouver la ligne dans plusieurs conditions : fenêtre normale, plein
écran, apparition d’une ou deux lignes, changement d’épisode et navigation interne sans
rechargement.

## Mettre à jour `selectors.ts`

Ouvrez le fichier et repérez le tableau de la plateforme concernée. Conservez les
sélecteurs encore utiles : une plateforme peut déployer plusieurs versions de son lecteur
en parallèle. Ajoutez le nouveau sélecteur près du début s’il est précis et stable.

La forme exacte des constantes est celle du fichier courant ; une modification ressemble
conceptuellement à ceci :

```ts
export const PLATFORM_SUBTITLE_SELECTORS = [
  '[data-purpose="subtitle-text"]', // nouveau sélecteur stable et précis
  '.ancienne-classe-encore-utilisee',
  '.secours-plus-general .texte-visible',
] as const;
```

Cet exemple illustre l’ordre et n’est pas un sélecteur garanti pour une plateforme
réelle. Utilisez les attributs observés dans votre page et ne renommez pas une constante
sans mettre à jour son adaptateur et ses tests.

Si le nouveau nœud est un conteneur qui répète le même texte dans plusieurs enfants,
préférez cibler les fragments visibles les plus proches, puis laissez l’adaptateur les
normaliser et les regrouper. Vérifiez qu’une ligne à deux fragments ne devient pas
« Bonjour Bonjour ».

## Points d’attention par plateforme

### YouTube

- Le lecteur est une application monopage : passez d’une vidéo à une autre sans
  actualiser pour tester le rattachement de l’observateur.
- Une ligne peut être composée de plusieurs segments. Vérifiez l’ordre des fragments et
  la disparition correcte de la ligne précédente.
- Ne ciblez pas le panneau de transcription : l’objectif est le texte synchronisé et
  actuellement affiché dans le lecteur.
- Testez les sous-titres automatiques et une piste fournie par l’auteur si disponibles.

### Netflix

- Netflix peut faire coexister un nœud visible et des nœuds destinés à une animation ou
  à l’accessibilité. Filtrez la visibilité et la géométrie plutôt que de prendre le premier
  résultat aveuglément.
- Le DOM peut différer entre fenêtre normale et plein écran.
- Testez un changement d’épisode et l’ouverture/fermeture des contrôles du lecteur.
- Les noms de classes générés sont moins fiables que les attributs ou relations
  structurelles simples.

### Prime Video

- Testez au moins le domaine réellement utilisé : `primevideo.com` ou une page Amazon
  Video. Un déploiement peut différer selon le pays.
- Les contrôles contiennent parfois d’autres textes superposés. Un candidat ne doit pas
  inclure le titre, le bouton audio ou le libellé d’un menu.
- Vérifiez le plein écran et le passage à l’épisode suivant.
- Conservez plusieurs secours raisonnables, car plusieurs lecteurs peuvent être servis
  simultanément.

### CANAL+

- Le lecteur peut s’appuyer sur RxPlayer ; privilégiez les classes sémantiques
  `rxp-texttrack-*` et un conteneur de lecteur stable.
- Testez une vidéo à la demande et un direct, car les chemins de chargement peuvent
  différer.
- Vérifiez le domaine réellement ouvert. `www.canalplus.com` est intégré ; un autre
  domaine peut être autorisé avec **Activer sur ce site**.

### Apple TV+

- Le lecteur peut exposer des pistes HLS segmentées. Vérifiez à la fois le texte détecté
  et l’état `preload` dans le diagnostic.
- Privilégiez les attributs `data-testid`, les rôles de texte et les classes stables du
  lecteur avant un sélecteur fondé sur la structure complète.
- Testez un changement d’épisode et le plein écran sur `tv.apple.com`.

### Adaptateur générique

Le détecteur générique est un dernier recours. Un sélecteur ajouté pour une plateforme
connue doit rester dans la liste dédiée. N’élargissez pas le générique pour corriger un
seul site : cela augmenterait les faux positifs sur toutes les pages.

Le générique connaît toutefois les conteneurs textuels stables de lecteurs réutilisables
comme Shaka Player, Video.js, JW Player, Plyr, Bitmovin et RxPlayer. Il traverse les Shadow
DOM ouverts et utilise en dernier recours les `activeCues` d’une piste
`video.textTracks` en mode `showing`. Un Shadow DOM fermé, une iframe tierce ou un rendu
canvas ne peut pas être corrigé par un simple sélecteur.

## Ajouter ou mettre à jour une fixture de test

Une correction de sélecteur doit être accompagnée d’un cas HTML minimal dans le dossier
de tests de l’extension. La fixture doit reproduire la structure utile, sans copier une
page entière ni un dialogue protégé inutilement.

Gardez seulement :

- le conteneur de lecteur nécessaire ;
- le nœud de sous-titre et ses attributs pertinents ;
- un faux nœud proche pour vérifier l’absence de faux positif, si utile ;
- une courte phrase inventée, par exemple « Ligne de test ».

Le test doit vérifier au minimum :

- que le bon texte est détecté ;
- que le sélecteur rapporté par le mode debug est celui attendu ;
- que les doublons et nœuds cachés ne sont pas renvoyés ;
- que la disparition ou le remplacement de la ligne produit le bon événement ;
- que l’adaptateur se réinitialise après une navigation simulée si ce comportement est
  concerné.

Exécutez les tests de l’extension :

```powershell
npm run test --workspace @dual-subtitles/extension
```

Puis vérifiez les types, le lint et la compilation complète :

```powershell
npm run typecheck --workspace @dual-subtitles/extension
npm run lint
npm run build
```

## Vérification manuelle

Après les tests automatisés :

1. exécutez `npm run build:extension` ;
2. rechargez Dual Subtitles dans `chrome://extensions` ou `edge://extensions` ;
3. actualisez l’onglet de la plateforme ;
4. activez une piste et le mode debug ;
5. observez au moins cinq changements de ligne ;
6. passez en plein écran puis revenez en mode normal ;
7. naviguez vers une autre vidéo ou un autre épisode sans actualiser ;
8. confirmez qu’une ligne vide efface l’overlay et qu’une requête lente ne réaffiche pas
   une traduction appartenant à la ligne précédente ;
9. désactivez le mode debug une fois la vérification terminée.

Idéalement, faites ce contrôle dans Chrome et Edge. Pour Netflix, Prime Video, CANAL+ et Apple TV+, un test
avec le compte et la région où le problème a été observé est plus fiable qu’une hypothèse
fondée uniquement sur une capture.

## Revenir en arrière en cas de régression

Si le nouveau sélecteur produit des faux positifs, retirez seulement la ligne ajoutée ou
replacez-la après les sélecteurs stables. Ne supprimez pas le fichier de sélecteurs et ne
désactivez pas globalement l’adaptateur.

Avant toute correction supplémentaire, conservez :

- le diagnostic avant/après ;
- la plateforme, le domaine et le navigateur ;
- le mode normal ou plein écran ;
- une fixture minimale qui reproduit la régression ;
- la sortie des tests et du build.

Ces éléments permettent de corriger le lecteur concerné sans fragiliser les autres
plateformes et sans collecter de données de navigation.
