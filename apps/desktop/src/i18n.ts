export type InterfaceLanguage = 'auto' | 'fr' | 'en';
export type InterfaceLocale = Exclude<InterfaceLanguage, 'auto'>;

export const INTERFACE_LANGUAGES: readonly InterfaceLanguage[] = ['auto', 'fr', 'en'];

export function isInterfaceLanguage(value: unknown): value is InterfaceLanguage {
  return INTERFACE_LANGUAGES.includes(value as InterfaceLanguage);
}

export function resolveInterfaceLocale(
  preference: InterfaceLanguage,
  detectedLanguages: string | readonly string[],
): InterfaceLocale {
  if (preference !== 'auto') return preference;
  const languages = Array.isArray(detectedLanguages) ? detectedLanguages : [detectedLanguages];
  return languages.some((language) => language.toLowerCase().split('-')[0] === 'fr') ? 'fr' : 'en';
}

const messages = {
  fr: {
    unsavedChanges: 'Modifications non enregistrées.',
    serverReady: 'Serveur prêt',
    serverStopped: 'Serveur arrêté',
    ollamaConnected: 'Ollama connecté',
    ollamaStarting: 'Ollama installé — démarrage…',
    ollamaMissing: 'Ollama à installer',
    modelReady: 'Hy‑MT2‑7B prêt',
    modelMissing: 'Hy‑MT2‑7B à télécharger',
    setupComplete: 'Tout est installé ✓',
    setupRunning: 'Installation en cours…',
    setupAction: 'Tout installer automatiquement',
    readyMessage: 'Tout est prêt. Laisse SubTranslateAI ouvert pendant la vidéo.',
    setupConfirmation:
      'SubTranslateAI va installer Ollama depuis son site officiel puis télécharger Hy‑MT2‑7B (environ 4,6 Go). Continuer ?',
    setupPreparing: 'Préparation de l’installation…',
    setupImpossible: 'Installation impossible.',
    settingsSaved: 'Réglages enregistrés.',
    clearCacheConfirmation: 'Supprimer toutes les traductions mémorisées localement ?',
    clearCacheImpossible: 'Impossible de vider le cache.',
    missingElement: 'Élément #{id} manquant.',
    notButton: '#{id} n’est pas un bouton.',
    notCheckbox: '#{id} n’est pas une case.',
    notSelect: '#{id} n’est pas une liste.',
    notForm: '#{id} n’est pas un formulaire.',
    serverReused: 'Un serveur SubTranslateAI déjà lancé est réutilisé.',
    serverStartFailed:
      'Le serveur local n’a pas pu démarrer. Ouvre Aide puis copie le diagnostic pour obtenir les détails.',
    appStartFailed: 'SubTranslateAI n’a pas pu terminer son initialisation.',
    setupAlreadyRunning: 'Une installation est déjà en cours.',
    ollamaDownloadOfficial: 'Téléchargement officiel d’Ollama…',
    ollamaDownloadProgress: 'Téléchargement d’Ollama : {percent} %',
    ollamaSignatureCheck: 'Vérification de la signature numérique d’Ollama…',
    ollamaInstalling: 'Installation d’Ollama dans ton profil Windows…',
    ollamaExecutableMissing: 'Ollama a été installé, mais son exécutable reste introuvable.',
    setupFinished: 'Installation terminée. SubTranslateAI est prêt.',
    modelAlreadyInstalled: 'Hy‑MT2‑7B est déjà installé.',
    modelDownloadStart: 'Téléchargement de Hy‑MT2‑7B (environ 4,6 Go)…',
    modelDownloadRunning: 'Téléchargement de Hy‑MT2‑7B en cours…',
    modelDownloadProgress: 'Téléchargement de Hy‑MT2‑7B : {percent} %',
    modelChecking: 'Vérification du modèle…',
    ollamaStopped: 'Ollama s’est arrêté avec le code {code}.',
    unknown: 'inconnu',
    modelInstalled: 'Hy‑MT2‑7B est prêt.',
    ollamaNotInstalled: 'Ollama n’est pas installé.',
    ollamaEngineStarting: 'Démarrage du moteur Ollama…',
    ollamaServiceFailed: 'Ollama est installé, mais son service ne démarre pas.',
    invalidSettings: 'Réglages invalides.',
    invalidStartupOptions: 'Options de démarrage invalides.',
    invalidLanguage: 'Langue d’interface invalide.',
    boundedValue: 'Valeur attendue entre {minimum} et {maximum}.',
    cacheCleared: 'Cache vidé : {count} traduction(s) supprimée(s).',
    serverHttpError: 'Le serveur local a répondu HTTP {status}.',
    diagnosticsCopied: 'Diagnostic copié dans le presse-papiers.',
    setupDownloadFailed: 'Le téléchargement d’Ollama a échoué.',
    setupSignatureFailed: 'La vérification de la signature d’Ollama a échoué.',
    setupInstallFailed: 'L’installation d’Ollama a échoué.',
    setupStartFailed: 'Le démarrage d’Ollama a échoué.',
    setupModelFailed: 'L’installation du modèle Hy-MT2 a échoué.',
    technicalDetailsNotStored: 'Les détails techniques n’ont pas été conservés sur le disque.',
    browserUrlCopied: '{url} copié. Colle cette adresse dans ton navigateur.',
    updatesNotInitialized: 'Mises à jour non initialisées.',
    updatesReady: 'Les mises à jour automatiques sont prêtes.',
    updatesUnsupported: 'Canal de mise à jour non configuré pour cette compilation.',
    automaticUpdatesDisabled: 'Recherche automatique désactivée.',
    updateChecking: 'Recherche d’une mise à jour…',
    updateCheckFailed: 'Recherche impossible : {error}',
    updateAvailable: 'Version {version} trouvée. Téléchargement…',
    updateDownloading: 'Téléchargement de la mise à jour : {percent} %',
    updateDownloaded: 'Version {version} prête. Redémarre pour l’installer.',
    updateCurrent: 'SubTranslateAI {version} est à jour.',
    updateFailed: 'Mise à jour impossible : {error}',
  },
  en: {
    unsavedChanges: 'Unsaved changes.',
    serverReady: 'Server ready',
    serverStopped: 'Server stopped',
    ollamaConnected: 'Ollama connected',
    ollamaStarting: 'Ollama installed — starting…',
    ollamaMissing: 'Ollama needs to be installed',
    modelReady: 'Hy‑MT2‑7B ready',
    modelMissing: 'Hy‑MT2‑7B needs to be downloaded',
    setupComplete: 'Everything is installed ✓',
    setupRunning: 'Installation in progress…',
    setupAction: 'Install everything automatically',
    readyMessage: 'Everything is ready. Keep SubTranslateAI open while watching the video.',
    setupConfirmation:
      'SubTranslateAI will install Ollama from its official website, then download Hy‑MT2‑7B (about 4.6 GB). Continue?',
    setupPreparing: 'Preparing installation…',
    setupImpossible: 'Installation failed.',
    settingsSaved: 'Settings saved.',
    clearCacheConfirmation: 'Delete all locally cached translations?',
    clearCacheImpossible: 'Unable to clear the cache.',
    missingElement: 'Missing element #{id}.',
    notButton: '#{id} is not a button.',
    notCheckbox: '#{id} is not a checkbox.',
    notSelect: '#{id} is not a select.',
    notForm: '#{id} is not a form.',
    serverReused: 'An existing SubTranslateAI server is being reused.',
    serverStartFailed:
      'The local server could not start. Open Help and copy the diagnostics for details.',
    appStartFailed: 'SubTranslateAI could not finish starting.',
    setupAlreadyRunning: 'An installation is already in progress.',
    ollamaDownloadOfficial: 'Downloading Ollama from the official source…',
    ollamaDownloadProgress: 'Downloading Ollama: {percent}%',
    ollamaSignatureCheck: 'Verifying Ollama’s digital signature…',
    ollamaInstalling: 'Installing Ollama in your Windows profile…',
    ollamaExecutableMissing: 'Ollama was installed, but its executable could not be found.',
    setupFinished: 'Installation complete. SubTranslateAI is ready.',
    modelAlreadyInstalled: 'Hy‑MT2‑7B is already installed.',
    modelDownloadStart: 'Downloading Hy‑MT2‑7B (about 4.6 GB)…',
    modelDownloadRunning: 'Downloading Hy‑MT2‑7B…',
    modelDownloadProgress: 'Downloading Hy‑MT2‑7B: {percent}%',
    modelChecking: 'Checking the model…',
    ollamaStopped: 'Ollama stopped with code {code}.',
    unknown: 'unknown',
    modelInstalled: 'Hy‑MT2‑7B is ready.',
    ollamaNotInstalled: 'Ollama is not installed.',
    ollamaEngineStarting: 'Starting the Ollama engine…',
    ollamaServiceFailed: 'Ollama is installed, but its service did not start.',
    invalidSettings: 'Invalid settings.',
    invalidStartupOptions: 'Invalid startup options.',
    invalidLanguage: 'Invalid interface language.',
    boundedValue: 'Expected a value between {minimum} and {maximum}.',
    cacheCleared: 'Cache cleared: {count} translation(s) deleted.',
    serverHttpError: 'The local server returned HTTP {status}.',
    diagnosticsCopied: 'Diagnostics copied to the clipboard.',
    setupDownloadFailed: 'Ollama could not be downloaded.',
    setupSignatureFailed: 'Ollama’s signature verification failed.',
    setupInstallFailed: 'Ollama could not be installed.',
    setupStartFailed: 'Ollama could not be started.',
    setupModelFailed: 'The Hy-MT2 model could not be installed.',
    technicalDetailsNotStored: 'Technical details were not stored on disk.',
    browserUrlCopied: '{url} copied. Paste this address into your browser.',
    updatesNotInitialized: 'Updates have not been initialized.',
    updatesReady: 'Automatic updates are ready.',
    updatesUnsupported: 'The update channel is not configured for this build.',
    automaticUpdatesDisabled: 'Automatic update checks are disabled.',
    updateChecking: 'Checking for updates…',
    updateCheckFailed: 'Unable to check for updates: {error}',
    updateAvailable: 'Version {version} found. Downloading…',
    updateDownloading: 'Downloading update: {percent}%',
    updateDownloaded: 'Version {version} is ready. Restart to install it.',
    updateCurrent: 'SubTranslateAI {version} is up to date.',
    updateFailed: 'Unable to update: {error}',
  },
} as const;

