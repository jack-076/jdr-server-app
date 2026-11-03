const { randomUUID } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } = require("node:fs");
const path = require("node:path");
const { defaultSkills } = require("../../packages/pathfinder1/skills");

const directory = path.join(__dirname, "../../data/characters");
const attributes = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** @typedef {{id: string, name: string, group: 'adventure' | 'background', ability: string, ranks: number, classSkill: boolean, armorPenalty: boolean, trainedOnly: boolean, misc: number}} Skill */
/** @typedef {{id: string, name: string, category: string, quantity: number, weight: number, equipped: boolean, description: string}} InventoryItem */
/** @typedef {{name: string, scores: Record<string, number>, revision: number, level: number, hitPoints: {current: number, maximum: number, temporary: number, nonlethal: number}, armorCheckPenalty: number, skills: Skill[], biography: {appearance: string, history: string}, notes: string, inventory: {items: InventoryItem[], currency: Record<string, number>}, combat: Record<string, number>}} Character */
const itemCategories = ["weapon", "armor", "equipment", "consumable", "gear", "ammunition", "misc", "trade", "container"];
const defaultCombat = { baseAttack: 0, maneuverBonus: 0, melee: 0, ranged: 0, initiative: 0,
  armorClass: 10, touch: 10, flatFooted: 10, maneuverDefense: 10, flatFootedManeuverDefense: 10,
  fortitude: 0, reflex: 0, will: 0, spellResistance: 0 };
/** @param {string} profileId */
function fileFor(profileId) {
  if (!uuid.test(profileId)) throw Object.assign(new Error("Profil invalide."), { statusCode: 400 });
  return path.join(directory, `${profileId}.json`);
}

