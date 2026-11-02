const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const grid = require('../packages/shared/grid');
const source = fs.readFileSync(path.join(__dirname, '../apps/web/board.js'), 'utf8');

function board() {
  const ids = ['board-viewport', 'board-map', 'board-grid', 'board-tokens', 'board-reset'];
  const captures = new Set();
  const nodes = Object.fromEntries(ids.map(id => [id, {
    style: {}, dataset: {}, listeners: {}, hidden: id === 'board-map',
    addEventListener(name, callback) { this.listeners[name] = callback; },
    getBoundingClientRect() { return { left: 10, top: 20, width: 800, height: 600 }; },
    focus() {},
    setPointerCapture(id) { captures.add(id); },
    hasPointerCapture(id) { return captures.has(id); },
    releasePointerCapture(id) { captures.delete(id); },
  }]));
  const windowListeners = {};
  vm.runInNewContext(source, {
    document: { getElementById: id => nodes[id] },
    window: { JdrGrid: grid, addEventListener: (name, callback) => { windowListeners[name] = callback; } },
  });
  const viewport = nodes['board-viewport'];
  return {
    nodes, viewport, captures,
    fire(name, data = {}) {
      let prevented = false;
      viewport.listeners[name]({ preventDefault() { prevented = true; }, ...data });
      return prevented;
    },
    click: id => nodes[id].listeners.click(),
    blur: () => windowListeners.blur(),
  };
}

test('la molette conserve le point sous le curseur et limite le zoom', () => {
  const b = board();
  const before = 200 / 48;
  assert.equal(b.fire('wheel', { deltaY: -100, deltaMode: 0, clientX: 210, clientY: 120 }), true);
  const size = parseFloat(b.nodes['board-grid'].style.backgroundSize);
  const x = parseFloat(b.nodes['board-grid'].style.backgroundPosition);
  assert.ok(Math.abs((200 - x) / size - before) < 1e-10);
  for (let i = 0; i < 20; i++) b.fire('keydown', { key: '+' });
  assert.equal(parseFloat(b.nodes['board-grid'].style.backgroundSize), 144);
  for (let i = 0; i < 40; i++) b.fire('keydown', { key: '-' });
  assert.equal(parseFloat(b.nodes['board-grid'].style.backgroundSize), 12);
});

test('seul le clic droit déplace la vue avec la souris', () => {
  const b = board();
  assert.equal(b.fire('pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0 }), false);
  b.fire('pointermove', { pointerId: 1, clientX: 30, clientY: 20 });
  assert.equal(b.nodes['board-grid'].style.backgroundPosition, '0px 0px');
  assert.equal(b.fire('pointerdown', { button: 2, pointerId: 1, clientX: 0, clientY: 0 }), true);
  assert.equal(b.captures.has(1), true);
  b.fire('pointermove', { pointerId: 2, clientX: 500, clientY: 500 });
  assert.equal(b.nodes['board-grid'].style.backgroundPosition, '0px 0px');
  b.fire('pointermove', { pointerId: 1, clientX: 30, clientY: 20 });
  assert.equal(b.nodes['board-grid'].style.backgroundPosition, '30px 20px');
  b.fire('pointerup', { pointerId: 1 });
  b.fire('pointermove', { pointerId: 1, clientX: 80, clientY: 20 });
  assert.equal(b.nodes['board-grid'].style.backgroundPosition, '30px 20px');
  assert.equal(b.captures.size, 0);
  assert.equal(b.fire('contextmenu'), true);
});

test('le tactile reste utilisable et une interruption termine le déplacement', () => {
  const b = board();
  b.fire('pointerdown', { button: 0, pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0 });
  b.fire('pointermove', { pointerId: 1, clientX: 40, clientY: 60 });
  assert.equal(b.nodes['board-grid'].style.backgroundPosition, '40px 60px');
  b.blur();
  assert.equal(b.captures.size, 0);
  b.fire('pointermove', { pointerId: 1, clientX: 80, clientY: 80 });
  assert.equal(b.nodes['board-grid'].style.backgroundPosition, '40px 60px');
});

test('le clavier et Recentrer remettent la vue à zéro sans requête serveur', () => {
  const b = board();
  assert.equal(b.fire('keydown', { key: 'ArrowLeft' }), true);
  assert.equal(b.nodes['board-grid'].style.backgroundPosition, '40px 0px');
  assert.equal(b.fire('keydown', { key: '+', ctrlKey: true }), false);
  b.fire('keydown', { key: '+' });
  assert.ok(Math.abs(parseFloat(b.nodes['board-grid'].style.backgroundSize) - 57.6) < 1e-10);
  b.click('board-reset');
  assert.equal(b.nodes['board-grid'].style.backgroundPosition, '0px 0px');
  assert.equal(parseFloat(b.nodes['board-grid'].style.backgroundSize), 48);
});

test('la carte est centrée puis suit le déplacement et le zoom de la grille', () => {
  const b = board();
  const image = b.nodes['board-map'];
  image.hidden = false;
  image.naturalWidth = 1600;
  image.naturalHeight = 1200;
  b.fire('map-loaded');
  assert.equal(b.nodes['board-grid'].style.backgroundPosition, '40px 30px');
  assert.equal(image.style.transform, 'translate(40px, 30px) scale(0.45)');
  assert.equal(b.nodes['board-tokens'].style.transform, image.style.transform);
  b.fire('pointerdown', { button: 2, pointerId: 1, clientX: 0, clientY: 0 });
  b.fire('pointermove', { pointerId: 1, clientX: 20, clientY: 10 });
  assert.equal(b.nodes['board-grid'].style.backgroundPosition, '60px 40px');
  assert.equal(image.style.transform, 'translate(60px, 40px) scale(0.45)');
  assert.equal(b.nodes['board-tokens'].style.transform, image.style.transform);
  b.click('board-reset');
  assert.equal(image.style.transform, 'translate(40px, 30px) scale(0.45)');
});

test("l'ajustement attend que la table soit visible", () => {
  const b = board();
  const image = b.nodes['board-map'];
  image.hidden = false;
  image.naturalWidth = 1600;
  image.naturalHeight = 1200;
  b.viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
  b.fire('map-loaded');
  assert.equal(image.style.transform, 'translate(0px, 0px) scale(1)');
  b.viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  b.fire('table-opened');
  assert.equal(image.style.transform, 'translate(40px, 30px) scale(0.45)');
});
