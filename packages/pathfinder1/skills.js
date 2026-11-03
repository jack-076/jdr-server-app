const defaults = [
  ["Acrobaties", "adventure", "dexterity", true, false], ["Bluff", "adventure", "charisma", false, false],
  ["Escalade", "adventure", "strength", true, false], ["Diplomatie", "adventure", "charisma", false, false],
  ["Sabotage", "adventure", "dexterity", true, true], ["Déguisement", "adventure", "charisma", false, false],
  ["Évasion", "adventure", "dexterity", true, false], ["Vol", "adventure", "dexterity", true, false],
  ["Premiers secours", "adventure", "wisdom", false, false], ["Intimidation", "adventure", "charisma", false, false],
  ["Connaissances (mystères)", "adventure", "intelligence", false, true], ["Connaissances (exploration)", "adventure", "intelligence", false, true],
  ["Connaissances (local)", "adventure", "intelligence", false, true], ["Connaissances (nature)", "adventure", "intelligence", false, true],
  ["Connaissances (plans)", "adventure", "intelligence", false, true], ["Connaissances (religion)", "adventure", "intelligence", false, true],
  ["Perception", "adventure", "wisdom", false, false], ["Équitation", "adventure", "dexterity", true, false],
  ["Psychologie", "adventure", "wisdom", false, false], ["Art de la magie", "adventure", "intelligence", false, true],
  ["Discrétion", "adventure", "dexterity", true, false], ["Survie", "adventure", "wisdom", false, false],
  ["Natation", "adventure", "strength", true, false], ["Utilisation d'objets magiques", "adventure", "charisma", false, true],
  ["Estimation", "background", "intelligence", false, false], ["Art", "background", "intelligence", false, false],
  ["Autohypnose", "background", "wisdom", false, true], ["Artisanat", "background", "intelligence", false, false],
  ["Dressage", "background", "charisma", false, true], ["Connaissances (ingénierie)", "background", "intelligence", false, true],
  ["Connaissances (géographie)", "background", "intelligence", false, true], ["Connaissances (histoire)", "background", "intelligence", false, true],
  ["Connaissances (noblesse)", "background", "intelligence", false, true], ["Linguistique", "background", "intelligence", false, true],
  ["Savoir", "background", "intelligence", false, true], ["Représentation", "background", "charisma", false, false],
  ["Profession", "background", "wisdom", false, true], ["Escamotage", "background", "dexterity", true, true],
];

/** @returns {import('../../apps/server/character-store').Skill[]} */
function defaultSkills() {
  return defaults.map(([name, group, ability, armorPenalty, trainedOnly], index) => ({
    id: `base-${index}`, name: String(name), group: /** @type {'adventure' | 'background'} */ (group),
    ability: String(ability), armorPenalty: Boolean(armorPenalty), trainedOnly: Boolean(trainedOnly),
    ranks: 0, classSkill: false, misc: 0,
  })).filter((skill) => skill.id !== "base-26");
}

module.exports = { defaultSkills };
