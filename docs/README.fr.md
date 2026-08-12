# SubTranslateAI — guide français

SubTranslateAI affiche des sous-titres français, chinois, ou les deux, à partir d'une piste française, chinoise ou anglaise. La traduction est exécutée localement par Hy-MT2 avec Ollama : aucune clé API ni abonnement n'est nécessaire.

## Installation

1. Téléchargez la dernière version depuis les [releases officielles](https://github.com/Anass-Developper/SubTranslateAI-Releases/releases/latest).
2. Lancez SubTranslateAI puis cliquez sur **Tout installer**. L'application installe Ollama et télécharge environ 4,6 Go pour le modèle.
3. Dans Chrome ou Edge, ouvrez la page des extensions, activez le **Mode développeur**, cliquez sur **Charger l'extension non empaquetée** et choisissez le dossier indiqué dans l'application.
4. Ouvrez une vidéo compatible, activez ses sous-titres d'origine, puis réglez SubTranslateAI depuis son icône dans la barre d'extensions.

Le premier sous-titre peut prendre plus de temps, le temps de charger le modèle en mémoire. Une carte graphique récente avec environ 8 Go de VRAM est recommandée.

## Sites pris en charge

YouTube, Netflix, Prime Video, Canal+, Apple TV et Bilibili sont actuellement intégrés. Ces sites peuvent modifier leur lecteur sans préavis. Si une intégration ne fonctionne plus, ouvrez un rapport de bug avec le diagnostic copié depuis l'application.

## Confidentialité

Dans l'application officielle, les sous-titres restent sur l'ordinateur et circulent uniquement entre l'extension, le serveur local et Ollama via `127.0.0.1`. Il n'y a ni télémétrie, ni publicité, ni compte obligatoire.

## Limites actuelles

- Il faut une piste de sous-titres existante : l'audio n'est pas encore transcrit.
- L'installateur Windows n'est pas encore signé et SmartScreen peut afficher un avertissement.
- Une exécution uniquement sur processeur est possible mais souvent trop lente pour du direct.

Pour contribuer, consultez [CONTRIBUTING.md](../CONTRIBUTING.md). Pour signaler une faille, utilisez exclusivement le formulaire privé décrit dans [SECURITY.md](../SECURITY.md).
