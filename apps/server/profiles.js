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
      profile.name.length <= 40
    ) ||
    new Set(savedProfiles.map((profile) => profile.id)).size !== savedProfiles.length
  ) {
    throw new Error("Le fichier des profils contient des données invalides.");
  }

  profiles = savedProfiles;
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

function getProfiles() {
  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
  }));
}

function createProfile(name) {
  if (typeof name !== "string") {
    throw new Error("Le pseudo doit être du texte.");
  }

  const trimmedName = name.trim();

  if (trimmedName.length < 1 || trimmedName.length > 40) {
    throw new Error("Le pseudo doit contenir entre 1 et 40 caractères.");
  }

  const profile = {
    id: randomUUID(),
    name: trimmedName,
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

module.exports = { getProfiles, createProfile };