export type MessageKey = keyof (typeof messages)['fr'];

export function translate(
  locale: InterfaceLocale,
  key: MessageKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    messages[locale][key] as string,
  );
}

const staticTextPairs = [
  ['Français + 中文, en local', 'French + 中文, locally'],
  ['Navigation principale', 'Main navigation'],
  ['État du logiciel', 'Software status'],
  ['Accueil', 'Home'],
  ['Réglages', 'Settings'],
  ['Aide', 'Help'],
  [
    'Aucun dialogue envoyé vers une API distante. Le texte reste sur ce PC.',
    'No dialogue is sent to a remote API. Text stays on this PC.',
  ],
  ['Centre de démarrage', 'Getting started'],
  ['Un clic, puis regarde ta série.', 'One click, then enjoy your show.'],
  [
    'L’application installe le moteur local, prépare Hy‑MT2‑7B et te guide pour activer les sous-titres dans Chrome ou Edge.',
    'The app installs the local engine, prepares Hy‑MT2‑7B, and guides you through enabling subtitles in Chrome or Edge.',
  ],
  ['État de l’installation', 'Installation status'],
  ['Vérification du serveur…', 'Checking the server…'],
  ['Vérification d’Ollama…', 'Checking Ollama…'],
  ['Vérification de Hy‑MT2‑7B…', 'Checking Hy‑MT2‑7B…'],
  ['Initialisation…', 'Initializing…'],
  ['Tout installer automatiquement', 'Install everything automatically'],
  ['Actualiser', 'Refresh'],
  ['Activer l’extension', 'Enable the extension'],
  ['Ouvre le dossier', 'Open the folder'],
  ['Il contient l’extension prête à charger.', 'It contains the extension ready to load.'],
  ['Ouvre les extensions', 'Open Extensions'],
  ['Active le mode développeur.', 'Enable Developer mode.'],
  ['Charge le dossier', 'Load the folder'],
  ['Choisis « extension non empaquetée ».', 'Choose “Load unpacked”.'],
  ['Ouvrir le dossier', 'Open folder'],
  ['Mises à jour', 'Updates'],
  ['Vérification du canal de mise à jour…', 'Checking the update channel…'],
  ['Rechercher', 'Check now'],
  ['Redémarrer et installer', 'Restart and install'],
  ['Panneau de contrôle', 'Control panel'],
  ['Les réglages importants.', 'The settings that matter.'],
  [
    'Des choix simples et sûrs. Le modèle reste verrouillé sur Hy‑MT2‑7B.',
    'Simple, safe choices. The model remains locked to Hy‑MT2‑7B.',
  ],
  ['Application', 'Application'],
  ['Langue de l’interface', 'Interface language'],
  [
    'Détecte automatiquement le français ou l’anglais, ou force une langue.',
    'Automatically detect French or English, or choose a language.',
  ],
  ['Automatique (langue du système)', 'Automatic (system language)'],
  ['Français', 'French'],
  ['Anglais', 'English'],
  ['Mises à jour automatiques', 'Automatic updates'],
  [
    'Recherche et télécharge les nouvelles versions publiées.',
    'Checks for and downloads newly published versions.',
  ],
  ['Démarrage manuel', 'Manual startup'],
  [
    'SubTranslateAI et Ollama démarrent uniquement quand tu ouvres l’application.',
    'SubTranslateAI and Ollama start only when you open the app.',
  ],
  ['Activé', 'Enabled'],
  ['Traduction locale', 'Local translation'],
  ['Temps maximal par ligne', 'Maximum time per line'],
  ['15 s — très rapide', '15 s — very fast'],
  ['20 s — GPU rapide', '20 s — fast GPU'],
  ['45 s — recommandé', '45 s — recommended'],
  ['90 s — GPU plus lent', '90 s — slower GPU'],
  ['120 s — maximum', '120 s — maximum'],
  ['Augmente si certaines traductions expirent.', 'Increase this if some translations time out.'],
  ['Nouvelles tentatives', 'Retries'],
  ['0 — latence minimale', '0 — lowest latency'],
  ['1 — recommandé', '1 — recommended'],
  ['2 — connexion instable', '2 — unstable connection'],
  ['3 — très tolérant', '3 — most tolerant'],
  [
    'Réessaie seulement lorsqu’Ollama répond mal.',
    'Retries only when Ollama fails to respond correctly.',
  ],
  ['Cache rapide', 'Fast cache'],
  ['500 lignes', '500 lines'],
  ['1 000 lignes — recommandé', '1,000 lines — recommended'],
  ['5 000 lignes', '5,000 lines'],
  ['10 000 lignes', '10,000 lines'],
  [
    'Évite de retraduire les phrases déjà rencontrées.',
    'Avoids translating previously seen sentences again.',
  ],
  ['Enregistrer', 'Save'],
  ['Vider le cache', 'Clear cache'],
  ['Utilisation', 'Usage'],
  ['lignes traduites', 'translated lines'],
  ['lignes en cache', 'cached lines'],
  ['réutilisées', 'reused'],
  ['erreurs', 'errors'],
  ['Mode d’emploi', 'User guide'],
  ['Tout ce qu’il faut savoir.', 'Everything you need to know.'],
  [
    'Les réponses courtes aux problèmes les plus fréquents, directement dans le logiciel.',
    'Short answers to the most common problems, right inside the app.',
  ],
  ['Première installation de l’extension', 'Installing the extension for the first time'],
  ['Clique sur « Ouvrir le dossier ».', 'Click “Open folder”.'],
  ['Ouvre', 'Open'],
  ['ou', 'or'],
  ['Active le mode développeur.', 'Enable Developer mode.'],
  [
    'Clique sur « Charger l’extension non empaquetée » et choisis le dossier ouvert.',
    'Click “Load unpacked” and select the folder that opened.',
  ],
  ['Ouvrir Chrome', 'Open Chrome'],
  ['Ouvrir Edge', 'Open Edge'],
  ['Comment utiliser les sous-titres ?', 'How do I use the subtitles?'],
  [
    'Laisse SubTranslateAI ouvert, démarre une vidéo et active une piste de sous-titres textuelle dans le lecteur. L’extension détecte la ligne et affiche le français ainsi que le chinois.',
    'Keep SubTranslateAI open, start a video, and enable a text subtitle track in the player. The extension detects each line and displays French and Chinese.',
  ],
  ['Pourquoi la première phrase est plus lente ?', 'Why is the first sentence slower?'],
  [
    'Hy‑MT2‑7B doit être chargé dans la mémoire de la carte graphique. Les phrases suivantes sont généralement beaucoup plus rapides, et les traductions déjà vues sont récupérées depuis le cache.',
    'Hy‑MT2‑7B must be loaded into graphics memory. The following sentences are usually much faster, and previously seen translations are retrieved from the cache.',
  ],
  ['Ollama ou le modèle ne démarre pas', 'Ollama or the model does not start'],
  [
    'Utilise d’abord « Tout installer automatiquement ». Vérifie ensuite que Windows et les pilotes graphiques sont à jour. Le bouton ci-dessous ouvre aussi la page officielle d’Ollama.',
    'First use “Install everything automatically”. Then check that Windows and your graphics drivers are up to date. The button below also opens Ollama’s official page.',
  ],
  ['Page officielle Ollama', 'Official Ollama page'],
  ['Demander de l’aide', 'Get help'],
  [
    'Copie le diagnostic puis envoie-le au développeur. Il contient les versions et états techniques, mais aucun historique de navigation ni texte de sous-titre.',
    'Copy the diagnostics and send them to the developer. They include versions and technical status, but no browsing history or subtitle text.',
  ],
  ['Copier le diagnostic', 'Copy diagnostics'],
] as const;

const englishToFrench = new Map(staticTextPairs.map(([fr, en]) => [en, fr]));
const frenchToEnglish = new Map(staticTextPairs);

export function hasStaticTextTranslation(value: string): boolean {
  const text = value.replace(/\s+/gu, ' ').trim();
  return frenchToEnglish.has(text) || englishToFrench.has(text);
}

export function translateStaticText(locale: InterfaceLocale, value: string): string {
  const match = /^(\s*)(.*?)(\s*)$/su.exec(value);
  if (!match) return value;
  const [, before, text, after] = match;
  const normalizedText = text.replace(/\s+/gu, ' ');
  const translated =
    locale === 'en'
      ? frenchToEnglish.get(normalizedText)
      : (englishToFrench.get(normalizedText) ?? text);
  return `${before}${translated ?? text}${after}`;
}
