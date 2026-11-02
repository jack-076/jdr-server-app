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
function page(fetchHandler, { savedToken = null, hash = "", pathname = "/", savedHostKey = null, hostProfile = { id: "host-profile", name: "MJ", role: "host" } } = {}) {
  const writes = [];
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map((match) => {
    const id = match[1];
    let text = "";
    return [id, {
      value: "", disabled: id === "check-access", listeners: {}, children: [],
      replaceChildren() { this.children = []; },
      append(item) { this.children.push(item); },
      get textContent() { return text; },
      set textContent(value) { text = value; writes.push([id, value]); },
      focus() {},
      dispatchEvent() {},
      addEventListener(event, callback) { this.listeners[event] = callback; },
    }];
  }));
  const stored = new Map();
  if (savedToken !== null) stored.set("jdr.playerToken", savedToken);
  if (savedHostKey !== null) stored.set("jdr.hostKey", savedHostKey);
  const historyWrites = [];
  const listeners = {};
  const requests = [];
  const deadlines = [];
  const timers = [];
  const context = vm.createContext({
    document: {
      getElementById(id) { assert.ok(nodes[id], id); return nodes[id]; },
      createElement(tag) { return { tag, textContent: "" }; },
    },
    window: {
      location: { origin: "http://localhost:3000", hash, pathname, search: "" },
      history: { replaceState(...args) { historyWrites.push(args); } },
    },
    sessionStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
    URL, URLSearchParams, Event: class { constructor(type) { this.type = type; } },
    EventSource: class {
      constructor(url) { assert.equal(url, "/api/events"); }
      addEventListener(event, callback) { (listeners[event] ||= []).push(callback); }
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
      if (pathname === '/host' && !options.method && url === '/api/profiles') {
        return Promise.resolve(reply({ profiles: [{ id: 'host-profile', name: 'MJ', role: 'host' }] }));
      }
      if (pathname === '/host' && !options.method && url === '/api/host/profile') {
        return Promise.resolve(reply({ profile: hostProfile }));
      }
      return fetchHandler(url, options);
    },
  });
  vm.runInContext(source, context);
  return {
    nodes, stored, requests, deadlines, timers, writes, historyWrites,
    run: (code) => vm.runInContext(code, context),
    emit: (state) => listeners.session.forEach((listener) => listener({ data: JSON.stringify(state) })),
    disconnect: () => listeners.error.forEach((listener) => listener()),
    campaignUpdated: () => listeners["campaign-updated"].forEach((listener) => listener({ data: "{}" })),
    reconnect: () => listeners.open.forEach((listener) => listener()),
    authenticate() {
      vm.runInContext(`savePlayerToken("${token}"); playerProfilesLoaded = true`, context);
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
  assert.equal(p.run("sessionRefreshPending"), false);
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

test("créer un profil actualise la liste et bloque une double soumission", async () => {
  const pending = deferred();
  const name = '<img src=x onerror=alert(1)>';
  const p = page((url, options) => {
    assert.equal(url, '/api/profiles');
    return options.method === 'POST'
      ? pending.promise
      : Promise.resolve(reply({ profiles: [{ id: 'one', name }] }));
  });
  p.nodes['host-key'].value = token;
  p.nodes['profile-name'].value = `  ${name}  `;
  let prevented = false;
  const submit = () => p.nodes['create-profile-form'].listeners.submit({
    preventDefault() { prevented = true; },
  });
  const operation = submit();
  assert.equal(prevented, true);
  await submit();
  assert.equal(p.requests.length, 1);
  assert.equal(p.nodes['load-profiles'].disabled, true);
  assert.equal(p.requests[0].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(p.requests[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(p.requests[0].options.body), { name });
  pending.resolve(reply({ profile: { id: 'one', name } }, 201));
  await operation;
  assert.equal(p.requests.length, 2);
  assert.equal(p.nodes['profiles-list'].children[0].textContent, name);
  assert.equal(p.nodes['profile-name'].value, '');
  assert.match(p.nodes['create-profile-message'].textContent, /a été créé/);
  for (const id of ['profile-name', 'create-profile', 'load-profiles']) {
    assert.equal(p.nodes[id].disabled, false);
  }
});

test("la création refuse une clé ou un pseudo invalide avant envoi", async () => {
  const p = page(() => { throw new Error('Aucun appel attendu'); });
  for (const [key, name] of [['z'.repeat(64), 'Aldric'], [token, '   '], [token, 'a'.repeat(41)]]) {
    p.nodes['host-key'].value = key;
    p.nodes['profile-name'].value = name;
    await p.run('createPlayerProfile({ preventDefault() {} })');
  }
  assert.equal(p.requests.length, 0);
});

test("un refus serveur conserve le pseudo et réactive le formulaire", async () => {
  const p = page(async () => reply({ error: 'Authentification du meneur requise' }, 401));
  p.nodes['host-key'].value = token;
  p.nodes['profile-name'].value = 'Aldric';
  await p.run('createPlayerProfile({ preventDefault() {} })');
  assert.match(p.nodes['create-profile-message'].textContent, /Authentification/);
  assert.equal(p.nodes['profile-name'].value, 'Aldric');
  assert.equal(p.nodes['create-profile'].disabled, false);
  assert.equal(p.nodes['load-profiles'].disabled, false);
  assert.equal(p.requests.length, 1);
});

test("une création sans réponse reste incertaine et n'est pas renvoyée", async () => {
  const p = page((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }));
  p.nodes['host-key'].value = token;
  p.nodes['profile-name'].value = 'Aldric';
  const operation = p.run('createPlayerProfile({ preventDefault() {} })');
  p.deadlines[0].controller.abort(new Error('Timeout'));
  await operation;
  assert.match(p.nodes['create-profile-message'].textContent, /non confirmée/);
  assert.equal(p.nodes['profile-name'].value, 'Aldric');
  for (const id of ['profile-name', 'create-profile', 'load-profiles']) {
    assert.equal(p.nodes[id].disabled, false);
  }
  assert.equal(p.requests.length, 1);
});

test("le bouton envoie le profil en JSON avec l'accès joueur et bloque les doubles envois", async () => {
  const pending = deferred();
  const p = page(() => pending.promise);
  p.authenticate();
  p.nodes['player-profile'].disabled = false;
  p.nodes['player-profile'].value = 'profile-one';
  p.nodes['player-profile'].listeners.change();
  assert.equal(p.nodes['select-profile'].disabled, false);
  let prevented = false;
  const submit = () => p.nodes['select-profile-form'].listeners.submit({
    preventDefault() { prevented = true; },
  });
  const operation = submit();
  await submit();
  assert.equal(prevented, true);
  assert.equal(p.requests.length, 1);
  assert.equal(p.nodes['select-profile'].disabled, true);
  const { url, options } = p.requests[0];
  assert.equal(url, '/api/session/profile');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, `Bearer ${token}`);
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(options.body), { profileId: 'profile-one' });
  pending.resolve(reply({ profile: { id: 'profile-one', name: 'Aldric' } }));
  await operation;
  assert.equal(p.nodes['player-profile-message'].textContent, 'Tu utilises le profil "Aldric".');
  assert.equal(p.nodes['select-profile'].disabled, true);
  assert.equal(p.nodes['select-profile'].hidden, true);
  assert.equal(p.nodes['player-profile'].disabled, true);
  assert.equal(p.nodes['change-profile'].hidden, false);
});


test("le rechargement retrouve le profil même si le navigateur restaure un menu actif", async () => {
  const p = page(async (url) => {
    if (url === '/api/campaign') return reply({ campaign: { title: 'Test', description: '' } });
    if (url === '/api/session/me') {
      return reply({ playerId: 'player-one', profileId: 'profile-one', session });
    }
    assert.equal(url, '/api/profiles');
    return reply({ profiles: [{ id: 'profile-one', name: 'Aldric' }] });
  }, { savedToken: token });
  await flush();
  assert.equal(p.nodes['player-profile'].value, 'profile-one');
  assert.equal(p.nodes['player-profile-message'].textContent, 'Tu utilises le profil "Aldric".');
  assert.equal(p.requests.length, 3);
  assert.equal(p.nodes['game-table'].hidden, false);
  assert.equal(p.nodes['table-profile'].textContent, 'Aldric');
  assert.equal(p.nodes['campaign-title'].textContent, 'Test');
});


function playerWithProfile(fetchHandler) {
  const p = page(fetchHandler);
  p.authenticate();
  p.run('currentPlayerProfile = { id: "old", name: "Aldric" }; updateSelectProfileButton()');
  p.nodes['player-profile'].value = 'old';
  return p;
}

test("annuler le changement retrouve le profil actuel sans requête", () => {
  const p = playerWithProfile(() => { throw new Error('Aucune requête attendue'); });
  p.nodes['change-profile'].listeners.click();
  assert.equal(p.nodes['player-profile'].disabled, false);
  assert.equal(p.nodes['cancel-profile-change'].hidden, false);
  p.nodes['player-profile'].value = 'new';
  p.nodes['cancel-profile-change'].listeners.click();
  assert.equal(p.nodes['player-profile'].value, 'old');
  assert.equal(p.nodes['player-profile'].disabled, true);
  assert.equal(p.nodes['change-profile'].hidden, false);
  assert.equal(p.nodes['cancel-profile-change'].hidden, true);
  assert.equal(p.run('currentPlayerProfile.id'), 'old');
  assert.equal(p.requests.length, 0);
});

for (const accepted of [true, false]) {
  test(accepted ? "le changement confirmé remplace le profil" : "un profil occupé conserve le profil actuel", async () => {
    const pending = deferred();
    const p = playerWithProfile(() => pending.promise);
    p.nodes['change-profile'].listeners.click();
    p.nodes['player-profile'].value = 'new';
    p.nodes['player-profile'].listeners.change();
    const operation = p.nodes['select-profile-form'].listeners.submit({ preventDefault() {} });
    assert.equal(p.nodes['cancel-profile-change'].disabled, true);
    assert.equal(p.nodes['player-profile'].disabled, true);
    p.nodes['cancel-profile-change'].listeners.click();
    assert.equal(p.run('profileChangeMode'), true);
    pending.resolve(accepted
      ? reply({ profile: { id: 'new', name: 'Mira' } })
      : reply({ error: 'Ce profil est déjà utilisé par un autre joueur.' }, 409));
    await operation;
    assert.equal(p.run('currentPlayerProfile.id'), accepted ? 'new' : 'old');
    assert.equal(p.run('profileChangeMode'), !accepted);
    assert.equal(p.nodes['player-profile'].disabled, accepted);
    if (!accepted) {
      assert.match(p.nodes['player-profile-message'].textContent, /déjà utilisé/);
      p.nodes['cancel-profile-change'].listeners.click();
      assert.equal(p.nodes['player-profile'].value, 'old');
    }
  });
}

test("une confirmation tardive ne restaure pas le profil après l'arrêt", async () => {
  const pending = deferred();
  const p = playerWithProfile(() => pending.promise);
  p.nodes['change-profile'].listeners.click();
  p.nodes['player-profile'].value = 'new';
  const operation = p.nodes['select-profile-form'].listeners.submit({ preventDefault() {} });
  p.emit({ id: null, status: 'stopped' });
  pending.resolve(reply({ profile: { id: 'new', name: 'Mira' } }));
  await operation;
  assert.equal(p.run('currentPlayerProfile'), null);
  assert.equal(p.nodes['player-profile'].disabled, true);
  assert.equal(p.nodes['change-profile'].hidden, true);
  assert.equal(p.nodes['cancel-profile-change'].hidden, true);
});


test("le lien joueur connecte automatiquement et retire le secret de l'URL", async () => {
  const invitation = 'b'.repeat(64);
  const p = page(async (url, options) => {
    if (url === '/api/campaign') return reply({ campaign: { title: 'Test', description: '' } });
    if (url === '/api/session/join') {
      assert.equal(options.headers.Authorization, `Bearer ${invitation}`);
      return reply({ playerId: 'one', playerToken: token, session }, 201);
    }
    if (url === '/api/session') return reply(session);
    if (url === '/api/profiles') return reply({ profiles: [] });
    throw new Error(`Route inattendue: ${url}`);
  }, { hash: `#invitation=${invitation}` });
  await flush();
  assert.equal(p.stored.get('jdr.playerToken'), token);
  assert.equal(p.requests.filter(r => r.url === '/api/session/join').length, 1);
  assert.equal(p.historyWrites[0][2], '/');
  assert.equal(p.nodes['host-controls'].hidden, true);
});

test("une invitation refusée ne provoque pas de nouvelle tentative automatique", async () => {
  const p = page(async () => reply({ error: 'Invitation consommée' }, 401), {
    hash: `#invitation=${'b'.repeat(64)}`,
  });
  await flush();
  assert.equal(p.requests.length, 1);
  assert.match(p.nodes['player-message'].textContent, /consommée/);
});

test("la page privée initialise l'accès MJ et le retrouve après F5", () => {
  const noFetch = async (url) => {
    assert.equal(url, '/api/campaign');
    return reply({ campaign: { title: 'Test', description: '' } });
  };
  const p = page(noFetch, { pathname: '/host', hash: `#host=${token}` });
  assert.equal(p.nodes['host-key'].value, token);
  assert.equal(p.nodes['host-controls'].hidden, false);
  assert.equal(p.nodes['player-controls'].hidden, true);
  assert.equal(p.stored.get('jdr.hostKey'), token);
  assert.equal(p.historyWrites[0][2], '/host');
  const reloaded = page(noFetch, { pathname: '/host', savedHostKey: token });
  assert.equal(reloaded.nodes['host-key'].value, token);
  const player = page(noFetch, { savedHostKey: token });
  assert.equal(player.nodes['host-key'].value, '');
  assert.equal(player.nodes['host-controls'].hidden, true);
});

test("le formulaire de campagne charge les valeurs et sauvegarde une seule fois", async () => {
  const pending = deferred();
  const original = { title: 'Ancien titre', description: 'Ancienne description' };
  const updated = { title: 'Nouveau titre', description: '<b>Texte brut</b>' };
  const p = page(async (url, options) => {
    assert.equal(url, '/api/campaign');
    return options.method === 'PUT' ? pending.promise : reply({ campaign: original });
  }, { pathname: '/host', savedHostKey: token });
  await flush();
  assert.equal(p.nodes['campaign-title-input'].value, original.title);
  assert.equal(p.nodes['campaign-description-input'].value, original.description);
  assert.equal(p.nodes['save-campaign'].disabled, false);
  p.nodes['campaign-title-input'].value = `  ${updated.title}  `;
  p.nodes['campaign-description-input'].value = updated.description;
  let prevented = false;
  const submit = () => p.nodes['campaign-form'].listeners.submit({ preventDefault() { prevented = true; } });
  const operation = submit();
  await submit();
  assert.equal(prevented, true);
  const requests = p.requests.filter(r => r.options.method === 'PUT');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[0].options.body), updated);
  assert.equal(p.nodes['campaign-title'].textContent, original.title);
  assert.equal(p.nodes['campaign-title-input'].disabled, true);
  pending.resolve(reply({ campaign: updated }));
  await operation;
  assert.equal(p.nodes['campaign-title'].textContent, updated.title);
  assert.equal(p.nodes['campaign-description'].textContent, updated.description);
  assert.equal(p.nodes['campaign-save-message'].textContent, 'Campagne enregistrée.');
  assert.equal(p.nodes['save-campaign'].disabled, false);
});

