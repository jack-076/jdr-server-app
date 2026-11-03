const { randomUUID } = require("node:crypto");
const {
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
} = require("node:fs");
const path = require("node:path");

const dataDirectory = path.join(__dirname, "../../data");
const profilesFile = path.join(dataDirectory, "profiles.json");

/** @typedef {{id: string, name: string, role: "player" | "host"}} Profile */
/** @type {Profile[]} */
let profiles = [];

try {
  const content = readFileSync(profilesFile, "utf8");
  const savedProfiles = JSON.parse(content);

  if (
    !Array.isArray(savedProfiles) ||
    !savedProfiles.every((profile) =>
      profile !== null &&
      typeof profile === "object" &&
      typeof profile.id === "string" &&
      profile.id.length > 0 &&
      typeof profile.name === "string" &&
      profile.name.trim().length > 0 &&
      profile.name.length <= 40 &&
      (profile.role === undefined || ["player", "host"].includes(profile.role))
    ) ||
    new Set(savedProfiles.map((profile) => profile.id)).size !== savedProfiles.length
  ) {
    throw new Error("Le fichier des profils contient des données invalides.");
  }

  profiles = savedProfiles.map((profile) => ({ ...profile, role: profile.role || "player" }));
} catch (error) {
  if (!(error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

function getProfiles() {
  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    role: profile.role,
  }));
}

/** @param {unknown} name */
function createProfile(name) {
  if (typeof name !== "string") {
    throw new Error("Le pseudo doit être du texte.");
  }

  const trimmedName = name.trim();

  if (trimmedName.length < 1 || trimmedName.length > 40) {
    throw new Error("Le pseudo doit contenir entre 1 et 40 caractères.");
  }

  /** @type {Profile} */
  const profile = {
    id: randomUUID(),
    name: trimmedName,
    role: "player",
  };

  const updatedProfiles = [...profiles, profile];
  const temporaryFile = `${profilesFile}.tmp`;

  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });

  writeFileSync(
    temporaryFile,
    JSON.stringify(updatedProfiles, null, 2),
    { encoding: "utf8", mode: 0o600 }
  );

  renameSync(temporaryFile, profilesFile);
  profiles = updatedProfiles;

  return { ...profile };
}

/** @param {string} id */
function assignHostRole(id) {
  const profile = profiles.find((item) => item.id === id);
  if (!profile) return null;
  if (profile.role === "host") return { ...profile };

  /** @type {Profile[]} */
  const updatedProfiles = profiles.map((item) =>
    item.id === id ? { ...item, role: "host" } : item
  );
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const temporaryFile = `${profilesFile}.tmp`;
  writeFileSync(temporaryFile, JSON.stringify(updatedProfiles, null, 2), {
    encoding: "utf8", mode: 0o600,
  });
  renameSync(temporaryFile, profilesFile);
  profiles = updatedProfiles;
  return { ...profile, role: "host" };
}

module.exports = { getProfiles, createProfile, assignHostRole };
