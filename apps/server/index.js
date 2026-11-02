const http = require("node:http");
const { openHostPage } = require("./open-host-page");
const { randomUUID, randomBytes, timingSafeEqual } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { getProfiles, createProfile, assignHostRole } = require("./profiles");
const { readJson } = require("./read-json");
const { getCampaign, updateCampaign } = require("./campaign");
const { MAX_MAP_BYTES, getCurrentMap, saveMap, readCurrentMap } = require("./map-store");
const { readBytes } = require("./read-bytes");
const { listTokens, listTokensOnGrid, createToken, moveToken, removeToken } = require("./token-store");
const homePage = readFileSync(path.join(__dirname, "../web/index.html"));
const browserScript = readFileSync(path.join(__dirname, "../web/app.js"));
const boardScript = readFileSync(path.join(__dirname, "../web/board.js"));
const mapScript = readFileSync(path.join(__dirname, "../web/map.js"));
const tokenScript = readFileSync(path.join(__dirname, "../web/tokens.js"));
const gridScript = readFileSync(path.join(__dirname, "../../packages/shared/grid.js"));
const styleSheet = readFileSync(path.join(__dirname, "../web/style.css"));
const hostKey = randomBytes(32).toString("hex");

const session = {
    id: null,
    status: "stopped",
    invitationToken: null,
};

const players = new Map();
let hostProfileId = null;
let mapUploadInProgress = false;
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

function broadcastCampaignUpdate() {
  for (const response of sessionStreams) {
    const sent = response.write(
      "event: campaign-updated\ndata: {}\n\n"
    );

    if (!sent) {
      response.destroy();
    }
  }
}

function broadcastMapUpdate() {
  for (const response of sessionStreams) {
    if (!response.write("event: map-updated\ndata: {}\n\n")) response.destroy();
  }
}