for (const failure of ['refus', 'timeout']) {
  test(`une sauvegarde en ${failure} conserve la saisie et réactive le formulaire`, async () => {
    const p = page((url, options) => {
      if (options.method !== 'PUT') return Promise.resolve(reply({ campaign: { title: 'Ancien', description: '' } }));
      if (failure === 'refus') return Promise.resolve(reply({ error: 'Accès refusé' }, 401));
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)));
    }, { pathname: '/host', savedHostKey: token });
    await flush();
    p.nodes['campaign-title-input'].value = 'Nouveau';
    const operation = p.nodes['campaign-form'].listeners.submit({ preventDefault() {} });
    if (failure === 'timeout') p.deadlines.at(-1).controller.abort(new Error('Timeout'));
    await operation;
    assert.equal(p.nodes['campaign-title-input'].value, 'Nouveau');
    assert.equal(p.nodes['campaign-title'].textContent, 'Ancien');
    assert.match(p.nodes['campaign-save-message'].textContent, failure === 'refus' ? /Accès refusé/ : /non confirmé/);
    for (const id of ['save-campaign', 'campaign-title-input', 'campaign-description-input']) {
      assert.equal(p.nodes[id].disabled, false);
    }
    assert.equal(p.requests.filter(r => r.options.method === 'PUT').length, 1);
  });
}

