const { randomUUID } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync, unlinkSync } = require("node:fs");
const path = require("node:path");
const { inspectImage } = require("./map-store");

const directory = path.join(__dirname, "../../data/token-images");
const MAX_TOKEN_IMAGE_BYTES = 5 * 1024 * 1024;

/** @param {Buffer} bytes @param {string} contentType */
function saveTokenImage(bytes, contentType) {
  if (bytes.length > MAX_TOKEN_IMAGE_BYTES) {
    throw Object.assign(new Error("L'image du pion dépasse 5 Mio."), { statusCode: 413 });
  }
  const info = inspectImage(bytes);
  if (info.mimeType !== contentType || (info.mimeType !== "image/png" && info.mimeType !== "image/jpeg")) {
    throw Object.assign(new Error("Le contenu ne correspond pas au type d'image."), { statusCode: 400 });
  }
  const image = { id: randomUUID(), mimeType: /** @type {"image/png" | "image/jpeg"} */ (info.mimeType) };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(directory, image.id), bytes, { mode: 0o600, flag: "wx" });
  return image;
}

/** @param {import("./token-store").TokenImage} image */
function readTokenImage(image) {
  return readFileSync(path.join(directory, image.id));
}

/** @param {import("./token-store").TokenImage} image */
function deleteTokenImage(image) {
  try { unlinkSync(path.join(directory, image.id)); } catch {}
}

module.exports = { MAX_TOKEN_IMAGE_BYTES, saveTokenImage, readTokenImage, deleteTokenImage };
