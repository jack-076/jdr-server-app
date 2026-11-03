const { randomUUID } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } = require("node:fs");
const path = require("node:path");
const { snapToGrid } = require("../../packages/shared/grid");

const directory = path.join(__dirname, "../../data/tokens");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_TOKENS = 100;

/** @typedef {{id: string, mimeType: "image/png" | "image/jpeg"}} TokenImage */
/** @typedef {{id: string, name: string, ownerProfileId: string | null, x: number, y: number, image?: TokenImage}} Token */
/** @typedef {{id: string, width: number, height: number}} MapDimensions */
/** @typedef {{name: string, ownerProfileId: string | null, x: number, y: number}} TokenInput */

/** @param {string} message @param {number} [statusCode] @returns {never} */
function problem(message, statusCode = 400) {
  const error = Object.assign(new Error(message), { statusCode });
  throw error;
}

/** @param {string} mapId */
function fileFor(mapId) {
  if (typeof mapId !== "string" || !uuidPattern.test(mapId)) problem("Carte invalide.");
  return path.join(directory, `${mapId}.json`);
}

/** @param {Token} token */
function validToken(token) {
  return token && typeof token === "object" && uuidPattern.test(token.id) &&
    typeof token.name === "string" && token.name.trim().length > 0 && token.name.length <= 40 &&
    (token.ownerProfileId === null || (typeof token.ownerProfileId === "string" && token.ownerProfileId.length > 0 && token.ownerProfileId.length <= 100)) &&
    Number.isFinite(token.x) && token.x >= 0 && Number.isFinite(token.y) && token.y >= 0 &&
    (token.image === undefined || (token.image !== null && typeof token.image === "object" &&
      typeof token.image.id === "string" && uuidPattern.test(token.image.id) &&
      (token.image.mimeType === "image/png" || token.image.mimeType === "image/jpeg")));
}

/** @param {string} mapId @returns {Token[]} */
function listTokens(mapId) {
  /** @type {Token[]} */
  let data;
  try {
    data = JSON.parse(readFileSync(fileFor(mapId), "utf8"));
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  if (!Array.isArray(data) || data.length > MAX_TOKENS || !data.every(validToken) ||
      new Set(data.map((token) => token.id)).size !== data.length) {
    throw new Error("Données des pions invalides.");
  }
  return data.map((token) => ({ ...token }));
}

/** @param {MapDimensions} map */
function listTokensOnGrid(map) {
  return listTokens(map.id).map((token) => ({
    ...token,
    x: snapToGrid(token.x, map.width),
    y: snapToGrid(token.y, map.height),
  }));
}

/** @param {string} mapId @param {Token[]} tokens */
function saveTokens(mapId, tokens) {
  const filename = fileFor(mapId);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(tokens, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, filename);
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

/** @param {MapDimensions} map @param {number} x @param {number} y */
function validatePosition(map, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > map.width || y > map.height) {
    problem("La position doit se trouver sur la carte.");
  }
}

/** @param {MapDimensions} map @param {TokenInput} input */
function createToken(map, input) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 40) problem("Le nom du pion doit contenir entre 1 et 40 caractères.");
  if (input.ownerProfileId !== null && (typeof input.ownerProfileId !== "string" || !input.ownerProfileId || input.ownerProfileId.length > 100)) {
    problem("Profil du pion invalide.");
  }
  validatePosition(map, input.x, input.y);
  const tokens = listTokens(map.id);
  if (tokens.length >= MAX_TOKENS) problem("La limite de 100 pions est atteinte.", 409);
  const token = { id: randomUUID(), name, ownerProfileId: input.ownerProfileId,
    x: snapToGrid(input.x, map.width), y: snapToGrid(input.y, map.height) };
  tokens.push(token);
  saveTokens(map.id, tokens);
  return { ...token };
}

/** @param {MapDimensions} map @param {string} id @param {number} x @param {number} y */
function moveToken(map, id, x, y) {
  validatePosition(map, x, y);
  const tokens = listTokens(map.id);
  const token = tokens.find((item) => item.id === id);
  if (!token) return null;
  token.x = snapToGrid(x, map.width);
  token.y = snapToGrid(y, map.height);
  saveTokens(map.id, tokens);
  return { ...token };
}

/** @param {string} mapId @param {string} id */
function removeToken(mapId, id) {
  const tokens = listTokens(mapId);
  const updated = tokens.filter((token) => token.id !== id);
  if (updated.length === tokens.length) return false;
  saveTokens(mapId, updated);
  return true;
}

/** @param {string} mapId @param {string} id @param {TokenImage} image */
function setTokenImage(mapId, id, image) {
  const tokens = listTokens(mapId);
  const token = tokens.find((item) => item.id === id);
  if (!token) return null;
  token.image = image;
  saveTokens(mapId, tokens);
  return { ...token };
}

module.exports = { listTokens, listTokensOnGrid, createToken, moveToken, removeToken, setTokenImage };