test("le signal de campagne actualise le joueur sans message de chargement", async () => {
  const p = page(async (url, options) => {
    assert.equal(url, '/api/campaign');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    return reply({ campaign: { title: 'Nouveau', description: 'Description modifiée' } });
  });
  p.authenticate();
  p.campaignUpdated();
  await flush();
  assert.equal(p.nodes['campaign-title'].textContent, 'Nouveau');
  assert.equal(p.nodes['campaign-description'].textContent, 'Description modifiée');
  assert.ok(!p.writes.some(([id, text]) => id === 'campaign-message' && /Chargement/.test(text)));
  p.reconnect();
  await flush();
  assert.equal(p.requests.length, 2);
});

test("une ancienne réponse campagne ne remplace pas la plus récente", async () => {
  const old = deferred();
  let calls = 0;
  const p = page(() => ++calls === 1 ? old.promise : Promise.resolve(reply({ campaign: { title: 'Récent', description: '' } })));
  p.authenticate();
  p.campaignUpdated();
  p.campaignUpdated();
  await flush();
  old.resolve(reply({ campaign: { title: 'Ancien', description: '' } }));
  await flush();
  assert.equal(p.nodes['campaign-title'].textContent, 'Récent');
});

test("le signal ne charge rien sans accès et ignore une réponse après révocation", async () => {
  const pending = deferred();
  const p = page(() => pending.promise);
  p.campaignUpdated();
  p.reconnect();
  assert.equal(p.requests.length, 0);
  p.authenticate();
  p.campaignUpdated();
  p.emit({ id: null, status: 'stopped' });
  pending.resolve(reply({ campaign: { title: 'Privé', description: '' } }));
  await flush();
  assert.notEqual(p.nodes['campaign-title'].textContent, 'Privé');
});

