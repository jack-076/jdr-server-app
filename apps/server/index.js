const http = require("node:http");
const { randomUUID, randomBytes, timingSafeEqual } = require("node:crypto");
const hostKey = randomBytes(32).toString("hex");

const session = {
    id: null,
    status: "stopped",
    invitationToken: null,
};

function getPublicSession() {
  return {
    id: session.id,
    status: session.status,
  };
}

function isHost(request) {
  const received = request.headers.authorization;

  if (typeof received !== "string") {
    return false;
  }

  const expected = Buffer.from(`Bearer ${hostKey}`);
  const provided = Buffer.from(received);

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:3000");

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
        error: "une partie est déjà en cours",
      }));
      return;
    }

    session.id = randomUUID();
    session.invitationToken = randomBytes(32).toString("hex");
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
            error: "la session est déjà à l'arret",
        }));
        return;
    }

    session.id = null;
    session.invitationToken = null;
    session.status = "stopped";

    response.writeHead(200);
    response.end(JSON.stringify(getPublicSession()));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/session/invitation") {
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

    response.setHeader("Cache-Control", "no-store");
    response.writeHead(200);
    response.end(JSON.stringify({
      sessionId: session.id,
      invitationToken: session.invitationToken,
    }));
    return;
  }

  response.writeHead(404);
  response.end(JSON.stringify({
    error: "Route introuvable",
  }));
});

server.listen(3000, "127.0.0.1", () => {
    console.log("Server accessible sur http://127.0.0.1:3000");
    console.log(`Clé du meneur : ${hostKey}`);
});