/** @param {unknown} data @param {boolean} [allowLegacy] @returns {Character} */
function validate(data, allowLegacy = false) {
  if (!data || typeof data !== "object" || !("name" in data) || typeof data.name !== "string" ||
      data.name.trim().length > 80 || !("revision" in data) || !Number.isSafeInteger(data.revision) ||
      /** @type {number} */ (data.revision) < 0 || !("scores" in data) || !data.scores || typeof data.scores !== "object") {
    throw Object.assign(new Error("Fiche invalide."), { statusCode: 400 });
  }
  const source = /** @type {Record<string, unknown>} */ (data.scores);
  /** @type {Record<string, number>} */
  const scores = {};
  for (const name of attributes) {
    const score = source[name];
    if (typeof score !== "number" || !Number.isSafeInteger(score) || score < 0 || score > 1000) {
      throw Object.assign(new Error("Chaque caractéristique doit être un entier entre 0 et 1000."), { statusCode: 400 });
    }
    scores[name] = score;
  }
  const level = "level" in data ? data.level : allowLegacy ? 1 : undefined;
  const hp = "hitPoints" in data ? data.hitPoints : allowLegacy ? { current: 0, maximum: 0, temporary: 0, nonlethal: 0 } : null;
  if (typeof level !== "number" || !Number.isSafeInteger(level) || level < 1 || level > 1000 ||
      !hp || typeof hp !== "object") {
    throw Object.assign(new Error("Niveau ou points de vie invalides."), { statusCode: 400 });
  }
  const values = /** @type {Record<string, unknown>} */ (hp);
  for (const field of ["current", "maximum", "temporary", "nonlethal"]) {
    const value = values[field];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (field === "current" ? -1000000 : 0) || value > 1000000) {
      throw Object.assign(new Error("Points de vie invalides."), { statusCode: 400 });
    }
  }
  const armorCheckPenalty = "armorCheckPenalty" in data ? data.armorCheckPenalty : allowLegacy ? 0 : undefined;
  const rawSkills = "skills" in data ? data.skills : allowLegacy ? defaultSkills() : undefined;
  if (typeof armorCheckPenalty !== "number" || !Number.isSafeInteger(armorCheckPenalty) || armorCheckPenalty < -1000 || armorCheckPenalty > 0 ||
      !Array.isArray(rawSkills) || rawSkills.length > 100) {
    throw Object.assign(new Error("Compétences invalides."), { statusCode: 400 });
  }
  /** @type {Skill[]} */
  const skills = [];
  const seen = new Set();
  for (const item of rawSkills) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(item.id) || seen.has(item.id) ||
        typeof item.name !== "string" || !item.name.trim() || item.name.length > 80 ||
        !["adventure", "background"].includes(item.group) || !attributes.includes(item.ability) ||
        !Number.isSafeInteger(item.ranks) || item.ranks < 0 || item.ranks > 1000 ||
        !Number.isSafeInteger(item.misc) || item.misc < -1000 || item.misc > 1000 ||
        typeof item.classSkill !== "boolean" || typeof item.armorPenalty !== "boolean" || typeof item.trainedOnly !== "boolean") {
      throw Object.assign(new Error("Compétence invalide."), { statusCode: 400 });
    }
    seen.add(item.id);
    skills.push({ id: item.id, name: item.name.trim(), group: item.group, ability: item.ability, ranks: item.ranks,
      classSkill: item.classSkill, armorPenalty: item.armorPenalty, trainedOnly: item.trainedOnly, misc: item.misc });
  }
  const biography = "biography" in data ? data.biography : allowLegacy ? { appearance: "", history: "" } : null;
  const notes = "notes" in data ? data.notes : allowLegacy ? "" : undefined;
  if (!biography || typeof biography !== "object" || !("appearance" in biography) || typeof biography.appearance !== "string" || biography.appearance.length > 2000 ||
      !("history" in biography) || typeof biography.history !== "string" || biography.history.length > 4000 ||
      typeof notes !== "string" || notes.length > 4000) {
    throw Object.assign(new Error("Biographie ou notes invalides."), { statusCode: 400 });
  }
  const inventory = "inventory" in data ? data.inventory : allowLegacy ? { items: [], currency: { pp: 0, gp: 0, sp: 0, cp: 0 } } : null;
  if (!inventory || typeof inventory !== "object" || !("items" in inventory) || !Array.isArray(inventory.items) || inventory.items.length > 100 ||
      !("currency" in inventory) || !inventory.currency || typeof inventory.currency !== "object") {
    throw Object.assign(new Error("Inventaire invalide."), { statusCode: 400 });
  }
  /** @type {InventoryItem[]} */
  const items = [];
  const itemIds = new Set();
  for (const item of inventory.items) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(item.id) || itemIds.has(item.id) ||
        typeof item.name !== "string" || !item.name.trim() || item.name.length > 80 || !itemCategories.includes(item.category) ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 0 || item.quantity > 100000 ||
        typeof item.weight !== "number" || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 100000 ||
        typeof item.equipped !== "boolean" || typeof item.description !== "string" || item.description.length > 500) {
      throw Object.assign(new Error("Objet d'inventaire invalide."), { statusCode: 400 });
    }
    itemIds.add(item.id);
    items.push({ id: item.id, name: item.name.trim(), category: item.category, quantity: item.quantity, weight: item.weight,
      equipped: item.equipped, description: item.description });
  }
  /** @type {Record<string, number>} */
  const currency = {};
  const money = /** @type {Record<string, unknown>} */ (inventory.currency);
  for (const coin of ["pp", "gp", "sp", "cp"]) {
    const count = money[coin];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > 1000000000) {
      throw Object.assign(new Error("Monnaie invalide."), { statusCode: 400 });
    }
    currency[coin] = count;
  }
  const rawCombat = "combat" in data ? data.combat : allowLegacy ? defaultCombat : null;
  if (!rawCombat || typeof rawCombat !== "object" || Array.isArray(rawCombat)) {
    throw Object.assign(new Error("Statistiques de combat invalides."), { statusCode: 400 });
  }
  const combatSource = /** @type {Record<string, unknown>} */ (rawCombat);
  /** @type {Record<string, number>} */
  const combat = {};
  for (const field of Object.keys(defaultCombat)) {
    const value = combatSource[field];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < -10000 || value > 10000) {
      throw Object.assign(new Error("Statistique de combat invalide."), { statusCode: 400 });
    }
    combat[field] = value;
  }
  return { name: data.name.trim(), revision: /** @type {number} */ (data.revision), scores, level,
    hitPoints: { current: /** @type {number} */ (values.current), maximum: /** @type {number} */ (values.maximum),
      temporary: /** @type {number} */ (values.temporary), nonlethal: /** @type {number} */ (values.nonlethal) }, armorCheckPenalty, skills,
      biography: { appearance: biography.appearance, history: biography.history }, notes, inventory: { items, currency }, combat };
}

/** @param {string} profileId @returns {Character} */
function getCharacter(profileId) {
  try {
    return validate(JSON.parse(readFileSync(fileFor(profileId), "utf8")), true);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { name: "", revision: 0, scores: Object.fromEntries(attributes.map((name) => [name, 10])),
        level: 1, hitPoints: { current: 0, maximum: 0, temporary: 0, nonlethal: 0 }, armorCheckPenalty: 0, skills: defaultSkills(),
        biography: { appearance: "", history: "" }, notes: "", inventory: { items: [], currency: { pp: 0, gp: 0, sp: 0, cp: 0 } }, combat: { ...defaultCombat } };
    }
    throw error;
  }
}

/** @param {string} profileId @param {unknown} data */
function saveCharacter(profileId, data) {
  const sheet = validate(data);
  if (sheet.revision !== getCharacter(profileId).revision) {
    throw Object.assign(new Error("Cette fiche a été modifiée ailleurs. Recharge-la avant de réessayer."), { statusCode: 409 });
  }
  sheet.revision++;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(sheet, null, 2), { mode: 0o600, flag: "wx" });
    renameSync(temporary, fileFor(profileId));
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
  return sheet;
}

module.exports = { getCharacter, saveCharacter };
