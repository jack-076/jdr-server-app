const test = require('node:test');
const assert = require('node:assert/strict');
const { GRID_SIZE, snapToGrid } = require('../packages/shared/grid');

test('les positions sont ramenées au centre des cases dans les limites de la carte', () => {
  assert.equal(GRID_SIZE, 48);
  assert.equal(snapToGrid(0, 1536), 24);
  assert.equal(snapToGrid(47.99, 1536), 24);
  assert.equal(snapToGrid(48, 1536), 72);
  assert.equal(snapToGrid(1536, 1536), 1512);
  assert.equal(snapToGrid(-20, 1536), 24);
  assert.equal(snapToGrid(5000, 100), 72);
  assert.equal(snapToGrid(1, 2), 1);
  for (const [value, limit] of [[NaN, 100], [Infinity, 100], [1, 0], [1, NaN]]) {
    assert.throws(() => snapToGrid(value, limit), TypeError);
  }
});
