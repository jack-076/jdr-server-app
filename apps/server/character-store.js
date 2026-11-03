const { randomUUID } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } = require("node:fs");
const path = require("node:path");
const { defaultSkills } = require("../../packages/pathfinder1/skills");

const directory = path.join(__dirname, "../../data/characters");
const attributes = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** @typedef {{id: string, name: string, group: 'adventure' | 'background', ability: string, ranks: number, classSkill: boolean, armorPenalty: boolean, trainedOnly: boolean, misc: number}} Skill */
/** @typedef {{id: string, name: string, category: string, quantity: number, weight: number, equipped: boolean, description: string}} InventoryItem */
/** @typedef {{id: string, name: string, category: string, bonus: string, damage: string, range: string}} Attack */
/** @typedef {{id: string, name: string, level: number, cost: number, action: string, description: string}} Spell */
/** @typedef {{id: string, name: string, category: string, action: string, description: string, uses: {current: number, maximum: number} | null}} Feature */
/** @typedef {{id: string, name: string, category: string, duration: string, active: boolean, description: string}} Effect */
/** @typedef {{damage: number, drain: number, penalty: number}} AbilityAdjustment */
/** @typedef {{name: string, scores: Record<string, number>, abilityAdjustments: Record<string, AbilityAdjustment>, revision: number, level: number, hitPoints: {current: number, maximum: number, temporary: number, nonlethal: number}, armorCheckPenalty: number, skills: Skill[], biography: {appearance: string, history: string}, notes: string, inventory: {items: InventoryItem[], currency: Record<string, number>}, combat: Record<string, number>, attacks: Attack[], spells: {points: {current: number, maximum: number}, entries: Spell[]}, features: Feature[], effects: {conditions: string[], entries: Effect[]}, identity: Record<string, string>, movement: Record<string, string>}} Character */
const itemCategories = ["weapon", "armor", "equipment", "consumable", "gear", "ammunition", "misc", "trade", "container"];
const attackCategories = ["weapon", "natural", "class", "ancestry", "item", "misc"];
const featureCategories = ["class", "feat", "trait", "ancestry", "template", "martial", "misc"];
const effectCategories = ["temporary", "spell", "item", "feature", "permanent", "misc", "stance"];
const identityFields = ["gender", "deity", "age", "height", "weight", "alignment", "ancestry"];
const movementFields = ["land", "climb", "swim", "burrow", "fly", "maneuverability"];

/** @param {unknown} value @param {string[]} fields @param {number} maxLength @returns {Record<string, string>} */
function validateTextFields(value, fields, maxLength) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Informations du personnage invalides."), { statusCode: 400 });
  }
  const source = /** @type {Record<string, unknown>} */ (value);
  /** @type {Record<string, string>} */
  const result = {};
  for (const field of fields) {
    const text = source[field];
    if (typeof text !== "string" || text.length > maxLength) {
      throw Object.assign(new Error("Informations du personnage invalides."), { statusCode: 400 });
    }
    result[field] = text.trim();
  }
  return result;
}

/** @param {string[]} fields */
function emptyTextFields(fields) { return Object.fromEntries(fields.map((field) => [field, ""])); }

