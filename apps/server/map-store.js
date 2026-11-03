const { randomUUID, createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } = require("node:fs");
const path = require("node:path");

const directory = path.join(__dirname, "../../data/maps");
const currentFile = path.join(directory, "current.json");
const MAX_MAP_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 16384;
const MAX_PIXELS = 40_000_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** @param {string} message @returns {never} */
function invalid(message) {
  const error = Object.assign(new Error(message), { statusCode: 400 });
  throw error;
}

/** @param {number} width @param {number} height */
function checkDimensions(width, height) {
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    invalid("Dimensions de carte invalides ou trop grandes.");
  }
}

// Vérifie la structure et les dimensions. Le décodage complet reste celui du navigateur.
/** @param {Buffer} bytes */
function inspectPng(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  let offset = 8;
  let width = 0, height = 0, hasData = false, hasEnd = false, first = true;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) invalid("Image PNG incomplète.");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (first) {
      if (type !== "IHDR" || length !== 13) invalid("En-tête PNG invalide.");
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      checkDimensions(width, height);
      first = false;
    } else if (type === "IDAT") {
      hasData = true;
    } else if (type === "IEND") {
      if (length !== 0 || end !== bytes.length) invalid("Fin PNG invalide.");
      hasEnd = true;
      break;
    }
    offset = end;
  }
  if (!hasData || !hasEnd) invalid("Image PNG incomplète.");
  return { mimeType: "image/png", extension: "png", width, height };
}

/** @param {Buffer} bytes */
function inspectJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let dimensions = null;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid("Image JPEG invalide.");
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === undefined) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) invalid("Image JPEG incomplète.");
    if (marker === 0xda) {
      if (length < 6 || !dimensions || offset + length >= bytes.length - 2 ||
          bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) invalid("Image JPEG incomplète.");
      return { mimeType: "image/jpeg", extension: "jpg", ...dimensions };
    }
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) invalid("Image JPEG incomplète.");
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      checkDimensions(width, height);
      dimensions = { width, height };
    }
    offset += length;
  }
  invalid("Dimensions JPEG introuvables.");
}

/** @param {Buffer} bytes */
function inspectImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) invalid("Le fichier est vide.");
  if (bytes.length > MAX_MAP_BYTES) {
    const error = Object.assign(new Error("La carte dépasse 10 Mio."), { statusCode: 413 });
    throw error;
  }
  const info = inspectPng(bytes) || inspectJpeg(bytes);
  if (!info) invalid("Seules les images PNG et JPEG sont acceptées.");
  return info;
}

function getCurrentMap() {
  let map;
  try {
    map = JSON.parse(readFileSync(currentFile, "utf8"));
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  if (!map || !uuidPattern.test(map.id) || !["image/png", "image/jpeg"].includes(map.mimeType) ||
      !Number.isInteger(map.width) || !Number.isInteger(map.height)) throw new Error("Données de carte invalides.");
  checkDimensions(map.width, map.height);
  return { id: map.id, mimeType: map.mimeType, width: map.width, height: map.height };
}

/** @param {Buffer} bytes @param {string} [expectedType] */
function saveMap(bytes, expectedType) {
  const { extension, ...info } = inspectImage(bytes);
  if (expectedType && info.mimeType !== expectedType) {
    invalid("Le contenu de l'image ne correspond pas à son type.");
  }
  // La même image garde son identifiant pour retrouver les pions de sa carte.
  const digest = createHash("sha256").update(bytes).digest();
  digest[6] = (digest[6] & 0x0f) | 0x40;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  const map = { id, ...info };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const imageFile = path.join(directory, `${map.id}.${extension}`);
  const temporaryFile = path.join(directory, `${randomUUID()}.tmp`);
  let imageWritten = false;
  try {
    try {
      writeFileSync(imageFile, bytes, { mode: 0o600, flag: "wx" });
      imageWritten = true;
    } catch (error) {
      if (!(error !== null && typeof error === "object" && "code" in error && error.code === "EEXIST") || !readFileSync(imageFile).equals(bytes)) throw error;
    }
    writeFileSync(temporaryFile, JSON.stringify(map), { mode: 0o600, flag: "wx" });
    renameSync(temporaryFile, currentFile);
  } catch (error) {
    if (imageWritten) { try { unlinkSync(imageFile); } catch {} }
    try { unlinkSync(temporaryFile); } catch {}
    throw error;
  }
  return map;
}

/** @param {string | null} id */
function readCurrentMap(id) {
  const map = getCurrentMap();
  if (!map || map.id !== id) return null;
  const extension = map.mimeType === "image/png" ? "png" : "jpg";
  return { map, bytes: readFileSync(path.join(directory, `${map.id}.${extension}`)) };
}

module.exports = { MAX_MAP_BYTES, inspectImage, getCurrentMap, saveMap, readCurrentMap };
