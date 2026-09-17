# JDR Server App

Projet de table de jeu de rôle virtuelle, hébergée sur la machine du meneur,
écrite en JavaScript et destinée à devenir une alternative open source à Foundry.

Le projet dispose d'un premier serveur HTTP local. L'application de bureau
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

| Méthode | Route | Action |
| --- | --- | --- |
| GET | `/api/session` | Consulter l'état et l'identifiant de la partie |
| POST | `/api/session/start` | Démarrer une partie avec un nouvel UUID |
| POST | `/api/session/stop` | Arrêter la partie et remettre son identifiant à `null` |
| GET | `/api/session/invitation` | Récupérer le secret d'invitation de la partie active (meneur uniquement) |

Un démarrage ou un arrêt redondant renvoie `409`. Une route inconnue renvoie `404`.
L'état reste en mémoire et revient à `stopped` au redémarrage du serveur.

Le démarrage, l'arrêt et la récupération de l'invitation exigent l'en-tête
`Authorization: Bearer <clé du meneur>`. Une clé aléatoire est affichée dans le
terminal du serveur à chaque lancement ; elle doit rester privée et change au
redémarrage. Un accès sans clé valide renvoie `401`.

Chaque partie reçoit un secret d'invitation distinct, effacé à l'arrêt et exclu
des réponses publiques. La route d'invitation renvoie `409` sans partie active
et `Cache-Control: no-store` lors d'une récupération réussie. Rejoindre une partie
avec cette invitation n'est pas encore implémenté.

L'UUID identifie la partie et ne constitue pas une autorisation d'accès.
Ce prototype local n'est pas prêt pour une exposition sur Internet.

## Prochaines étapes

- Connexion des joueurs par invitation et révocation des accès.
- Interface de bureau Windows et Linux avec Electron ; accès joueurs par navigateur.
- Import de cartes, tokens et illustrations dans une bibliothèque de médias.
- Plateau partagé, sauvegarde des campagnes et configuration de l'accès distant.

## Licence

L'objectif est une distribution open source. La licence reste à choisir avant
la première publication ; aucune licence n'est accordée par ce README.
