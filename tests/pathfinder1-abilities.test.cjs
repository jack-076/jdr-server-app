const test = require("node:test");
const assert = require("node:assert/strict");
const { abilityModifier } = require("../packages/pathfinder1/abilities");

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
