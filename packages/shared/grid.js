(function (root) {
    const GRID_SIZE = 48;

    // Renvoie le centre de la case contenant la position, à l'intérieur de la carte.
    /**
     * @param {number} value Position sur l'axe de la carte.
     * @param {number} limit Dimension de la carte sur cet axe.
     * @returns {number} Centre de la case correspondante.
     */
    function snapToGrid(value, limit) {
        if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) {
            throw new TypeError("Position de grille invalide.");
        }
        const lastCell = Math.floor((limit - GRID_SIZE / 2) / GRID_SIZE);
        if (lastCell < 0) return limit / 2;
        const cell = Math.max(0, Math.min(lastCell, Math.floor(value / GRID_SIZE)));
        return cell * GRID_SIZE + GRID_SIZE / 2;
    }

    const grid = { GRID_SIZE, snapToGrid };
    if (typeof module !== "undefined" && module.exports) module.exports = grid;
    else root.JdrGrid = grid;
})(globalThis);