test("les signaux de campagne ne remplacent pas le brouillon du MJ", async () => {
  const p = page(async () => reply({ campaign: { title: 'Initial', description: '' } }), {
    pathname: '/host', savedHostKey: token,
  });
  await flush();
  p.nodes['campaign-title-input'].value = 'Brouillon';
  p.campaignUpdated();
  p.reconnect();
  await flush();
  assert.equal(p.nodes['campaign-title-input'].value, 'Brouillon');
  assert.equal(p.requests.length, 3);
});

test("la table s'ouvre après confirmation et le retour accueil conserve le profil", async () => {
  const p = page(async () => reply({ profile: { id: 'one', name: 'Aldric' } }));
  assert.equal(p.nodes['game-table'].hidden, true);
  p.nodes['open-table'].listeners.click();
  assert.equal(p.nodes['game-table'].hidden, true);
  p.authenticate();
  p.nodes['player-profile'].value = 'one';
  await p.nodes['select-profile-form'].listeners.submit({ preventDefault() {} });
  assert.equal(p.nodes['game-table'].hidden, false);
  assert.equal(p.nodes['app-layout'].hidden, true);
  assert.equal(p.nodes['table-profile'].textContent, 'Aldric');
  p.nodes['back-to-lobby'].listeners.click();
  assert.equal(p.nodes['game-table'].hidden, true);
  assert.equal(p.run('currentPlayerProfile.id'), 'one');
  p.nodes['open-table'].listeners.click();
  assert.equal(p.nodes['game-table'].hidden, false);
  p.nodes['table-change-profile'].listeners.click();
  assert.equal(p.nodes['game-table'].hidden, true);
  assert.equal(p.run('profileChangeMode'), true);
  p.nodes['cancel-profile-change'].listeners.click();
  assert.equal(p.nodes['game-table'].hidden, false);
  p.emit({ id: null, status: 'stopped' });
  assert.equal(p.nodes['game-table'].hidden, true);
  assert.equal(p.nodes['app-layout'].hidden, false);
});

