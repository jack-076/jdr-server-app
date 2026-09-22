const http = require("node:http");
const { randomUUID, randomBytes, timingSafeEqual } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const homePage = readFileSync(path.join(__dirname, "../web/index.html"));
const browserScript = readFileSync(path.join(__dirname, "../web/app.js"));
const hostKey = randomBytes(32).toString("hex");

const session = {
    id: null,
    status: "stopped",
    invitationToken: null,
};

const players = new Map();

function getPublicSession() {
  return {
    id: session.id,
    status: session.status,
  };
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

  for (const [token, player] of players) {
    if (hasBearerToken(request, token) && player.sessionId === session.id) {
      return player;
    }
  }
  return null;
}

const server = http.createServer((request, response) => {
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

  response.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

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
      session: getPublicSession(),
    }));
    return;
  }

  response.writeHead(404);
  response.end(JSON.stringify({
    error: "Route introuvable",
  }));
});

server.listen(3000, "127.0.0.1", () => {
    console.log("Serveur accessible sur http://127.0.0.1:3000");
    console.log(`Clé du meneur : ${hostKey}`);
});
