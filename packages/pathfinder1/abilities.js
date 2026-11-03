/**
 * Calcule le modificateur associé à une caractéristique Pathfinder 1.
 * @param {number} score Valeur entière de la caractéristique.
 * @returns {number}
 */
function abilityModifier(score) {
  if (!Number.isSafeInteger(score) || score < 0) {
    throw new TypeError("La caractéristique doit être un entier positif ou nul.");
  }
  return Math.floor((score - 10) / 2);
}

if (typeof module !== "undefined" && module.exports) module.exports = { abilityModifier };
else globalThis.PathfinderAbilities = { abilityModifier };
