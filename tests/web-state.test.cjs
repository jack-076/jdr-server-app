const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../apps/web/app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../apps/web/index.html"), "utf8");
const token = "a".repeat(64);
const session = { id: "session-one", status: "running" };

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function reply(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

// Simule le DOM, le transport et l'horloge ; aucun serveur réel n'est modifié.
function page(fetchHandler) {
  const writes = [];
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map((match) => {
    const id = match[1];
    let text = "";
    return [id, {
      value: "", disabled: id === "check-access", listeners: {},
      get textContent() { return text; },
      set textContent(value) { text = value; writes.push([id, value]); },
      focus() {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
    }];
  }));
  const stored = new Map();
  const listeners = {};
  const requests = [];
  const deadlines = [];
  const timers = [];
  const context = vm.createContext({
    document: { getElementById(id) { assert.ok(nodes[id], id); return nodes[id]; } },
    window: {
      location: { origin: "http://localhost:3000", hash: "", pathname: "/", search: "" },
      history: { replaceState() {} },
    },
    sessionStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
    URL, URLSearchParams,
    EventSource: class {
      constructor(url) { assert.equal(url, "/api/events"); }
      addEventListener(event, callback) { listeners[event] = callback; }
    },
    AbortSignal: { timeout(ms) {
      const controller = new AbortController();
      deadlines.push({ ms, controller });
      return controller.signal;
    } },
    setTimeout(callback, ms) { timers.push({ callback, ms }); },
    console: { error() {}, warn() {} },
    fetch(url, options) {
      requests.push({ url, options });
      return fetchHandler(url, options);
    },
  });
  vm.runInContext(source, context);
  return {
    nodes, stored, requests, deadlines, timers, writes,
    run: (code) => vm.runInContext(code, context),
    emit: (state) => listeners.session({ data: JSON.stringify(state) }),
    disconnect: () => listeners.error(),
    authenticate() {
      vm.runInContext(`savePlayerToken("${token}")`, context);
      nodes["check-access"].disabled = false;
      nodes["join-session"].disabled = true;
      nodes["join-token"].disabled = true;
    },
  };
}

test("une réponse d'accès retardée ne rétablit pas un accès révoqué", async () => {
  const pending = deferred();
  const p = page(() => pending.promise);
  await flush();
  p.authenticate();
  const check = p.run("checkPlayerAccess({ silent: true })");
  p.emit({ id: null, status: "stopped" });
  assert.equal(p.stored.size, 0);
  assert.equal(p.nodes["join-session"].disabled, false);
  pending.resolve(reply({ playerId: "player-one", session }));
  await check;
  assert.match(p.nodes["player-message"].textContent, /révoqué/);
  assert.equal(p.nodes["session-status"].textContent, "Partie arrêtée");
  assert.equal(p.run("playerToken"), null);
});

test("un arrêt pendant la lecture du JSON invalide aussi la réponse", async () => {
  const body = deferred();
  const p = page(async () => ({ ok: true, status: 200, json: () => body.promise }));
  p.authenticate();
  const check = p.run("checkPlayerAccess({ silent: true })");
  await flush();
  p.emit({ id: null, status: "stopped" });
  body.resolve({ playerId: "player-one", session });
  await check;
  assert.match(p.nodes["player-message"].textContent, /révoqué/);
});

test("un événement pendant une vérification provoque une nouvelle vérification", async () => {
  const pending = deferred();
  let calls = 0;
  const p = page(() => ++calls === 1 ? pending.promise : Promise.resolve(reply({}, 401)));
  p.authenticate();
  const check = p.run("checkPlayerAccess({ silent: true })");
  p.emit({ id: "session-two", status: "running" });
  assert.equal(calls, 1);
  pending.resolve(reply({ playerId: "old-player", session }));
  await check;
  assert.equal(calls, 2);
  assert.equal(p.run("playerToken"), null);
  assert.ok(!p.writes.some(([, text]) => text.includes("old-player")));
});

test("une actualisation HTTP ancienne ne remplace pas un événement récent", async () => {
  const pending = deferred();
  const p = page(() => pending.promise);
  const refresh = p.run("refreshSession()");
  p.emit({ id: null, status: "stopped" });
  pending.resolve(reply(session));
  await refresh;
  assert.equal(p.nodes["session-status"].textContent, "Partie arrêtée");
  assert.equal(p.nodes["refresh-session"].disabled, false);
});

test("une erreur HTTP ancienne ne masque pas l'état SSE récent", async () => {
  const pending = deferred();
  const p = page(() => pending.promise);
  const refresh = p.run("refreshSession()");
  p.emit(session);
  pending.reject(new Error("Network failure"));
  await refresh;
  assert.equal(p.nodes["session-status"].textContent, "Partie en cours");
});

test("une panne conserve la clé, puis un contrôle valide rétablit le message", async () => {
  let failing = true;
  const p = page(async () => {
    if (failing) throw new Error("Network failure");
    return reply({ playerId: "player-one", session });
  });
  p.authenticate();
  await p.run("checkPlayerAccess({ silent: true })");
  assert.equal(p.stored.get("jdr.playerToken"), token);
  assert.equal(p.nodes["check-access"].disabled, false);
  failing = false;
  await p.run("checkPlayerAccess({ silent: true })");
  assert.match(p.nodes["player-message"].textContent, /Accès valide/);
  p.writes.length = 0;
  await p.run("checkPlayerAccess({ silent: true })");
  assert.equal(p.writes.length, 0);
});

for (const action of ["start", "stop", "invitation", "join"]) {
  test(`le délai de ${action} libère les boutons sans relancer l'action`, async () => {
    const p = page((url, options) => new Promise((resolve, reject) => {
      assert.ok(options.signal instanceof AbortSignal);
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    p.nodes["host-key"].value = token;
    p.nodes["join-token"].value = token;
    const operation = action === "join"
      ? p.nodes["join-form"].listeners.submit({ preventDefault() {} })
      : p.run(action === "invitation" ? "getInvitation()" : `changeSession("${action}")`);
    assert.equal(p.deadlines.length, 1);
    assert.equal(p.deadlines[0].ms, 5000);
    p.deadlines[0].controller.abort(new Error("Simulated timeout"));
    await operation;
    for (const id of ["start-session", "stop-session", "get-invitation", "join-session"]) {
      assert.equal(p.nodes[id].disabled, false, id);
    }
    assert.equal(p.requests.length, 1);
    assert.equal(p.run("playerToken"), null);
  });
}
