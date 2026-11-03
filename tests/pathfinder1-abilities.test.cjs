const test = require("node:test");
const assert = require("node:assert/strict");
const { abilityModifier, adjustedAbilityModifier } = require("../packages/pathfinder1/abilities");
const { defaultSkills } = require("../packages/pathfinder1/skills");

test("calcule les modificateurs Pathfinder, y compris les valeurs impaires et négatives", () => {
  for (const [score, expected] of [[0, -5], [8, -1], [9, -1], [10, 0], [11, 0], [14, 2], [20, 5]]) {
    assert.equal(abilityModifier(score), expected);
  }
});

test("refuse les caractéristiques invalides", () => {
  for (const score of [-1, 1.5, NaN, Infinity, "10"]) {
    assert.throws(() => abilityModifier(score), TypeError);
  }
});

test("la liste de base ne propose plus Autohypnose et garde les identifiants existants", () => {
  const skills = defaultSkills();
  assert.equal(skills.some((skill) => skill.name === "Autohypnose"), false);
  assert.equal(skills.find((skill) => skill.id === "base-27").name, "Artisanat");
});

test("les dégâts, affaiblissements et malus ajustent le modificateur Pathfinder", () => {
  assert.equal(adjustedAbilityModifier(14, { damage: 1, drain: 0, penalty: 0 }), 2);
  assert.equal(adjustedAbilityModifier(14, { damage: 2, drain: 0, penalty: 0 }), 1);
  assert.equal(adjustedAbilityModifier(14, { damage: 0, drain: 1, penalty: 0 }), 1);
  assert.equal(adjustedAbilityModifier(14, { damage: 0, drain: 0, penalty: 3 }), 1);
  assert.equal(adjustedAbilityModifier(14, { damage: 1, drain: 0, penalty: 1 }), 2);
  assert.equal(adjustedAbilityModifier(4, { damage: 20, drain: 0, penalty: 0 }), -5);
  assert.throws(() => adjustedAbilityModifier(14, { damage: -1, drain: 0, penalty: 0 }), TypeError);
});
