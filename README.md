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
Dans un autre onglet, le joueur saisit cette invitation pour rejoindre et peut
vérifier son accès avec le bouton dédié. L'actualisation est pour l'instant manuelle.

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

La clé joueur reste uniquement en mémoire dans la page : recharger celle-ci fait
perdre la clé, mais ne supprime pas l'accès côté serveur. Rejoindre à nouveau
nécessite une nouvelle invitation et occupe une place supplémentaire. La reconnexion
et la suppression individuelle des accès ne sont pas encore implémentées.

L'UUID identifie la partie et ne constitue pas une autorisation d'accès.
Ce prototype local n'est pas prêt pour une exposition sur Internet.

## Prochaines étapes

- Actualisation automatique, liens d'invitation et gestion des reconnexions.
- Interface de bureau Windows et Linux avec Electron ; accès joueurs par navigateur.
- Import de cartes, tokens et illustrations dans une bibliothèque de médias.
- Plateau partagé, sauvegarde des campagnes et configuration de l'accès distant.

## Licence

L'objectif est une distribution open source. La licence reste à choisir avant
la première publication ; aucune licence n'est accordée par ce README.
