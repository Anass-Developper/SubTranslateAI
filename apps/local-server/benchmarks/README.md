# Benchmark de traduction de sous-titres

Comparaison exécutée le 7 août 2026 sur une NVIDIA GeForce RTX 3070 8 Go. Le corpus
contient 16 dialogues originaux de style film/série : 8 français vers chinois simplifié
et 8 chinois simplifié vers français. Il teste notamment l’oralité, la politesse, les
négations, les idiomes et les pronoms en contexte.

| Moteur                          | chrF moyen | FR→ZH | ZH→FR | Latence médiane |
| ------------------------------- | ---------: | ----: | ----: | --------------: |
| OpenCode Go / DeepSeek V4 Flash |      80,12 | 77,32 | 82,92 |      1 425,5 ms |
| Qwen3.5 9B Q4 local             |      73,01 | 77,22 | 68,80 |      1 522,5 ms |
| Hy-MT2 7B Q4 local              |      69,80 | 61,01 | 78,59 |        500,5 ms |
| Qwen3 8B Q4 local               |      61,07 | 62,68 | 59,45 |          820 ms |
| TranslateGemma 4B Q8 local      |      59,90 | 54,61 | 65,19 |          787 ms |

La latence médiane exclut naturellement l’effet du premier chargement : sur cette
machine, charger successivement un autre modèle dans la VRAM a pris environ 8 à 11
secondes. Le serveur préchauffe donc le modèle configuré et le conserve trente minutes.

## Lecture qualitative

- OpenCode est le plus régulier sur ce petit corpus, mais a tout de même inversé la
  nuance d’une double négation chinoise dans un cas.
- Qwen3.5 obtient le meilleur chrF local et égale presque l’API en FR→ZH. Une lecture
  bilingue révèle toutefois plusieurs erreurs que ce score ne pénalise pas assez : perte
  du vouvoiement, « lâche-moi » rendu par « va-t’en », inversion d’une double négation et
  contresens sur « je ne me ferai plus avoir ». Il est également trois fois plus lent
  que Hy-MT2 une fois les modèles chargés.
- Hy-MT2 reste le choix local recommandé pour la fidélité sémantique. Il respecte mieux
  la politesse et les négations, produit des sous-titres courts et devient environ trois
  fois plus rapide que l’API une fois chargé. Une tournure chinoise était maladroite et
  une sortie française contenait « de un peu ».
- Qwen3 et TranslateGemma ont laissé le mot anglais `nowhere` dans une traduction
  chinoise. Le fournisseur local rejette désormais ce type de mélange inattendu afin que
  le mode hybride puisse appeler le secours distant.

Le score chrF mesure la proximité avec une référence unique et ne sait pas reconnaître
toutes les reformulations valides. Il sert à comparer les exécutions, pas à remplacer
une révision bilingue. Les sorties initiales sont conservées dans `latest-results.json` ;
les exécutions supplémentaires sont dans `qwen35-results.json` et
`hymt-current-results.json`.

## Décision

Ces résultats historiques ont servi à choisir Hy-MT2 7B Q4 pour l’application officielle : il offre le meilleur compromis local observé entre fidélité, latence et mémoire. La version distribuée utilise `TRANSLATION_PROVIDER=ollama` uniquement. Les fournisseurs distants restent du code expérimental de développement et ne font pas partie du produit pris en charge.
