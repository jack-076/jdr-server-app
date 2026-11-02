const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const grid = require('../packages/shared/grid');
const source = fs.readFileSync(path.join(__dirname, '../apps/web/tokens.js'), 'utf8');
const tokenKey = 'a'.repeat(64);
const map = { id: 'map-one', width: 500, height: 300 };
const reply = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function node() {
  const captures = new Set();
  return {
    listeners: {}, children: [], style: {}, attrs: {}, dataset: {}, value: '', disabled: false,
    addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); },
    replaceChildren(...items) { this.children = items; },
    append(item) { item.parent = this; this.children.push(item); },
    get firstChild() { return this.children[0]; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); },
    setAttribute(name, value) { this.attrs[name] = value; },
    focus() {},
    setPointerCapture(id) { captures.add(id); },
    hasPointerCapture(id) { return captures.has(id); },
    releasePointerCapture(id) { captures.delete(id); },
  };
}
function page({ host = false, handler, profile = { id: 'alice' } } = {}) {
  const ids = ['board-tokens', 'board-viewport', 'token-manager', 'token-form', 'token-name', 'token-owner', 'token-create', 'token-delete', 'token-status'];
  const nodes = Object.fromEntries(ids.map(id => [id, node()]));
  const calls = [], windowListeners = {};
  const window = {
    location: { pathname: host ? '/host' : '/' },
    MapView: { currentId: () => 'map-one' }, BoardCamera: { getZoom: () => 2 }, JdrGrid: grid,
    addEventListener(type, callback) { windowListeners[type] = callback; },
  };
  const context = vm.createContext({
    document: { getElementById: id => nodes[id], createElement: () => node() },
    window, hostKeyInput: { value: host ? tokenKey : '' }, playerToken: host ? null : tokenKey,
    currentPlayerProfile: profile, AbortSignal, encodeURIComponent, console: { error() {} },
    fetch(url, options) { calls.push({ url, options }); return handler(url, options); },
  });
  vm.runInContext(source, context);
  const fire = (element, name, props = {}) => {
    const event = { preventDefault() {}, stopPropagation() {}, ...props };
    return (element.listeners[name] || [])[0]?.(event);
  };
  return { nodes, calls, window, context, fire };
}