function broadcastTokenUpdate() {
  for (const response of sessionStreams) {
    if (!response.write("event: tokens-updated\ndata: {}\n\n")) response.destroy();
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

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/host")) {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(homePage);
    return;
  }

  if (request.method === "GET" && url.pathname === "/style.css") {
    response.writeHead(200, {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(styleSheet);
    return;
  }

  if (request.method === "GET" && url.pathname === "/board.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(boardScript);
    return;
  }

  if (request.method === "GET" && url.pathname === "/map.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(mapScript);
    return;
  }

  if (request.method === "GET" && url.pathname === "/grid.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(gridScript);
    return;
  }

  if (request.method === "GET" && url.pathname === "/tokens.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(tokenScript);
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

  if (request.method === "GET" && url.pathname === "/api/tokens") {
    response.setHeader("Cache-Control", "no-store");
    if (!isHost(request) && !getPlayer(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Authentification requise." }));
      return;
    }
    try {
      const map = getCurrentMap();
      const tokens = map ? listTokensOnGrid(map) : [];
      response.writeHead(200);
      response.end(JSON.stringify({ map, tokens }));
    } catch {
      response.writeHead(500);
      response.end(JSON.stringify({ error: "Impossible de charger les pions." }));
    }
    return;
  }

  const tokenRoute = url.pathname.match(/^\/api\/tokens\/([0-9a-f-]+)$/);
  if (tokenRoute && request.method === "DELETE") {
    response.setHeader("Cache-Control", "no-store");
    if (!isHost(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Authentification du meneur requise." }));
      return;
    }
    try {
      const map = getCurrentMap();
      if (!map || url.searchParams.get("mapId") !== map.id) {
        response.writeHead(409);
        response.end(JSON.stringify({ error: "La carte a changé. Réessaie." }));
        return;
      }
      if (!removeToken(map.id, tokenRoute[1])) {
        response.writeHead(404);
        response.end(JSON.stringify({ error: "Pion introuvable." }));
        return;
      }
      broadcastTokenUpdate();
      response.writeHead(200);
      response.end(JSON.stringify({ status: "deleted" }));
    } catch {
      response.writeHead(500);
      response.end(JSON.stringify({ error: "Impossible de supprimer le pion." }));
    }
    return;
  }

  if ((request.method === "POST" && url.pathname === "/api/tokens") ||
      (request.method === "PATCH" && tokenRoute)) {
    response.setHeader("Cache-Control", "no-store");
    const host = isHost(request);
    const player = host ? null : getPlayer(request);
    if ((!host && !player) || (request.method === "POST" && !host)) {
      response.writeHead(401, { Connection: "close" });
      response.end(JSON.stringify({ error: request.method === "POST" ? "Authentification du meneur requise." : "Authentification requise." }));
      return;
    }
    const contentType = request.headers["content-type"]?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      response.writeHead(415, { Connection: "close" });
      response.end(JSON.stringify({ error: "Le contenu doit être envoyé en JSON." }));
      return;
    }
    try {
      const body = await readJson(request);
      if (!host && getPlayer(request) !== player) {
        response.writeHead(401);
        response.end(JSON.stringify({ error: "Accès joueur invalide ou partie inactive." }));
        return;
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        response.writeHead(400);
        response.end(JSON.stringify({ error: "Données du pion invalides." }));
        return;
      }
      const map = getCurrentMap();
      if (!map || body.mapId !== map.id) {
        response.writeHead(409);
        response.end(JSON.stringify({ error: "La carte a changé. Réessaie." }));
        return;
      }
      let token;
      if (request.method === "POST") {
        if (body.ownerProfileId !== null && !getProfiles().some((profile) => profile.id === body.ownerProfileId)) {
          response.writeHead(400);
          response.end(JSON.stringify({ error: "Profil introuvable." }));
          return;
        }
        token = createToken(map, body);
      } else {
        const existing = listTokens(map.id).find((item) => item.id === tokenRoute[1]);
        if (!existing) {
          response.writeHead(404);
          response.end(JSON.stringify({ error: "Pion introuvable." }));
          return;
        }
        if (!host && (!player.profileId || existing.ownerProfileId !== player.profileId)) {
          response.writeHead(403);
          response.end(JSON.stringify({ error: "Tu ne peux déplacer que tes pions." }));
          return;
        }
        token = moveToken(map, existing.id, body.x, body.y);
      }
      broadcastTokenUpdate();
      response.writeHead(request.method === "POST" ? 201 : 200);
      response.end(JSON.stringify({ token }));
    } catch (error) {
      if (response.destroyed) return;
      const status = [400, 408, 409, 413].includes(error.statusCode) ? error.statusCode : 500;
      response.writeHead(status, { Connection: "close" });
      response.end(JSON.stringify({ error: status === 500 ? "Impossible d'enregistrer le pion." : error.message }));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/map") {
    response.setHeader("Cache-Control", "no-store");
    if (!isHost(request) && !getPlayer(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Authentification requise." }));
      return;
    }
    try {
      const map = getCurrentMap();
      response.writeHead(200);
      response.end(JSON.stringify({ map }));
    } catch {
      response.writeHead(500);
      response.end(JSON.stringify({ error: "Impossible de lire la carte." }));
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/map/image") {
    response.setHeader("Cache-Control", "no-store");
    if (!isHost(request) && !getPlayer(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: "Authentification requise." }));
      return;
    }
    try {
      const image = readCurrentMap(url.searchParams.get("id"));
      if (!image) {
        response.writeHead(404);
        response.end(JSON.stringify({ error: "Carte introuvable." }));
        return;
      }
      response.writeHead(200, {
        "Content-Type": image.map.mimeType,
        "Content-Length": image.bytes.length,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
      response.end(image.bytes);
    } catch {
      response.writeHead(500);
      response.end(JSON.stringify({ error: "Impossible de lire l'image." }));
    }
    return;
  }

  if (request.method === "PUT" && url.pathname === "/api/map") {
    response.setHeader("Cache-Control", "no-store");
    if (!isHost(request)) {
      response.writeHead(401, { Connection: "close" });
      response.end(JSON.stringify({ error: "Authentification du meneur requise." }));
      return;
    }
    const contentType = request.headers["content-type"]?.split(";")[0].trim().toLowerCase();
    if (!["image/png", "image/jpeg"].includes(contentType)) {
      response.writeHead(415, { Connection: "close" });
      response.end(JSON.stringify({ error: "Choisis une image PNG ou JPEG." }));
      return;
    }
    if (mapUploadInProgress) {
      response.writeHead(409, { Connection: "close" });
      response.end(JSON.stringify({ error: "Un import de carte est déjà en cours." }));
      return;
    }
    mapUploadInProgress = true;
    try {
      const bytes = await readBytes(request, MAX_MAP_BYTES);
      if (response.destroyed) return;
      const map = saveMap(bytes, contentType);
      broadcastMapUpdate();
      response.writeHead(200);
      response.end(JSON.stringify({ map }));
    } catch (error) {
      if (response.destroyed) return;
      const status = [400, 408, 413].includes(error.statusCode) ? error.statusCode : 500;
      response.writeHead(status, { Connection: "close" });
      response.end(JSON.stringify({ error: status === 500 ? "Impossible d'enregistrer la carte." : error.message }));
    } finally {
      mapUploadInProgress = false;
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/map/training") {
    response.setHeader("Cache-Control", "no-store");
    if (!isHost(request)) {
      response.writeHead(401, { Connection: "close" });
      response.end(JSON.stringify({ error: "Authentification du meneur requise." }));
      return;
    }
    if (request.headers["transfer-encoding"] ||
        (request.headers["content-length"] && request.headers["content-length"] !== "0")) {
      response.writeHead(400, { Connection: "close" });
      response.end(JSON.stringify({ error: "Cette requête ne doit pas contenir de fichier." }));
      return;
    }
    if (mapUploadInProgress) {
      response.writeHead(409, { Connection: "close" });
      response.end(JSON.stringify({ error: "Un import de carte est déjà en cours." }));
      return;
    }
    mapUploadInProgress = true;
    try {
      const image = readFileSync(path.join(__dirname, "../../assets/maps/terrain-entrainement.png"));
      const map = saveMap(image, "image/png");
      broadcastMapUpdate();
      response.writeHead(200);
      response.end(JSON.stringify({ map }));
    } catch {
      response.writeHead(500);
      response.end(JSON.stringify({ error: "Impossible de charger le terrain d'entraînement." }));
    } finally {
      mapUploadInProgress = false;
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/campaign") {
    response.setHeader("Cache-Control", "no-store");

    if (!isHost(request) && !getPlayer(request)) {
      response.writeHead(401);
      response.end(JSON.stringify({
        error: "Authentification du meneur ou du joueur requise",
      }));
      return;
    }

    response.writeHead(200);
    response.end(JSON.stringify({
      campaign: getCampaign(),
    }));
    return;
  }

  if (request.method === "PUT" && url.pathname === "/api/campaign") {
    response.setHeader("Cache-Control", "no-store");

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
      response.writeHead(415, { Connection: "close" });
      response.end(JSON.stringify({
        error: "Le contenu doit être envoyé en JSON.",
      }));
      return;
    }

    try {
      const body = await readJson(request, 16384);
      const campaign = updateCampaign(body);
      broadcastCampaignUpdate();

      response.writeHead(200);
      response.end(JSON.stringify({ campaign }));
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
          ? "Impossible de sauvegarder la campagne."
          : error.message,
      }));
    }

    return;
  }

  if (url.pathname === "/api/host/profile" && ["GET", "POST"].includes(request.method)) {
    response.setHeader("Cache-Control", "no-store");
    if (!isHost(request)) {
      response.writeHead(401, { Connection: "close" });
      response.end(JSON.stringify({ error: "Authentification du meneur requise" }));
      return;
    }
    if (request.method === "GET") {
      const profile = getProfiles().find((item) => item.id === hostProfileId && item.role === "host") || null;
      response.writeHead(200);
      response.end(JSON.stringify({ profile }));
      return;
    }
    const contentType = request.headers["content-type"]?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      response.writeHead(415, { Connection: "close" });
      response.end(JSON.stringify({ error: "Le contenu doit être envoyé en JSON." }));
      return;
    }
    try {
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.profileId !== "string") {
        response.writeHead(400);
        response.end(JSON.stringify({ error: "Un identifiant de profil est requis." }));
        return;
      }
      const profile = getProfiles().find((item) => item.id === body.profileId);
      if (!profile) {
        response.writeHead(404);
        response.end(JSON.stringify({ error: "Profil introuvable." }));
        return;
      }
      removeExpiredPlayers();
      if ([...players.values()].some((player) => player.profileId === profile.id)) {
        response.writeHead(409);
        response.end(JSON.stringify({ error: "Ce profil est utilisé par un joueur." }));
        return;
      }
      const hostProfile = assignHostRole(profile.id);
      hostProfileId = hostProfile.id;
      response.writeHead(200);
      response.end(JSON.stringify({ profile: hostProfile }));
    } catch (error) {
      if (response.destroyed) return;
      const status = [400, 408, 413].includes(error.statusCode) ? error.statusCode : 500;
      response.writeHead(status, { Connection: "close" });
      response.end(JSON.stringify({ error: status === 500 ? "Impossible de choisir le profil du meneur." : error.message }));
    }
    return;
  }

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
      profiles: getProfiles().filter((profile) => isHost(request) || profile.role !== "host"),
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

      if (profile.role === "host") {
        response.writeHead(403);
        response.end(JSON.stringify({ error: "Ce profil est réservé au meneur." }));
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
    const hostUrl = `http://127.0.0.1:3000/host#host=${hostKey}`;
    console.log(`Lien privé du meneur (ne pas partager) : ${hostUrl}`);
    openHostPage(hostUrl);
});
