const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../apps/web/map.js'), 'utf8');
const token = 'a'.repeat(64);
const map = { id: 'map-one', width: 2, height: 3, mimeType: 'image/png' };
const reply = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data, blob: async () => ({ data: 'image' }) });
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

function page({ host = false, tokenValue = token, fetchHandler, imageDecode } = {}) {
  const ids = ['map-choose', 'map-training', 'map-file', 'map-status', 'board-map', 'board-empty-message', 'board-viewport'];
  const nodes = Object.fromEntries(ids.map(id => [id, {
    listeners: {}, value: '', files: [], hidden: id === 'board-map', disabled: false,
    complete: true, naturalWidth: 2, naturalHeight: 3,
    addEventListener(event, callback) { (this.listeners[event] ||= []).push(callback); },
    dispatchEvent(event) { for (const listener of this.listeners[event.type] || []) listener(event); },
    removeAttribute(name) { delete this[name]; },
    click() { this.clicked = true; },
  }]));
  const created = [], revoked = [], calls = [];
  const fakeUrl = {
    createObjectURL(blob) { const url = `blob:test-${created.length + 1}`; created.push({ url, blob }); return url; },
    revokeObjectURL(url) { revoked.push(url); },
  };
  const window = { location: { pathname: host ? '/host' : '/' } };
  const context = vm.createContext({
    document: { getElementById: id => nodes[id] }, window,
    hostKeyInput: { value: host ? token : '' }, playerToken: tokenValue,
    URL: fakeUrl, encodeURIComponent, Event: class { constructor(type) { this.type = type; } },
    AbortSignal, console: { error() {} },
    Image: class {
      set src(value) {
        if (imageDecode) imageDecode(this, value);
        else queueMicrotask(() => this.onload());
      }
    },
    fetch(url, options) { calls.push({ url, options }); return fetchHandler(url, options); },
  });
  vm.runInContext(source, context);
  return { nodes, window, calls, created, revoked, setPlayerToken: value => { context.playerToken = value; } };
}

test('le MJ importe une carte et la voit sans exposer sa clé dans l’URL', async () => {
  let uploaded = false;
  const p = page({ host: true, fetchHandler: async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    if (options.method === 'PUT') {
      assert.equal(url, '/api/map');
      assert.equal(options.headers['Content-Type'], 'image/png');
      uploaded = true;
      return reply({ map });
    }
    if (url === '/api/map') return reply({ map: uploaded ? map : null });
    assert.equal(url, '/api/map/image?id=map-one');
    return reply({});
  } });
  await flush();
  assert.equal(p.nodes['map-choose'].hidden, false);
  p.nodes['map-file'].files = [{ type: 'image/png', size: 100 }];
  await p.nodes['map-file'].listeners.change[0]();
  assert.equal(p.nodes['board-map'].hidden, false);
  assert.equal(p.nodes['board-empty-message'].hidden, true);
  assert.equal(p.nodes['board-map'].src, 'blob:test-1');
  assert.ok(p.calls.every(call => !call.url.includes(token)));
  assert.equal(p.nodes['map-choose'].disabled, false);
});

test('le joueur reçoit une carte sans accès au bouton d’import', async () => {
  const p = page({ fetchHandler: async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return url === '/api/map' ? reply({ map }) : reply({});
  } });
  await flush();
  assert.equal(p.nodes['map-choose'].hidden, true);
  assert.equal(p.nodes['board-map'].hidden, false);
  assert.equal(p.calls.length, 2);
  await p.window.MapView.refresh();
  assert.equal(p.calls.length, 3); // L'image déjà chargée n'est pas retéléchargée.
});

test('une réponse tardive après révocation ne réaffiche pas la carte', async () => {
  const pending = deferred();
  const p = page({ fetchHandler: () => pending.promise });
  p.setPlayerToken(null);
  p.window.MapView.clear();
  pending.resolve(reply({ map }));
  await flush();
  assert.equal(p.nodes['board-map'].hidden, true);
  assert.equal(p.calls.length, 1);
});

test('un fichier trop gros ou un format incorrect ne part pas au serveur', async () => {
  const p = page({ host: true, fetchHandler: async () => reply({ map: null }) });
  await flush();
  for (const file of [{ type: 'image/svg+xml', size: 5 }, { type: 'image/png', size: 11 * 1024 * 1024 }]) {
    p.nodes['map-file'].files = [file];
    await p.nodes['map-file'].listeners.change[0]();
  }
  assert.equal(p.calls.length, 1);
  assert.match(p.nodes['map-status'].textContent, /10 Mio/);
});

test("le terrain fourni ne remplace une carte qu'au clic du MJ", async () => {
  let activated = false;
  const p = page({ host: true, fetchHandler: async (url, options) => {
    if (url === '/api/map/training') {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      activated = true;
      return reply({ map });
    }
    return url === '/api/map' ? reply({ map: activated ? map : null }) : reply({});
  } });
  await flush();
  assert.equal(p.nodes['map-training'].hidden, false);
  assert.equal(p.calls.filter(call => call.url === '/api/map/training').length, 0);
  await p.nodes['map-training'].listeners.click[0]();
  assert.equal(p.nodes['board-map'].hidden, false);
  assert.equal(p.calls.filter(call => call.url === '/api/map/training').length, 1);
  assert.equal(p.nodes['map-training'].disabled, false);
});
