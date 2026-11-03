# JDR Server App

Projet de table de jeu de rôle virtuelle, hébergée sur la machine du meneur,
écrite en JavaScript et destinée à devenir une alternative open source à Foundry.

Le projet dispose d'un serveur HTTP local et d'une interface web pour gérer et
rejoindre une partie, créer des profils et les attribuer aux joueurs.
L'application de bureau Windows (.exe) et Linux est prévue, mais n'est pas encore
implémentée. Le plateau permet d'afficher une carte, des pions avec une image
facultative et une première fiche de personnage Pathfinder.

## Organisation

```text
apps/
  server/       Serveur Node.js exécuté chez le meneur
  web/          Interface web du meneur et des joueurs
packages/
  shared/       Formats des messages et validations communes
  pathfinder1/  Premières règles isolées pour Pathfinder première édition
assets/
  maps/         Cartes fournies avec le projet
tests/          Tests d'intégration entre les composants
```

Les fichiers `.gitkeep` servent uniquement à conserver les dossiers vides dans Git.

## Méthode de travail

- Le développement actuel est sur `chore/repository-structure`.
- `main` est destinée à la version stable ; les fonctionnalités actuelles n'y ont
  pas encore été fusionnées.
- Le serveur, l'interface et leurs tests évoluent ensemble sur la même branche.
- Pour les prochains changements, utiliser une branche dédiée, puis fusionner
  après relecture et vérification.
- Les anciennes branches `front` et `back` ont été supprimées sur GitHub.
  `develop` et `test` y sont encore présentes, mais ne servent pas à séparer
  le serveur et l'interface.

## Lancer le serveur

Avec Node.js 26 LTS installé, depuis la racine :

```sh
node --version
```