test("le MJ peut ouvrir le plateau sans profil joueur", async () => {
  const p = page(async () => reply({ campaign: { title: 'La campagne', description: '' } }), {
    pathname: '/host', savedHostKey: token,
  });
  await flush();
  assert.equal(p.nodes['open-table'].disabled, false);
  p.nodes['open-table'].listeners.click();
  assert.equal(p.nodes['game-table'].hidden, false);
  assert.equal(p.nodes['table-profile'].textContent, 'MJ (MJ)');
  assert.equal(p.nodes['table-title'].textContent, 'La campagne');
  assert.equal(p.nodes['table-change-profile'].hidden, true);
});


test("le MJ sélectionne son profil existant avant d'ouvrir la table", async () => {
  const p = page(async (url, options) => {
    if (url === '/api/campaign') return reply({ campaign: { title: 'Test', description: '' } });
    assert.equal(url, '/api/host/profile');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.deepEqual(JSON.parse(options.body), { profileId: 'host-profile' });
    return reply({ profile: { id: 'host-profile', name: 'MJ', role: 'host' } });
  }, { pathname: '/host', savedHostKey: token, hostProfile: null });
  await flush();
  assert.equal(p.nodes['open-table'].disabled, true);
  assert.equal(p.nodes['game-table'].hidden, true);
  p.nodes['host-profile-select'].value = 'host-profile';
  await p.nodes['host-profile-form'].listeners.submit({ preventDefault() {} });
  assert.equal(p.nodes['game-table'].hidden, false);
  assert.equal(p.nodes['table-profile'].textContent, 'MJ (MJ)');
  assert.equal(p.nodes['host-key'].value, token);
});
