const http = require("node:http");
const { randomUUID, randomBytes, timingSafeEqual } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { getProfiles, createProfile } = require("./profiles");
const { readJson } = require("./read-json");
const homePage = readFileSync(path.join(__dirname, "../web/index.html"));
const browserScript = readFileSync(path.join(__dirname, "../web/app.js"));
const hostKey = randomBytes(32).toString("hex");

const session = {
    id: null,
    status: "stopped",
    invitationToken: null,
};

const players = new Map();
const PLAYER_TIMEOUT_MS = 30 * 60 * 1000;
const sessionStreams = new Set();

function removeExpiredPlayers() {
  const now = Date.now();

  for (const [token, player] of players) {
    if (now - player.lastSeenAt >= PLAYER_TIMEOUT_MS) {
      players.delete(token);
    }
  }
}

function getPublicSession() {
  return {
    id: session.id,
    status: session.status,
  };
}

function sendSessionEvent(response) {
  const data = JSON.stringify(getPublicSession());

  if (!response.write(`event: session\ndata: ${data}\n\n`)) {
    response.destroy();
  }
}

function broadcastSession() {
  for (const response of sessionStreams) {
    sendSessionEvent(response);
  }
}

function hasBearerToken(request, token) {
  const received = request.headers.authorization;

  if (typeof received !== "string" || typeof token !== "string") {
    return false;
  }

  const expected = Buffer.from(`Bearer ${token}`);
  const provided = Buffer.from(received);

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

function isHost(request) {
  return hasBearerToken(request, hostKey);
}

function getPlayer(request) {
  if (session.status !== "running") {
    return null;
  }

  removeExpiredPlayers();

  for (const [token, player] of players) {
    if (hasBearerToken(request, token) && player.sessionId === session.id) {
      player.lastSeenAt = Date.now();
      return player;
    }
  }
  return null;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:3000");

  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(homePage);
    return;
  }

  if (request.method === "GET" && url.pathname === "/app.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(browserScript);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    if (sessionStreams.size >= 64) {
      response.writeHead(503, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Trop de connexions ouvertes.");
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    sessionStreams.add(response);

    const heartbeat = setInterval(() => {
      if (!response.write(": ping\n\n")) {
        response.destroy();
      }
    }, 25000);

    response.on("close", () => {
      clearInterval(heartbeat);
      sessionStreams.delete(response);
    });

    sendSessionEvent(response);
    return;
  }

  response.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  if (request.method === "GET" && url.pathname === "/api/profiles") {
    if (!isHost(request) && !getPlayer(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({
        error: "Authentification du meneur ou du joueur requise",
      }));
      return;
    }

    response.setHeader("Cache-Control", "no-store");
    response.writeHead(200);
    response.end(JSON.stringify({
      profiles: getProfiles(),
    }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/profiles") {
    response.setHeader("Cache-control", "no-store");

    if (!isHost(request)) {
      response.writeHead(401, { Connection: "close" });
      response.end(JSON.stringify({
        error: "Authentification du meneur requise",
      }));
      return;
    }

    const contentType = request.headers["content-type"]
      ?.split(";")[0].trim().toLowerCase();

    if (contentType !== "application/json") {
      response.writeHead(415, { Connection: "close"});
      response.end(JSON.stringify({
        error: "Le contenu doit être envoyé en JSON.",
      }));
      return;
    }

    try {
      const body = await readJson(request);

      if (
        body === null ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        typeof body.name !== "string" ||
        body.name.trim().length < 1 ||
        body.name.trim().length > 40
      ) {
        response.writeHead(400);
        response.end(JSON.stringify({
          error: "Le pseudo doit contenir entre 1 et 40 caractères.",
        }));
        return;
      }

      const profile = createProfile(body.name);

      response.writeHead(201);
      response.end(JSON.stringify({ profile }));
    } catch (error) {
      if (response.destroyed){
        return;
      }

      const statusCode = [400, 408, 413].includes(error.statusCode)
        ? error.statusCode
        : 500;

      response.writeHead(statusCode, { connection: "close"});
      response.end(JSON.stringify({
        error: statusCode === 500
          ? "Impossible de sauvegarder le profil."
          : error.message,
      }));
    }

    return;
  }

  if (request.method === "GET" && url.pathname === "/api/session") {
    response.writeHead(200);
    response.end(JSON.stringify(getPublicSession()));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session/start") {
    if (!isHost(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({
        error: "Authentification du meneur requise",
      }));
      return;
    }

    if (session.status === "running") {
      response.writeHead(409);
      response.end(JSON.stringify({
        error: "Une partie est déjà en cours",
      }));
      return;
    }

    session.id = randomUUID();
    session.invitationToken = null;
    session.status = "running";
    broadcastSession();

    response.writeHead(200);
    response.end(JSON.stringify(getPublicSession()));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session/stop") {
    if (!isHost(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({
        error: "Authentification du meneur requise",
      }));
      return;
    }

    if (session.status === "stopped") {
        response.writeHead(409);
        response.end(JSON.stringify( {
            error: "La session est déjà à l’arrêt",
        }));
        return;
    }

    session.id = null;
    session.invitationToken = null;
    players.clear();
    session.status = "stopped";
    broadcastSession();

    response.writeHead(200);
    response.end(JSON.stringify(getPublicSession()));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session/invitation") {
    if (!isHost(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({
        error: "Authentification du meneur requise",
      }));
      return;
    }

    if (session.status !== "running") {
      response.writeHead(409);
      response.end(JSON.stringify({
        error: "Aucune partie en cours",
      }));
      return;
    }

    session.invitationToken = randomBytes(32).toString("hex");

    response.setHeader("Cache-Control", "no-store");
    response.writeHead(200);
    response.end(JSON.stringify({
      sessionId: session.id,
      invitationToken: session.invitationToken,
    }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session/join") {

    if (session.status !== "running" || !hasBearerToken(request, session.invitationToken)) {
      response.writeHead(401);
      response.end(JSON.stringify({
        error: "Invitation invalide ou partie inactive",
      }));
      return;
    }

    removeExpiredPlayers();

    if (players.size >= 20) {
      response.writeHead(409);
      response.end(JSON.stringify({
        error: "La partie a atteint sa limite de joueurs",
      }));
      return;
    }

    const playerId = randomUUID();
    const playerToken = randomBytes(32).toString("hex");

    players.set(playerToken, {
      id: playerId,
      sessionId: session.id,
      profileId: null,
      lastSeenAt: Date.now(),
    });

    session.invitationToken = null;

    response.setHeader("Cache-Control", "no-store");
    response.writeHead(201);
    response.end(JSON.stringify({
      playerId,
      playerToken,
      session: getPublicSession(),
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/session/me") {
    response.setHeader("Cache-Control", "no-store");

    const player = getPlayer(request);

    if (player === null) {
      response.writeHead(401);
      response.end(JSON.stringify({
        error: "Accès joueur invalide ou partie inactive",
      }));
      return;
    }

    response.writeHead(200);
    response.end(JSON.stringify({
      playerId: player.id,
      profileId: player.profileId,
      session: getPublicSession(),
    }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session/profile") {
    response.setHeader("Cache-Control", "no-store");

    const player = getPlayer(request);

    if (player === null) {
      response.writeHead(401, { Connection: "close" });
      response.end(JSON.stringify({
        error: "Accès joueur invalide ou partie inactive",
      }));
      return;
    }

    const contentType = request.headers["content-type"]
      ?.split(";")[0].trim().toLowerCase();

    if (contentType !== "application/json") {
      response.writeHead(415, { Connection: "close" });
      response.end(JSON.stringify({
        error: "Le contenu doit être envoyé en JSON.",
      }));
      return;
    }

    try {
      const body = await readJson(request);

      // L'accès peut avoir été révoqué pendant la lecture du corps.
      if (getPlayer(request) !== player) {
        response.writeHead(401);
        response.end(JSON.stringify({
          error: "Accès joueur invalide ou partie inactive",
        }));
        return;
      }

      if (
        body === null ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        typeof body.profileId !== "string" ||
        body.profileId.length === 0
      ) {
        response.writeHead(400);
        response.end(JSON.stringify({
          error: "Un identifiant de profil est requis.",
        }));
        return;
      }
      const profile = getProfiles().find(
        (item) => item.id === body.profileId
      );

      if (!profile) {
        response.writeHead(404);
        response.end(JSON.stringify({
          error: "Ce profil n'existe pas.",
        }));
        return;
      }

      const occupied = [...players.values()].some(
        (other) => other.id !== player.id &&
        other.profileId === profile.id
      );

      if (occupied) {
        response.writeHead(409);
        response.end(JSON.stringify({
          error: "Ce profil est déjà utilisé par un autre joueur.",
        }));
        return;
      }

      player.profileId = profile.id;

      response.writeHead(200);
      response.end(JSON.stringify({
        playerId: player.id,
        profile,
      }));
    } catch (error) {
      if (response.destroyed) {
        return;
      }

      const statusCode = [400, 408, 413].includes(error.statusCode)
        ? error.statusCode
        : 500;

      response.writeHead(statusCode, { Connection: "close" });
      response.end(JSON.stringify({
        error: statusCode === 500
          ? "Impossible de sélectionner le profil."
          : error.message,
      }));
    }

    return;
  }

  response.writeHead(404);
  response.end(JSON.stringify({
    error: "Route introuvable",
  }));
});

setInterval(removeExpiredPlayers, 60 * 1000).unref();

server.listen(3000, "127.0.0.1", () => {
    console.log("Serveur accessible sur http://127.0.0.1:3000");
    console.log(`Clé du meneur : ${hostKey}`);
});