function defaultAbilityAdjustments() {
  return Object.fromEntries(attributes.map((field) => [field, { damage: 0, drain: 0, penalty: 0 }]));
}
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
  const rawAdjustments = "abilityAdjustments" in data ? data.abilityAdjustments : allowLegacy ? defaultAbilityAdjustments() : null;
  if (!rawAdjustments || typeof rawAdjustments !== "object" || Array.isArray(rawAdjustments)) {
    throw Object.assign(new Error("Ajustements de caractéristique invalides."), { statusCode: 400 });
  }
  const adjustmentSource = /** @type {Record<string, unknown>} */ (rawAdjustments);
  /** @type {Record<string, AbilityAdjustment>} */
  const abilityAdjustments = {};
  for (const attribute of attributes) {
    const entry = adjustmentSource[attribute];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw Object.assign(new Error("Ajustement de caractéristique invalide."), { statusCode: 400 });
    }
    const values = /** @type {Record<string, unknown>} */ (entry);
    for (const field of ["damage", "drain", "penalty"]) {
      const value = values[field];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1000) {
        throw Object.assign(new Error("Les ajustements doivent être des entiers entre 0 et 1000."), { statusCode: 400 });
      }
    }
    abilityAdjustments[attribute] = { damage: /** @type {number} */ (values.damage), drain: /** @type {number} */ (values.drain), penalty: /** @type {number} */ (values.penalty) };
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
    // Les anciennes fiches peuvent contenir cette entrée retirée de la liste de base.
    if (item.id === "base-26" && item.name === "Autohypnose") continue;
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
  const rawAttacks = "attacks" in data ? data.attacks : allowLegacy ? [] : null;
  if (!Array.isArray(rawAttacks) || rawAttacks.length > 100) {
    throw Object.assign(new Error("Liste des attaques invalide."), { statusCode: 400 });
  }
  /** @type {Attack[]} */
  const attacks = [];
  const attackIds = new Set();
  for (const attack of rawAttacks) {
    if (!attack || typeof attack !== "object" || typeof attack.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(attack.id) || attackIds.has(attack.id) ||
        typeof attack.name !== "string" || !attack.name.trim() || attack.name.length > 80 || !attackCategories.includes(attack.category) ||
        typeof attack.bonus !== "string" || attack.bonus.length > 60 || typeof attack.damage !== "string" || attack.damage.length > 80 ||
        typeof attack.range !== "string" || attack.range.length > 40) {
      throw Object.assign(new Error("Attaque invalide."), { statusCode: 400 });
    }
    attackIds.add(attack.id);
    attacks.push({ id: attack.id, name: attack.name.trim(), category: attack.category, bonus: attack.bonus.trim(), damage: attack.damage.trim(), range: attack.range.trim() });
  }
  const rawSpells = "spells" in data ? data.spells : allowLegacy ? { points: { current: 0, maximum: 0 }, entries: [] } : null;
  if (!rawSpells || typeof rawSpells !== "object" || !("points" in rawSpells) || !rawSpells.points || typeof rawSpells.points !== "object" ||
      !("entries" in rawSpells) || !Array.isArray(rawSpells.entries) || rawSpells.entries.length > 100) {
    throw Object.assign(new Error("Liste des sorts invalide."), { statusCode: 400 });
  }
  const points = /** @type {Record<string, unknown>} */ (rawSpells.points);
  if (typeof points.current !== "number" || !Number.isSafeInteger(points.current) || points.current < 0 || points.current > 1000000 ||
      typeof points.maximum !== "number" || !Number.isSafeInteger(points.maximum) || points.maximum < 0 || points.maximum > 1000000) {
    throw Object.assign(new Error("Points de magie invalides."), { statusCode: 400 });
  }
  /** @type {Spell[]} */
  const entries = [];
  const spellIds = new Set();
  for (const spell of rawSpells.entries) {
    if (!spell || typeof spell !== "object" || typeof spell.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(spell.id) || spellIds.has(spell.id) ||
        typeof spell.name !== "string" || !spell.name.trim() || spell.name.length > 80 || !Number.isSafeInteger(spell.level) || spell.level < 0 || spell.level > 9 ||
        !Number.isSafeInteger(spell.cost) || spell.cost < 0 || spell.cost > 1000000 || typeof spell.action !== "string" || spell.action.length > 60 ||
        typeof spell.description !== "string" || spell.description.length > 500) {
      throw Object.assign(new Error("Sort ou capacité invalide."), { statusCode: 400 });
    }
    spellIds.add(spell.id);
    entries.push({ id: spell.id, name: spell.name.trim(), level: spell.level, cost: spell.cost, action: spell.action.trim(), description: spell.description });
  }
  const rawFeatures = "features" in data ? data.features : allowLegacy ? [] : null;
  if (!Array.isArray(rawFeatures) || rawFeatures.length > 100) {
    throw Object.assign(new Error("Liste des capacités invalide."), { statusCode: 400 });
  }
  /** @type {Feature[]} */
  const features = [];
  const featureIds = new Set();
  for (const feature of rawFeatures) {
    if (!feature || typeof feature !== "object" || typeof feature.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(feature.id) || featureIds.has(feature.id) ||
        typeof feature.name !== "string" || !feature.name.trim() || feature.name.length > 80 || !featureCategories.includes(feature.category) ||
        typeof feature.action !== "string" || feature.action.length > 60 || typeof feature.description !== "string" || feature.description.length > 500 ||
        !(feature.uses === null || (typeof feature.uses === "object" &&
          Number.isSafeInteger(feature.uses.current) && feature.uses.current >= 0 && feature.uses.current <= 1000000 &&
          Number.isSafeInteger(feature.uses.maximum) && feature.uses.maximum >= 0 && feature.uses.maximum <= 1000000))) {
      throw Object.assign(new Error("Capacité invalide."), { statusCode: 400 });
    }
    featureIds.add(feature.id);
    features.push({ id: feature.id, name: feature.name.trim(), category: feature.category, action: feature.action.trim(), description: feature.description,
      uses: feature.uses === null ? null : { current: feature.uses.current, maximum: feature.uses.maximum } });
  }
  const rawEffects = "effects" in data ? data.effects : allowLegacy ? { conditions: [], entries: [] } : null;
  if (!rawEffects || typeof rawEffects !== "object" || !("conditions" in rawEffects) || !Array.isArray(rawEffects.conditions) ||
      rawEffects.conditions.length > 50 || !rawEffects.conditions.every((condition) => typeof condition === "string" && /^[a-z0-9-]{1,40}$/.test(condition)) ||
      new Set(rawEffects.conditions).size !== rawEffects.conditions.length || !("entries" in rawEffects) || !Array.isArray(rawEffects.entries) || rawEffects.entries.length > 100) {
    throw Object.assign(new Error("États ou effets invalides."), { statusCode: 400 });
  }
  /** @type {Effect[]} */
  const effects = [];
  const effectIds = new Set();
  for (const effect of rawEffects.entries) {
    if (!effect || typeof effect !== "object" || typeof effect.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(effect.id) || effectIds.has(effect.id) ||
        typeof effect.name !== "string" || !effect.name.trim() || effect.name.length > 80 || !effectCategories.includes(effect.category) ||
        typeof effect.duration !== "string" || effect.duration.length > 60 || typeof effect.active !== "boolean" ||
        typeof effect.description !== "string" || effect.description.length > 500) {
      throw Object.assign(new Error("Effet invalide."), { statusCode: 400 });
    }
    effectIds.add(effect.id);
    effects.push({ id: effect.id, name: effect.name.trim(), category: effect.category, duration: effect.duration.trim(), active: effect.active, description: effect.description });
  }
  const identity = validateTextFields("identity" in data ? data.identity : allowLegacy ? emptyTextFields(identityFields) : null, identityFields, 80);
  const movement = validateTextFields("movement" in data ? data.movement : allowLegacy ? emptyTextFields(movementFields) : null, movementFields, 40);
  return { name: data.name.trim(), revision: /** @type {number} */ (data.revision), scores, abilityAdjustments, level,
    hitPoints: { current: /** @type {number} */ (values.current), maximum: /** @type {number} */ (values.maximum),
      temporary: /** @type {number} */ (values.temporary), nonlethal: /** @type {number} */ (values.nonlethal) }, armorCheckPenalty, skills,
      biography: { appearance: biography.appearance, history: biography.history }, notes, inventory: { items, currency }, combat, attacks,
      spells: { points: { current: points.current, maximum: points.maximum }, entries }, features,
      effects: { conditions: rawEffects.conditions, entries: effects }, identity, movement };
}

/** @param {string} profileId @returns {Character} */
function getCharacter(profileId) {
  try {
    return validate(JSON.parse(readFileSync(fileFor(profileId), "utf8")), true);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { name: "", revision: 0, scores: Object.fromEntries(attributes.map((name) => [name, 10])), abilityAdjustments: defaultAbilityAdjustments(),
        level: 1, hitPoints: { current: 0, maximum: 0, temporary: 0, nonlethal: 0 }, armorCheckPenalty: 0, skills: defaultSkills(),
        biography: { appearance: "", history: "" }, notes: "", inventory: { items: [], currency: { pp: 0, gp: 0, sp: 0, cp: 0 } }, combat: { ...defaultCombat }, attacks: [],
        spells: { points: { current: 0, maximum: 0 }, entries: [] }, features: [], effects: { conditions: [], entries: [] },
        identity: emptyTextFields(identityFields), movement: emptyTextFields(movementFields) };
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
