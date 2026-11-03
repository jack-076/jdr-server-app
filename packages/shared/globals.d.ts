/** API de la grille chargée directement dans le navigateur. */
declare var JdrGrid: {
    GRID_SIZE: number;
    snapToGrid(value: number, limit: number): number;
};
declare var PathfinderAbilities: {
    abilityModifier(score: number): number;
    adjustedAbilityModifier(score: number, adjustment: {damage: number, drain: number, penalty: number}): number;
};
