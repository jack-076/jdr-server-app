# JDR Server App

Projet de table de jeu de rôle virtuelle, hébergée sur la machine du meneur,
écrite en JavaScript et destinée à devenir une alternative open source à Foundry.

Le projet dispose d'un serveur HTTP local et d'une interface web pour gérer et
rejoindre une partie. L'application de bureau
Windows et Linux est prévue, mais n'est pas encore implémentée.

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

- `main` représente la version stable.
- Une branche temporaire est créée pour chaque changement cohérent, puis fusionnée
  après relecture et vérification.
- Exemples : `chore/repository-structure`, `feat/session-hosting`,
  `feat/invitations`, `feat/shared-board`.
- Le serveur, l'interface et leurs tests évoluent ensemble sur la même branche.
- `develop` reste disponible si une branche d'intégration devient utile.
- Les anciennes branches `front`, `back` et `test` sont conservées pour l'instant,
  mais ne servent plus à séparer le travail par composant.

## Lancer le serveur

Avec Node.js installé (développement effectué avec Node.js 24), depuis la racine :

```sh
node apps/server/index.js
```

Le serveur écoute sur `http://127.0.0.1:3000`, uniquement sur la machine locale.
`Ctrl+C` l'arrête. Aucune dépendance externe n'est nécessaire à ce stade.

Ouvrir cette adresse dans le navigateur. Le meneur saisit la clé affichée dans
le terminal, démarre la partie puis génère une invitation à partager à un joueur.
Le joueur ouvre le lien dans un autre onglet, puis confirme son entrée. Le secret
du lien est lu depuis le fragment de l'URL, puis retiré de la barre d'adresse.
Les changements d'état arrivent par événements SSE, sans actualisation périodique
visible. Les liens utilisant `127.0.0.1` fonctionnent uniquement sur la même machine.

Les fichiers web sont lus au lancement : redémarrer le serveur et recharger les
pages après une modification HTML ou JavaScript côté navigateur.

| Méthode | Route | Action |
| --- | --- | --- |
| GET | `/api/session` | Consulter l'état et l'identifiant de la partie |
| POST | `/api/session/start` | Démarrer une partie avec un nouvel UUID |
| POST | `/api/session/stop` | Arrêter la partie et remettre son identifiant à `null` |
| POST | `/api/session/invitation` | Générer une invitation à usage unique (meneur uniquement) |
| POST | `/api/session/join` | Échanger une invitation contre un accès joueur (`201`) |
| GET | `/api/session/me` | Vérifier une clé joueur et retrouver son identité |
| GET | `/api/events` | Recevoir l'état public de la partie en continu (SSE) |
| GET | `/api/profiles` | Consulter les profils sauvegardés (meneur uniquement) |
| POST | `/api/profiles` | Créer un profil avec un pseudo (meneur uniquement) |

Un démarrage ou un arrêt redondant renvoie `409`. Une route inconnue renvoie `404`.
L'état reste en mémoire et revient à `stopped` au redémarrage du serveur.

Le démarrage, l'arrêt et la génération de l'invitation exigent l'en-tête
`Authorization: Bearer <clé du meneur>`. Une clé aléatoire est affichée dans le
terminal du serveur à chaque lancement ; elle doit rester privée et change au
redémarrage. Un accès sans clé valide renvoie `401`.

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

## Profils en cours de développement

Le module `apps/server/profiles.js` permet de créer et charger des profils
contenant un identifiant et un pseudo, sauvegardés dans `data/profiles.json`.
Ce dossier est exclu de Git. Le meneur peut créer et lister les profils depuis
la page, après avoir renseigné sa clé. La création attend un objet JSON
`{"name":"Aldric"}` avec un pseudo de 1 à 40 caractères après suppression
des espaces aux extrémités. Le serveur limite le corps à 4 Kio et sa lecture
à cinq secondes. Le formulaire actualise la liste après une création confirmée.

Les profils seront créés par le meneur et resteront indépendants des invitations.
Après connexion, un joueur sélectionnera un profil libre, réservé à un seul accès.
Le changement de profil devra réserver le nouveau et libérer l'ancien en une seule
opération. Les fiches liées aux profils et leur sélection ne sont pas encore disponibles.

## Vérifications

```sh
node --check apps/server/index.js
node --check apps/server/profiles.js
node --check apps/server/read-json.js
node --check apps/web/app.js
node tests/web-state.test.cjs
node tests/profiles-api.test.cjs
```

Les tests simulent le navigateur et le réseau : ils couvrent les réponses retardées,
la révocation, les erreurs réseau, les délais des actions et la création des profils.
Les tests de l'API utilisent des flux HTTP simulés et un dossier temporaire pour
vérifier les autorisations, les entrées invalides et la persistance des profils.
Ils ne remplacent pas une vérification dans un navigateur réel.

L'UUID identifie la partie et ne constitue pas une autorisation d'accès.
Ce prototype local n'est pas prêt pour une exposition sur Internet.

## Prochaines étapes

- Sélection exclusive et changement de profil par les joueurs.
- Accueil joueur dédié après invitation, puis table de jeu après sélection du profil.
- Interface de bureau Windows et Linux avec Electron ; accès joueurs par navigateur.
- Import de cartes, tokens et illustrations dans une bibliothèque de médias.
- Plateau partagé, sauvegarde des campagnes et configuration de l'accès distant.

## Licence

L'objectif est une distribution open source. La licence reste à choisir avant
la première publication ; aucune licence n'est accordée par ce README.
