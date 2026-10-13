# JDR Server App

Projet de table de jeu de rôle virtuelle, hébergée sur la machine du meneur,
écrite en JavaScript et destinée à devenir une alternative open source à Foundry.

Le projet dispose d'un serveur HTTP local et d'une interface web pour gérer et
rejoindre une partie, créer des profils et les attribuer aux joueurs.
L'application de bureau Windows (.exe) et Linux est prévue, mais n'est pas encore
implémentée. Le plateau de jeu et les fiches de personnages restent à développer.

## Organisation

```text
apps/
  server/       Serveur Node.js exécuté chez le meneur
  web/          Interface web du meneur et des joueurs
packages/
  shared/       Formats des messages et validations communes
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

Avec Node.js installé (développement effectué avec Node.js 24), depuis la racine :

```sh
node apps/server/index.js
```

Le serveur écoute sur `http://127.0.0.1:3000`, uniquement sur la machine locale.
`Ctrl+C` l'arrête. Aucune dépendance externe n'est nécessaire à ce stade.

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

Les fichiers web sont lus au lancement : redémarrer le serveur et recharger les
pages après une modification HTML ou JavaScript côté navigateur.

| Méthode | Route | Action |
| --- | --- | --- |
| GET | `/api/session` | Consulter l'état et l'identifiant de la partie |
| POST | `/api/session/start` | Démarrer une partie avec un nouvel UUID |
| POST | `/api/session/stop` | Arrêter la partie et remettre son identifiant à `null` |
| POST | `/api/session/invitation` | Générer une invitation à usage unique (meneur uniquement) |
| POST | `/api/session/join` | Échanger une invitation contre un accès joueur (`201`) |
| GET | `/api/session/me` | Vérifier un accès joueur et retrouver son profil attribué |
| POST | `/api/session/profile` | Réserver ou changer de profil (joueur connecté) |
| GET | `/api/events` | Recevoir l'état public de la partie en continu (SSE) |
| GET | `/api/profiles` | Consulter les profils sauvegardés (meneur ou joueur connecté) |
| POST | `/api/profiles` | Créer un profil avec un pseudo (meneur uniquement) |

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
l'expiration d'un accès libère les profils concernés. Les fiches de personnages
liées aux profils ne sont pas encore disponibles.

## Vérifications

```sh
node --check apps/server/index.js
node --check apps/server/profiles.js
node --check apps/server/read-json.js
node --check apps/server/open-host-page.js
node --check apps/web/app.js
node tests/web-state.test.cjs
node tests/profiles-api.test.cjs
node tests/open-host-page.test.cjs
```

Les tests couvrent les connexions automatiques, la restauration après F5, la
création et le changement de profil, l'annulation, les doubles envois, les réponses
retardées, la révocation et les erreurs réseau. Les tests de l'API utilisent des
flux HTTP simulés et un dossier temporaire pour vérifier les autorisations, les
entrées invalides, la persistance et la réservation exclusive des profils.
Le lanceur Windows/Linux est testé avec des processus simulés.

Ces tests ne démarrent pas de navigateur réel et ne remplacent pas une vérification
manuelle de l'ouverture de la page et du parcours utilisateur.

L'UUID identifie la partie et ne constitue pas une autorisation d'accès.
Ce prototype local n'est pas prêt pour une exposition sur Internet.

## Prochaines étapes

- Accueil de campagne avec titre, description et choix du profil, puis table de jeu.
- Fiches de personnages créées et gérées par le meneur, liées aux profils joueurs.
- Interface de bureau Windows et Linux avec Electron ; accès joueurs par navigateur.
- Import de cartes, tokens et illustrations dans une bibliothèque de médias.
- Plateau partagé, sauvegarde des campagnes et configuration de l'accès distant.

## Licence

L'objectif est une distribution open source. La licence reste à choisir avant
la première publication ; aucune licence n'est accordée par ce README.
