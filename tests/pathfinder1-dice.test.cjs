const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAttackBonuses, parseDamage } = require("../packages/pathfinder1/dice");

test("lit les bonus d'attaque et les formules de dégâts simples", () => {
  assert.deepEqual(parseAttackBonuses("+8/+3/-2"), [8, 3, -2]);
  assert.deepEqual(parseDamage("2d6-1"), { count: 2, sides: 6, modifier: -1 });
  assert.deepEqual(parseDamage("d8 + 4"), { count: 1, sides: 8, modifier: 4 });
});

test("refuse les expressions invalides, trop grandes ou non prises en charge", () => {
  for (const expression of ["", "1d6+1d4", "0d6", "21d6", "1d1", "1d9999", "1d6;alert(1)"]) {
    assert.throws(() => parseDamage(expression));
  }
  for (const expression of ["", "+8/", "+8; process.exit()", "+10000"]) assert.throws(() => parseAttackBonuses(expression));
});
