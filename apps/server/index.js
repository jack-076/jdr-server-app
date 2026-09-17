const http = require("node:http");
const { randomUUID } = require("node:crypto");

const session = {
    id: null,
    status: "stopped",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:3000");

  response.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  if (request.method === "GET" && url.pathname === "/api/session") {
    response.writeHead(200);
    response.end(JSON.stringify(session));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session/start") {
    if (session.status === "running") {
        response.writeHead(409);
        response.end(JSON.stringify({
            error: "une partie est déjà en cours",
        }));
        return;
    }

    session.id = randomUUID();
    session.status = "running";

    response.writeHead(200);
    response.end(JSON.stringify(session));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session/stop") {
    if (session.status === "stopped") {
        response.writeHead(409);
        response.end(JSON.stringify( {
            error: "la session est déjà à l'arret",
        }));
        return;
    }

    session.id = null;
    session.status = "stopped";

    response.writeHead(200);
    response.end(JSON.stringify(session));
    return;
  }

  response.writeHead(404);
  response.end(JSON.stringify({
    error: "Route introuvable",
  }));
});

server.listen(3000, "127.0.0.1", () => {
    console.log("Server accessible sur http://127.0.0.1:3000");
});
