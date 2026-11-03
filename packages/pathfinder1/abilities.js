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

/**
 * Modificateur de caractéristique utilisé par les jets de compétence.
 * @param {number} score Score avant affaiblissement.
 * @param {{damage: number, drain: number, penalty: number}} adjustment
 * @returns {number}
 */
function adjustedAbilityModifier(score, adjustment) {
  if (!adjustment || [adjustment.damage, adjustment.drain, adjustment.penalty].some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError("Ajustement de caractéristique invalide.");
  }
  const reducedScore = Math.max(0, score - adjustment.drain);
  if (!Number.isSafeInteger(score) || score < 0) throw new TypeError("Caractéristique invalide.");
  return Math.max(-5, abilityModifier(reducedScore) - Math.floor(adjustment.damage / 2) - Math.floor(adjustment.penalty / 2));
}

const abilities = { abilityModifier, adjustedAbilityModifier };
if (typeof module !== "undefined" && module.exports) module.exports = abilities;
else globalThis.PathfinderAbilities = abilities;
