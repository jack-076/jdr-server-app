/** @param {string} expression @returns {number[]} */
function parseAttackBonuses(expression) {
  if (typeof expression !== "string" || !/^\s*[+-]?\d{1,4}(?:\s*\/\s*[+-]?\d{1,4}){0,9}\s*$/.test(expression)) {
    throw Object.assign(new Error("Saisis les bonus d'attaque sous la forme +8 ou +8/+3."), { statusCode: 400 });
  }
  return expression.split("/").map((value) => Number(value.trim()));
}

/** @param {string} expression @returns {{count: number, sides: number, modifier: number}} */
function parseDamage(expression) {
  const match = typeof expression === "string" && expression.match(/^\s*(\d{0,2})d(\d{1,4})(?:\s*([+-])\s*(\d{1,4}))?\s*$/i);
  if (!match) throw Object.assign(new Error("Saisis les dégâts sous la forme 1d8+4 ou 2d6-1."), { statusCode: 400 });
  const count = match[1] === "" ? 1 : Number(match[1]);
  const sides = Number(match[2]);
  const modifier = match[3] === "-" ? -Number(match[4]) : Number(match[4] || 0);
  if (count < 1 || count > 20 || sides < 2 || sides > 1000) {
    throw Object.assign(new Error("Utilise de 1 à 20 dés ayant chacun de 2 à 1000 faces."), { statusCode: 400 });
  }
  return { count, sides, modifier };
}

module.exports = { parseAttackBonuses, parseDamage };