test('le MJ crée puis supprime un pion attribué', async () => {
  let tokens = [];
  const p = page({ host: true, handler: async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${tokenKey}`);
    if (url === '/api/profiles') return reply({ profiles: [{ id: 'alice', name: 'Alice' }] });
    if (url === '/api/tokens' && !options.method) return reply({ map, tokens });
    if (url === '/api/tokens' && options.method === 'POST') {
      const input = JSON.parse(options.body);
      assert.deepEqual(input, { mapId: 'map-one', name: 'Alice', ownerProfileId: 'alice', x: 264, y: 168 });
      tokens = [{ id: 'one', ...input }];
      return reply({ token: tokens[0] }, 201);
    }
    assert.equal(url, '/api/tokens/one?mapId=map-one');
    assert.equal(options.method, 'DELETE');
    tokens = [];
    return reply({ status: 'deleted' });
  } });
  await flush();
  assert.equal(p.nodes['token-manager'].hidden, false);
  p.nodes['token-name'].value = '  Alice  ';
  p.nodes['token-owner'].value = 'alice';
  await p.fire(p.nodes['token-form'], 'submit');
  assert.equal(p.nodes['board-tokens'].children.length, 1);
  assert.equal(p.nodes['board-tokens'].children[0].attrs['data-initial'], 'A');
  assert.equal(p.nodes['board-tokens'].children[0].firstChild.textContent, 'Alice');
  assert.equal(p.nodes['token-delete'].disabled, false);
  await p.fire(p.nodes['token-delete'], 'click');
  assert.equal(p.nodes['board-tokens'].children.length, 0);
});

test('un joueur déplace son pion en coordonnées de carte malgré le zoom', async () => {
  let tokens = [{ id: 'one', name: 'Alice', ownerProfileId: 'alice', x: 120, y: 120 }];
  const p = page({ handler: async (url, options) => {
    if (!options.method) return reply({ map, tokens });
    assert.equal(options.method, 'PATCH');
    const body = JSON.parse(options.body);
    assert.deepEqual(body, { mapId: 'map-one', x: 168, y: 120 });
    tokens = [{ ...tokens[0], x: body.x, y: body.y }];
    return reply({ token: tokens[0] });
  } });
  await flush();
  assert.equal(p.nodes['token-manager'].hidden, true);
  const button = p.nodes['board-tokens'].children[0];
  p.fire(button, 'pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
  assert.equal(p.nodes['board-tokens'].children.length, 2);
  const ghost = p.nodes['board-tokens'].children[1];
  assert.equal(ghost.className, 'board-token board-token-ghost');
  assert.equal(ghost.attrs['aria-hidden'], 'true');
  p.fire(button, 'pointermove', { pointerId: 1, clientX: 110, clientY: 60 });
  assert.equal(button.style.left, '120px');
  assert.equal(button.style.top, '120px');
  assert.equal(ghost.style.left, '168px');
  assert.equal(ghost.style.top, '120px');
  assert.equal(p.calls.filter(call => call.options.method === 'PATCH').length, 0);
  p.fire(button, 'pointerup', { pointerId: 1 });
  assert.equal(p.nodes['board-tokens'].children.length, 1);
  assert.equal(button.style.left, '168px');
  await flush();
  assert.equal(p.calls.filter(call => call.options.method === 'PATCH').length, 1);
  assert.equal(p.nodes['board-tokens'].children[0].style.left, '168px');
});

test('un joueur ne déplace pas le pion d’un autre et peut toujours utiliser le clic droit', async () => {
  const p = page({ handler: async () => reply({ map, tokens: [{ id: 'one', name: 'Bob', ownerProfileId: 'bob', x: 100, y: 100 }] }) });
  await flush();
  const button = p.nodes['board-tokens'].children[0];
  let stopped = false;
  p.fire(button, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0, stopPropagation() { stopped = true; } });
  assert.equal(p.nodes['board-tokens'].children.length, 1);
  p.fire(button, 'pointermove', { pointerId: 1, clientX: 100, clientY: 0 });
  p.fire(button, 'pointerup', { pointerId: 1 });
  assert.equal(stopped, false);
  assert.equal(p.calls.length, 1);
  p.fire(button, 'pointerdown', { button: 2, pointerId: 2, stopPropagation() { stopped = true; } });
  assert.equal(stopped, false);
});

test('la réponse tardive à un déplacement ne réaffiche rien après révocation', async () => {
  const pending = deferred();
  const p = page({ handler: (url, options) => options.method ? pending.promise : Promise.resolve(reply({ map, tokens: [{ id: 'one', name: 'Alice', ownerProfileId: 'alice', x: 100, y: 100 }] })) });
  await flush();
  const button = p.nodes['board-tokens'].children[0];
  p.fire(button, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  p.fire(button, 'pointermove', { pointerId: 1, clientX: 40, clientY: 0 });
  p.fire(button, 'pointerup', { pointerId: 1 });
  p.context.playerToken = null;
  p.window.TokenView.clear();
  pending.resolve(reply({ token: { id: 'one' } }));
  await flush();
  assert.equal(p.nodes['board-tokens'].children.length, 0);
});

test('un changement de carte interrompt le glisser sans modifier l’ancienne carte', async () => {
  const p = page({ handler: async () => reply({ map, tokens: [{ id: 'one', name: 'Alice', ownerProfileId: 'alice', x: 100, y: 100 }] }) });
  await flush();
  const button = p.nodes['board-tokens'].children[0];
  p.fire(button, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  p.fire(button, 'pointermove', { pointerId: 1, clientX: 40, clientY: 0 });
  await p.window.TokenView.refresh(); // La notification reçue pendant le glisser est mise en attente.
  p.window.MapView.currentId = () => 'map-two';
  p.fire(p.nodes['board-viewport'], 'map-loaded');
  p.fire(button, 'pointerup', { pointerId: 1 });
  await flush();
  assert.equal(p.nodes['board-tokens'].children.length, 0);
  assert.equal(p.calls.filter(call => call.options.method === 'PATCH').length, 0);
});

test("le pion ne revient pas à son ancien emplacement pendant la confirmation", async () => {
  const pending = deferred();
  let tokens = [{ id: 'one', name: 'Alice', ownerProfileId: 'alice', x: 120, y: 120 }];
  const p = page({ handler: (url, options) => options.method
    ? pending.promise
    : Promise.resolve(reply({ map, tokens })) });
  await flush();
  const button = p.nodes['board-tokens'].children[0];
  p.fire(button, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  p.fire(button, 'pointermove', { pointerId: 1, clientX: 100, clientY: 0 });
  p.fire(button, 'pointerup', { pointerId: 1 });
  p.fire(button, 'click'); // Le navigateur émet aussi un clic à la fin du glisser.
  assert.equal(p.nodes['board-tokens'].children[0], button);
  assert.equal(button.style.left, '168px');
  tokens = [{ ...tokens[0], x: 168 }];
  pending.resolve(reply({ token: tokens[0] }));
  await flush();
  assert.equal(p.nodes['board-tokens'].children[0], button);
  assert.equal(button.style.left, '168px');
});

test("une mise à jour distante conserve l'élément pour animer son déplacement", async () => {
  let tokens = [{ id: 'one', name: 'Alice', ownerProfileId: 'alice', x: 72, y: 72 }];
  const p = page({ handler: async () => reply({ map, tokens }) });
  await flush();
  const button = p.nodes['board-tokens'].children[0];
  tokens = [{ ...tokens[0], x: 120 }];
  await p.window.TokenView.refresh();
  assert.equal(p.nodes['board-tokens'].children[0], button);
  assert.equal(button.style.left, '120px');
});

test("une ancienne lecture arrivée pendant le déplacement ne provoque pas de flash", async () => {
  const oldRead = deferred();
  const moveReply = deferred();
  let reads = 0;
  let tokens = [{ id: 'one', name: 'Alice', ownerProfileId: 'alice', x: 120, y: 120 }];
  const p = page({ handler: (url, options) => {
    if (options.method === 'PATCH') return moveReply.promise;
    reads++;
    return reads === 2 ? oldRead.promise : Promise.resolve(reply({ map, tokens }));
  } });
  await flush();
  const stale = p.window.TokenView.refresh();
  const button = p.nodes['board-tokens'].children[0];
  p.fire(button, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  p.fire(button, 'pointermove', { pointerId: 1, clientX: 100, clientY: 0 });
  p.fire(button, 'pointerup', { pointerId: 1 });
  oldRead.resolve(reply({ map, tokens: [{ ...tokens[0], x: 24 }] }));
  await stale;
  assert.equal(p.nodes['board-tokens'].children[0], button);
  assert.equal(button.style.left, '168px');
  tokens = [{ ...tokens[0], x: 168 }];
  moveReply.resolve(reply({ token: tokens[0] }));
  await flush();
  assert.equal(button.style.left, '168px');
});

test("la position du relâchement est utilisée même sans dernier événement de mouvement", async () => {
  let tokens = [{ id: 'one', name: 'Alice', ownerProfileId: 'alice', x: 120, y: 120 }];
  const p = page({ handler: async (url, options) => {
    if (!options.method) return reply({ map, tokens });
    const body = JSON.parse(options.body);
    tokens = [{ ...tokens[0], x: body.x, y: body.y }];
    return reply({ token: tokens[0] });
  } });
  await flush();
  const button = p.nodes['board-tokens'].children[0];
  p.fire(button, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  assert.equal(button.style.left, '120px');
  p.fire(button, 'pointerup', { pointerId: 1, clientX: 100, clientY: 0 });
  assert.equal(button.style.left, '168px');
  await flush();
  assert.equal(tokens[0].x, 168);
});

test("le fantôme disparaît si le glisser est annulé", async () => {
  const p = page({ handler: async () => reply({ map, tokens: [{ id: 'one', name: 'Alice', ownerProfileId: 'alice', x: 120, y: 120 }] }) });
  await flush();
  const button = p.nodes['board-tokens'].children[0];
  p.fire(button, 'pointerdown', { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
  p.fire(button, 'pointermove', { pointerId: 7, clientX: 100, clientY: 0 });
  assert.equal(p.nodes['board-tokens'].children.length, 2);
  p.fire(button, 'pointercancel', { pointerId: 7 });
  assert.equal(p.nodes['board-tokens'].children.length, 1);
  assert.equal(p.nodes['board-tokens'].children[0].style.left, '120px');
  assert.equal(p.calls.filter(call => call.options.method === 'PATCH').length, 0);
});