La version recommandée est Node.js 26.13.0 LTS, indiquée dans `.nvmrc` pour les
utilisateurs de nvm. Elle comprend les correctifs de sécurité du
[21 octobre 2026](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
Installez une version récente depuis [nodejs.org](https://nodejs.org/en/download)
ou via votre gestionnaire de versions Node.js. Si un serveur est déjà lancé,
arrêtez-le et redémarrez-le après la mise à jour.

Avec nvm installé, `nvm install` puis `nvm use` sélectionnent la version indiquée
dans `.nvmrc` pour le terminal courant. Ce fichier ne met pas Node.js à jour
automatiquement.

Pour démarrer le serveur :

```sh
node apps/server/index.js
```

Le serveur écoute sur `http://127.0.0.1:3000`, uniquement sur la machine locale.
`Ctrl+C` l'arrête. Son exécution ne nécessite aucune dépendance externe ; les
outils de développement s'installent séparément avec npm.

Au lancement, le serveur ouvre automatiquement la page privée du meneur dans le
navigateur par défaut (Windows ou Linux avec un environnement graphique). La clé
est transmise dans le fragment du lien privé, retirée de la barre d'adresse puis
conservée dans `sessionStorage` pour les rechargements du même onglet. Aucune saisie
manuelle n'est nécessaire. Si l'ouverture échoue, ouvrir le lien privé affiché dans
le terminal. Ce lien donne les droits du meneur et ne doit pas être partagé.

Le meneur démarre la partie puis génère un lien joueur. Le joueur ouvre ce lien :
l'invitation est échangée automatiquement contre un accès, puis il choisit son profil.
Il n'a pas de clé à saisir ni de bouton de connexion à valider. Le secret du lien
est retiré de la barre d'adresse. Une invitation refusée ou une réponse perdue ne
provoque pas de nouvelle tentative automatique.
Les changements d'état arrivent par événements SSE, sans actualisation périodique
visible. Le bouton d'actualisation a été retiré ; F5 reste disponible.
Les liens utilisant `127.0.0.1` fonctionnent uniquement sur la même machine.

Le meneur sélectionne son profil sur sa page privée avant d'ouvrir la table. Un
profil choisi comme meneur est réservé à ce rôle ; un joueur ne peut pas le choisir.
Pour une nouvelle installation, le meneur peut d'abord créer un profil dans la
section "Profils joueurs", puis le sélectionner comme profil de meneur. Le rôle
est attribué seulement avec l'accès privé du meneur. Un profil déjà utilisé par
un joueur ne peut pas être attribué au meneur avant d'être libéré.

Les fichiers web sont lus au lancement : redémarrer le serveur et recharger les
pages après une modification HTML, CSS ou JavaScript côté navigateur.

| Méthode | Route | Action |
| --- | --- | --- |
| GET | `/api/session` | Consulter l'état et l'identifiant de la partie |
| POST | `/api/session/start` | Démarrer une partie avec un nouvel UUID |
| POST | `/api/session/stop` | Arrêter la partie et remettre son identifiant à `null` |
| POST | `/api/session/invitation` | Générer une invitation à usage unique (meneur uniquement) |
| POST | `/api/session/join` | Échanger une invitation contre un accès joueur (`201`) |
| GET | `/api/session/me` | Vérifier un accès joueur et retrouver son profil attribué |
| POST | `/api/session/profile` | Réserver ou changer de profil (joueur connecté) |
| GET / POST | `/api/host/profile` | Consulter ou sélectionner le profil du meneur |
| GET | `/api/events` | Recevoir l'état public de la partie en continu (SSE) |
| GET | `/api/profiles` | Consulter les profils sauvegardés (meneur ou joueur connecté) |
| POST | `/api/profiles` | Créer un profil avec un pseudo (meneur uniquement) |
| GET / PUT | `/api/campaign` | Lire la campagne ou la modifier (modification réservée au meneur) |
| GET / PUT | `/api/map` | Consulter la carte ou en importer une (import réservé au meneur) |
| POST | `/api/map/training` | Charger le terrain d'entraînement fourni (meneur uniquement) |
| GET | `/api/map/image?id=...` | Télécharger la carte actuelle avec un accès valide |
| GET / POST | `/api/tokens` | Consulter les pions ou en créer un (création réservée au meneur) |
| PATCH / DELETE | `/api/tokens/:id` | Déplacer un pion autorisé ou le supprimer (suppression réservée au meneur) |
| GET / PUT | `/api/tokens/:id/image` | Lire l'image d'un pion ou la remplacer (import réservé au meneur) |
| GET / PUT | `/api/characters/:profileId` | Consulter ou enregistrer une fiche (meneur ou joueur du profil) |

Un démarrage ou un arrêt redondant renvoie `409`. Une route inconnue renvoie `404`.
L'état reste en mémoire et revient à `stopped` au redémarrage du serveur.

Le démarrage, l'arrêt et la génération de l'invitation exigent l'en-tête
`Authorization: Bearer <clé du meneur>`. Une clé aléatoire est créée à chaque
lancement et transmise par le lien privé du meneur ; elle change au redémarrage. Utiliser la nouvelle page ouverte
par le serveur après un redémarrage. Un accès sans clé valide renvoie `401`.

Chaque génération remplace l'invitation précédente. L'invitation est consommée
après une entrée réussie et n'est jamais exposée dans les réponses publiques.
La génération renvoie `409` sans partie active et `Cache-Control: no-store` en cas
de succès. Une invitation invalide ou consommée est refusée avec `401`.

Le joueur utilise l'invitation comme jeton Bearer pour rejoindre, puis sa clé
personnelle comme jeton Bearer pour `/api/session/me`. Une nouvelle invitation ne
révoque pas les joueurs déjà entrés. Une partie accepte au maximum 20 accès joueurs ;
le suivant est refusé avec `409`. Arrêter la partie supprime tous ces accès et
l'invitation en attente.

La clé joueur est conservée dans `sessionStorage` pour retrouver son accès après
un rechargement du même onglet. Le serveur vérifie toujours sa validité. Une
vérification silencieuse chaque minute renouvelle la présence ; après 30 minutes
sans présence, l'accès expire. Un nettoyage chaque minute libère les places
expirées, également supprimées avant une vérification ou une admission.

Un redémarrage du serveur invalide tous les accès. La reprise depuis un nouvel
onglet après fermeture n'est pas garantie par `sessionStorage`. Les requêtes de
l'interface ont un délai maximal de cinq secondes ; une réponse perdue ne signifie
pas que l'action n'a pas été effectuée côté serveur.

## Profils joueurs

Le module `apps/server/profiles.js` permet de créer et charger des profils
contenant un identifiant et un pseudo, sauvegardés dans `data/profiles.json`.
Ce dossier est exclu de Git. Le meneur peut créer et lister les profils depuis
sa page privée, avec son accès initialisé automatiquement. La création attend un objet JSON
`{"name":"Aldric"}` avec un pseudo de 1 à 40 caractères après suppression
des espaces aux extrémités. Le serveur limite le corps à 4 Kio et sa lecture
à cinq secondes. Le formulaire actualise la liste après une création confirmée.

Les profils sont indépendants des invitations. Le joueur se connecte grâce au lien,
puis choisit son profil dans le menu et clique sur "Utiliser ce profil". Le serveur
n'autorise qu'un accès joueur par profil et refuse une réservation concurrente
avec `409`. Le menu n'indique pas quels profils sont occupés.

Après confirmation, le menu se verrouille. "Changer de profil" permet de choisir
un autre profil ; "Annuler" retrouve le choix actuel sans requête au serveur.
Le profil actuel reste réservé pendant le choix. La validation d'un nouveau profil
libre remplace l'ancien en une seule opération. Si le nouveau profil est occupé,
l'ancien reste attribué.

La réservation utilise `POST /api/session/profile` avec le corps JSON
`{"profileId":"identifiant-du-profil"}` et l'accès joueur en Bearer.
Un profil inexistant renvoie `404`. Les corps JSON sont limités à 4 Kio et leur
lecture à cinq secondes, comme pour la création des profils.

F5 dans le même onglet retrouve le profil attribué via `/api/session/me`.
Les profils sauvegardés survivent à un redémarrage du serveur, mais les accès et
leurs réservations restent en mémoire : un arrêt de partie, un redémarrage ou
l'expiration d'un accès libère les profils concernés. Les données des fiches
restent sauvegardées indépendamment des accès.

## Campagne et carte

Le meneur peut modifier le titre et la description depuis sa page privée. Ces
informations sont enregistrées dans `data/campaign.json` et transmises en direct
aux joueurs connectés.

Dans la table, le bouton "Importer une carte" est réservé au meneur. Il accepte
une image PNG ou JPEG de 10 Mio maximum, jusqu'à 16 384 pixels par côté et
40 millions de pixels. Le serveur vérifie la structure et les dimensions annoncées ;
le navigateur vérifie également qu'il peut lire le fichier lorsque cette fonction
est disponible. L'image est conservée
dans `data/maps` et reste disponible après un redémarrage.

Le bouton "Terrain d'entraînement" charge la carte de démonstration fournie dans
`assets/maps/terrain-entrainement.png`. Elle est conçue en vue du dessus, sans
quadrillage intégré : l'application affiche sa propre grille par-dessus. La carte
active ne change que lorsque le meneur appuie sur ce bouton.

Une seule carte est active à la fois. Un nouvel import la remplace sur la table
pour le meneur et les joueurs connectés. Les anciens fichiers restent dans le
dossier local ; l'interface ne propose pas encore de bibliothèque pour les
sélectionner. Réimporter le même fichier retrouve les pions de cette carte.
Plusieurs scènes et les zones cachées ne sont pas encore disponibles.

Sur le plateau, la molette contrôle le zoom et le clic droit maintenu déplace la
vue. "Recentrer" affiche à nouveau la carte entière. Chaque participant contrôle
sa propre vue : zoomer ou se déplacer ne change pas la vue des autres.

## Première fiche Pathfinder

Sur la table, "Fiche de personnage" ouvre une première fiche Pathfinder 1 liée à
un profil. Le meneur choisit le profil à consulter ; chaque joueur accède à celui
qu'il utilise. Le meneur et le joueur concerné peuvent modifier le nom, le niveau,
les points de vie (actuels, maximum et temporaires), les dégâts non létaux et les
six caractéristiques. Leurs modificateurs sont calculés automatiquement. Les valeurs
et leur révision sont conservées dans `data/characters` sur la machine du meneur.
Un double-clic sur un pion lié à un profil ouvre aussi sa fiche : le meneur peut
ouvrir celle de chaque profil et le joueur celle de son propre profil. Un pion
sans profil n'a pas encore de fiche. La fenêtre se déplace en maintenant le clic
gauche sur sa barre de titre. Elle présente tous les onglets de référence pour
examen. "Résumé" (nom, niveau et points de vie), "Attributs", "Compétences",
"Inventaire", "Biographie" et "Notes" sont modifiables. L'onglet "Combat" permet
de saisir les bonus, défenses et sauvegardes, affichés aussi dans le résumé ; ces
valeurs ne sont pas encore calculées automatiquement. Ses attaques et les autres
onglets restent des maquettes clairement signalées. Le portrait affiche l'image
du premier pion associé au profil sur la carte active lorsqu'elle est disponible.

Les changements sont signalés en direct. Si deux personnes modifient la même fiche,
une ancienne version est refusée pour éviter d'écraser la nouvelle : recharger la
fiche permet de voir les valeurs enregistrées, mais remplace le brouillon local.
Les anciennes fiches conservent leurs données ; leur niveau commence à 1 et leurs
points de vie à 0 jusqu'à leur modification.
Les deux vues de compétences permettent de modifier les rangs, le statut de classe,
la caractéristique utilisée, le malus d'armure et un modificateur divers. Le total
inclut le bonus de classe de +3 si au moins un rang est attribué. Les rangs utilisés
sont comptés séparément pour Aventure et Background ; le budget et les jets ne sont
pas encore automatisés. Les compétences personnalisées peuvent être ajoutées ou
supprimées. Dans l'inventaire, on peut saisir la monnaie et des objets regroupés par
catégorie, avec quantité, poids unitaire en livres, état équipé et description.
Le poids des objets est additionné sans la monnaie. Les conteneurs ne possèdent pas
encore de contenu imbriqué ; les effets d'équipement, images d'objets, sorts et
règles Spheres restent à développer.

## Pions de test

Le meneur peut ajouter un pion sur la carte active, lui donner un nom,
éventuellement l'attribuer à un profil et choisir une image PNG ou JPEG de 5 Mio
maximum. Il peut aussi sélectionner un pion existant, choisir une image et cliquer
sur "Appliquer l'image au pion sélectionné", ou supprimer le pion. Sans image,
le pion affiche son initiale. Un pion sans profil est contrôlé seulement par le
meneur. Le serveur vérifie l'image et la réserve aux participants autorisés.

Pour déplacer un pion, maintenir le clic gauche, viser une case et relâcher : le
pion fantôme montre la destination uniquement au participant qui le déplace, puis
disparaît au relâchement. Le pion glisse alors pendant une seconde jusqu'au centre
de cette case. La position est envoyée et partagée avec les autres participants au
relâchement. Le serveur vérifie que le joueur
contrôle le profil auquel le pion est attribué ; le meneur peut déplacer tous les
pions. Les flèches du clavier déplacent aussi le pion sélectionné. Il peut y avoir
jusqu'à 100 pions par carte. L'animation respecte le réglage de réduction des
animations du système.

Les positions sont sauvegardées dans `data/tokens` et les images dans
`data/token-images` ; elles restent associées à la carte après un redémarrage.
Les anciens fichiers image restent sur le disque après remplacement ou suppression.

## Vérifications

TypeScript vérifie les fichiers JavaScript de l'application en mode strict grâce
aux annotations JSDoc et à l'inférence de types. La configuration du serveur et
de la grille figure dans `tsconfig.json` ; celle de l'interface se trouve dans
`tsconfig.web.json`. Les données reçues du réseau restent soumises aux validations
du serveur : une vérification de types ne remplace pas une validation à l'exécution.
Avec Node.js et npm installés :

```sh
npm ci
npm run typecheck
```

Cette vérification ne modifie pas les fichiers et ne remplace pas les tests.

```sh
node --check apps/server/index.js
node --check apps/server/profiles.js
node --check apps/server/read-json.js
node --check apps/server/open-host-page.js
node --check apps/server/map-store.js
node --check apps/server/read-bytes.js
node --check apps/server/token-store.js
node --check apps/web/app.js
node --check apps/web/board.js
node --check apps/web/map.js
node --check apps/web/tokens.js
node --check packages/shared/grid.js
node tests/web-state.test.cjs
node tests/profiles-api.test.cjs
node tests/open-host-page.test.cjs
node tests/board.test.cjs
node tests/map-view.test.cjs
node tests/token-view.test.cjs
node tests/grid.test.cjs
node tests/pathfinder1-abilities.test.cjs
node tests/map-e2e.test.cjs
```

Les tests couvrent les connexions automatiques, la restauration après F5, la
création et le changement de profil, l'annulation, les doubles envois, les réponses
retardées, la révocation et les erreurs réseau. Les tests de l'API utilisent des
flux HTTP simulés et un dossier temporaire pour vérifier les autorisations, les
entrées invalides, la persistance et la réservation exclusive des profils.
Le lanceur Windows/Linux est testé avec des processus simulés.
Le test HTTP complet utilise un serveur temporaire sur `127.0.0.1` et un dossier
isolé ; il ne modifie pas les données de la partie.

Ces tests ne démarrent pas de navigateur réel et ne remplacent pas une vérification
manuelle de l'ouverture de la page et du parcours utilisateur.

L'UUID identifie la partie et ne constitue pas une autorisation d'accès.
Ce prototype local n'est pas prêt pour une exposition sur Internet.

## Prochaines étapes

- Compléter les fiches Pathfinder et ajouter progressivement les règles Spheres.
- Interface de bureau Windows et Linux avec Electron ; accès joueurs par navigateur.
- Bibliothèque de médias : plusieurs cartes, gestion des images et illustrations d'objets.
- Scènes partagées, visibilité, sauvegarde des campagnes et accès distant sécurisé.

## Licence

L'objectif est une distribution open source. La licence reste à choisir avant
la première publication ; aucune licence n'est accordée par ce README.
