const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Readable, PassThrough } = require('node:stream');
const { createRequire } = require('node:module');

const root = path.join(__dirname, '..');
const serverFile = path.join(root, 'apps/server/index.js');
const nodeRequire = createRequire(serverFile);
const profileSource = fs.readFileSync(path.join(root, 'apps/server/profiles.js'), 'utf8');

// Exécute les vrais gestionnaires HTTP avec des flux simulés et un stockage isolé.
test('API profils : autorisation, validation, limites et persistance', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jdr-profiles-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const isolatedServer = path.join(temporary, 'apps/server');
  const hostFixture = { id: 'host-profile', name: 'MJ', role: 'host' };
  fs.mkdirSync(path.join(temporary, 'data'));
  fs.writeFileSync(path.join(temporary, 'data/profiles.json'), JSON.stringify([hostFixture]));
  function loadProfilesModule() {
    const module = { exports: {} };
    vm.runInNewContext(profileSource, {
      require: nodeRequire, module, __dirname: isolatedServer,
    });
    return module.exports;
  }
  function loadCampaignModule() {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'apps/server/campaign.js'), 'utf8'), {
      require: nodeRequire, module, __dirname: isolatedServer,
    });
    return module.exports;
  }
  function loadMapModule() {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'apps/server/map-store.js'), 'utf8'), {
      require: nodeRequire, module, __dirname: isolatedServer, Buffer,
    });
    return module.exports;
  }
  function loadTokenModule() {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'apps/server/token-store.js'), 'utf8'), {
      require: nodeRequire, module, __dirname: isolatedServer,
    });
    return module.exports;
  }
  const tokenStore = loadTokenModule();
  const mapStore = loadMapModule();
  const campaign = loadCampaignModule();
  const profiles = loadProfilesModule();
  let handler;
  const context = vm.createContext({
    require(name) {
      if (name === 'node:http') return {
        createServer(callback) { handler = callback; return { listen() {} }; },
      };
      if (name === './profiles') return profiles;
      if (name === './campaign') return campaign;
      if (name === './map-store') return mapStore;
      if (name === './token-store') return tokenStore;
      return nodeRequire(name);
    },
    __dirname: path.dirname(serverFile), Buffer, URL,
    setInterval() { return { unref() {} }; },
    clearInterval() {}, console: { log() {} },
  });
  vm.runInContext(fs.readFileSync(serverFile, 'utf8'), context);
  const key = vm.runInContext('hostKey', context);
  async function request({ method = 'POST', auth = key, body = '{"name":"Aldric"}', type = 'application/json', url = '/api/profiles', stream } = {}) {
    const req = stream || Readable.from([Buffer.from(body)]);
    req.method = method;
    req.url = url;
    req.headers = { host: 'localhost:3000', 'content-type': type };
    if (auth !== null) req.headers.authorization = `Bearer ${auth}`;
    const headers = {};
    let status, data;
    const res = {
      destroyed: false,
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      writeHead(code, extra = {}) { Object.assign(headers, Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), v]))); assert.equal(data, undefined, 'Réponse déjà envoyée'); assert.equal(typeof code, 'number'); status = code; },
      end(value) { assert.equal(data, undefined, 'Une seule réponse par requête'); data = Buffer.isBuffer(value) ? value : JSON.parse(value); },
    };
    await handler(req, res);
    req.destroy();
    return { status, data, headers };
  }
  assert.equal((await request({ auth: null })).status, 401);
  assert.equal((await request({ method: 'GET', auth: 'wrong' })).status, 401);
  assert.equal((await request({ type: 'text/plain' })).status, 415);
  for (const body of ['{', 'null', '[]', '{}', '{"name":4}', '{"name":"   "}', JSON.stringify({ name: 'a'.repeat(41) })]) {
    assert.equal((await request({ body })).status, 400, body);
  }
  assert.equal((await request({ body: JSON.stringify({ name: 'a'.repeat(4096) }) })).status, 413);
  assert.equal(profiles.getProfiles().length, 1);
  const created = await request({ body: '{"name":"  Aldric  "}' });
  assert.equal(created.status, 201);
  assert.equal(created.data.profile.name, 'Aldric');
  assert.ok(created.data.profile.id);
  assert.equal(created.headers['cache-control'], 'no-store');
  const listed = await request({ method: 'GET' });
  assert.deepEqual(listed.data.profiles, [hostFixture, created.data.profile]);
  const restored = JSON.parse(JSON.stringify(loadProfilesModule().getProfiles()));
  assert.deepEqual(restored, [hostFixture, created.data.profile]);

  await t.test('campagne : accès, validation, taille et sauvegarde persistante', async () => {
    const url = '/api/campaign';
    const read = (auth = key) => request({ url, method: 'GET', auth });
    const write = (body, extra = {}) => request({ url, method: 'PUT', body, ...extra });
    assert.equal((await read(null)).status, 401);
    assert.equal((await write('{}', { auth: null })).status, 401);
    assert.equal((await write('{}', { type: 'text/plain' })).status, 415);
    const initial = (await read()).data.campaign;
    for (const body of ['{', 'null', '[]', '{}', '{"title":"x"}',
      JSON.stringify({ title: ' ', description: '' }),
      JSON.stringify({ title: 'x'.repeat(101), description: '' }),
      JSON.stringify({ title: 'x', description: 'x'.repeat(2001) })]) {
      assert.equal((await write(body)).status, 400);
      assert.deepEqual((await read()).data.campaign, initial);
    }
    assert.equal((await write('x'.repeat(16385))).status, 413);
    // 2000 caractères valides, mais plus de 4 Kio une fois encodés en JSON.
    const description = String.fromCharCode(1).repeat(2000);
    const body = JSON.stringify({ title: '  Campagne test  ', description });
    assert.ok(Buffer.byteLength(body) > 4096);
    const saved = await write(body);
    assert.equal(saved.status, 200);
    assert.equal(saved.headers['cache-control'], 'no-store');
    assert.deepEqual(saved.data.campaign, { title: 'Campagne test', description });
    assert.deepEqual((await read()).data.campaign, saved.data.campaign);
    assert.deepEqual(JSON.parse(JSON.stringify(loadCampaignModule().getCampaign())), saved.data.campaign);
    // Les autres routes conservent la limite de 4 Kio.
    assert.equal((await request({ body: 'x'.repeat(4097) })).status, 413);
    await request({ url: '/api/session/start' });
    const invitation = await request({ url: '/api/session/invitation' });
    const joined = await request({ url: '/api/session/join', auth: invitation.data.invitationToken });
    const playerKey = joined.data.playerToken;
    assert.equal((await read(playerKey)).status, 200);
    assert.equal((await write(body, { auth: playerKey })).status, 401);
    await request({ url: '/api/session/stop' });
    assert.deepEqual((await read()).data.campaign, saved.data.campaign);
  });

  await t.test('signal SSE uniquement après sauvegarde, sans contenu privé', async () => {
    const events = [];
    const stream = {
      write(value) {
        assert.equal(loadCampaignModule().getCampaign().title, 'Signal test');
        events.push(value);
        return true;
      },
    };
    context.campaignTestStream = stream;
    vm.runInContext('sessionStreams.add(campaignTestStream)', context);
    const write = (body, auth = key) => request({ url: '/api/campaign', method: 'PUT', body, auth });
    try {
      const body = JSON.stringify({ title: 'Signal test', description: 'Description privée' });
      assert.equal((await write(body, null)).status, 401);
      assert.equal((await write('{}')).status, 400);
      assert.equal(events.length, 0);
      assert.equal((await write(body)).status, 200);
      assert.deepEqual(events, ['event: campaign-updated\ndata: {}\n\n']);
      const temporaryFile = path.join(temporary, 'data/campaign.json.tmp');
      fs.mkdirSync(temporaryFile);
      try {
        assert.equal((await write(body)).status, 500);
        assert.equal(events.length, 1);
      } finally {
        fs.rmdirSync(temporaryFile);
      }
    } finally {
      vm.runInContext('sessionStreams.delete(campaignTestStream)', context);
    }
  });

  await t.test('le profil MJ est réservé à la clé du meneur', async () => {
    const url = '/api/host/profile';
    assert.equal((await request({ url, method: 'GET', auth: null })).status, 401);
    assert.equal((await request({ url, method: 'GET' })).data.profile, null);
    const chosen = await request({ url, body: JSON.stringify({ profileId: hostFixture.id }) });
    assert.equal(chosen.status, 200);
    assert.deepEqual(chosen.data.profile, hostFixture);
    assert.deepEqual((await request({ url, method: 'GET' })).data.profile, hostFixture);
    assert.equal((await request({ url, body: JSON.stringify({ profileId: 'inexistant' }) })).status, 404);
    await request({ url: '/api/session/start' });
    const invitation = await request({ url: '/api/session/invitation' });
    const joined = await request({ url: '/api/session/join', auth: invitation.data.invitationToken });
    const auth = joined.data.playerToken;
    assert.equal((await request({ url, auth, body: JSON.stringify({ profileId: hostFixture.id }) })).status, 401);
    assert.equal((await request({ url: '/api/session/profile', auth, body: JSON.stringify({ profileId: hostFixture.id }) })).status, 403);
    assert.ok(!(await request({ method: 'GET', auth })).data.profiles.some(p => p.id === hostFixture.id));
    assert.equal((await request({ auth, body: '{"name":"MJ","role":"host"}' })).status, 401);
    const ordinary = await request({ body: '{"name":"MJ","role":"host"}' });
    assert.equal(ordinary.data.profile.role, 'player');
    const candidate = ordinary.data.profile;
    assert.equal((await request({ url: '/api/session/profile', auth, body: JSON.stringify({ profileId: candidate.id }) })).status, 200);
    assert.equal((await request({ url, body: JSON.stringify({ profileId: candidate.id }) })).status, 409);
    await request({ url: '/api/session/stop' });
    const promoted = await request({ url, body: JSON.stringify({ profileId: candidate.id }) });
    assert.equal(promoted.status, 200);
    assert.equal(promoted.data.profile.role, 'host');
    assert.equal(loadProfilesModule().getProfiles().find(profile => profile.id === candidate.id).role, 'host');
  });

  await t.test('cartes : limites, permissions, persistance et signal SSE', async () => {
    const png = fs.readFileSync(path.join(__dirname, 'fixtures/map.png'));
    const jpeg = fs.readFileSync(path.join(__dirname, 'fixtures/map.jpg'));
    const read = (auth = key) => request({ url: '/api/map', method: 'GET', auth });
    const put = (body, auth = key, type = 'image/png') => request({ url: '/api/map', method: 'PUT', auth, body, type });
    assert.equal((await read(null)).status, 401);
    assert.equal((await put(png, null)).status, 401);
    assert.equal((await read()).data.map, null);
    assert.equal((await put(png, key, 'image/svg+xml')).status, 415);
    assert.equal((await put(Buffer.from('<svg/>'))).status, 400);
    assert.equal((await put(png.subarray(0, 25))).status, 400);
    assert.equal((await put(jpeg, key, 'image/png')).status, 400);
    assert.equal((await put(jpeg.subarray(0, jpeg.length - 2), key, 'image/jpeg')).status, 400);
    const oversized = Buffer.from(png);
    oversized.writeUInt32BE(16385, 16);
    assert.equal((await put(oversized)).status, 400);
    assert.equal((await put(Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await read()).data.map, null);
    const events = [];
    context.mapTestStream = { write(value) { events.push(value); return true; } };
    vm.runInContext('sessionStreams.add(mapTestStream)', context);
    try {
      const saved = await put(png);
      assert.equal(saved.status, 200);
      const map = saved.data.map;
      assert.equal(map.mimeType, 'image/png');
      assert.equal(map.width, 2);
      assert.equal(map.height, 3);
      assert.deepEqual(events, ['event: map-updated\ndata: {}\n\n']);
      assert.deepEqual((await read()).data.map, map);
      assert.deepEqual(JSON.parse(JSON.stringify(loadMapModule().getCurrentMap())), map);
      const imageUrl = `/api/map/image?id=${map.id}`;
      assert.equal((await request({ url: imageUrl, method: 'GET', auth: null })).status, 401);
      const downloaded = await request({ url: imageUrl, method: 'GET' });
      assert.equal(downloaded.status, 200);
      assert.equal(downloaded.headers['content-type'], 'image/png');
      assert.equal(downloaded.headers['x-content-type-options'], 'nosniff');
      assert.deepEqual(downloaded.data, png);
      assert.equal((await request({ url: '/api/map/image?id=../../profiles.json', method: 'GET' })).status, 404);
      await request({ url: '/api/session/start' });
      const invitation = await request({ url: '/api/session/invitation' });
      const joined = await request({ url: '/api/session/join', auth: invitation.data.invitationToken });
      const playerKey = joined.data.playerToken;
      assert.equal((await read(playerKey)).status, 200);
      assert.equal((await request({ url: imageUrl, method: 'GET', auth: playerKey })).status, 200);
      assert.equal((await put(jpeg, playerKey, 'image/jpeg')).status, 401);
      assert.equal(events.filter(event => event.startsWith('event: map-updated')).length, 1);
      const replacement = await put(jpeg, key, 'image/jpeg');
      assert.equal(replacement.status, 200);
      assert.equal(replacement.data.map.mimeType, 'image/jpeg');
      assert.notEqual(replacement.data.map.id, map.id);
      assert.equal((await request({ url: imageUrl, method: 'GET', auth: playerKey })).status, 404);
      assert.equal(events.filter(event => event.startsWith('event: map-updated')).length, 2);
      const stream = new PassThrough();
      const pending = request({ url: '/api/map', method: 'PUT', auth: key, type: 'image/png', stream });
      assert.equal((await put(png)).status, 409);
      stream.end(png);
      const restoredPng = await pending;
      assert.equal(restoredPng.status, 200);
      assert.equal(restoredPng.data.map.id, map.id);
      assert.equal(events.filter(event => event.startsWith('event: map-updated')).length, 3);
      await request({ url: '/api/session/stop' });
      assert.equal((await read(playerKey)).status, 401);
    } finally {
      vm.runInContext('sessionStreams.delete(mapTestStream)', context);
    }
  });

  await t.test('pions : autorisations, positions, persistance et changement de carte', async () => {
    const map = (await request({ url: '/api/map/training' })).data.map;
    assert.ok(map);
    const secondProfile = (await request({ body: '{"name":"Mira"}' })).data.profile;
    await request({ url: '/api/session/start' });
    async function join(profileId) {
      const invitation = await request({ url: '/api/session/invitation' });
      const joined = await request({ url: '/api/session/join', auth: invitation.data.invitationToken });
      const auth = joined.data.playerToken;
      if (profileId) assert.equal((await request({ url: '/api/session/profile', auth, body: JSON.stringify({ profileId }) })).status, 200);
      return auth;
    }
    const first = await join(created.data.profile.id);
    const second = await join(secondProfile.id);
    const unassigned = await join(null);
    const read = (auth = key) => request({ url: '/api/tokens', method: 'GET', auth });
    const make = (input, auth = key) => request({ url: '/api/tokens', auth, body: JSON.stringify(input) });
    const move = (id, input, auth = key, stream) => request({ url: `/api/tokens/${id}`, method: 'PATCH', auth, body: JSON.stringify(input), stream });
    const remove = (id, mapId = map.id, auth = key) => request({ url: `/api/tokens/${id}?mapId=${mapId}`, method: 'DELETE', auth });
    const basic = { mapId: map.id, name: 'Aldric', ownerProfileId: created.data.profile.id, x: 73, y: 70 };
    assert.equal((await read(null)).status, 401);
    assert.equal((await make(basic, first)).status, 401);
    assert.equal((await make({ ...basic, mapId: 'ancien' })).status, 409);
    assert.equal((await make({ ...basic, ownerProfileId: 'inconnu' })).status, 400);
    for (const input of [
      { ...basic, name: '  ' }, { ...basic, name: 'x'.repeat(41) },
      { ...basic, x: -1 }, { ...basic, x: map.width + 1 }, { ...basic, y: '1' },
    ]) assert.equal((await make(input)).status, 400);
    assert.equal((await read()).data.tokens.length, 0);
    const events = [];
    context.tokenTestStream = { write(value) { events.push(value); return true; } };
    vm.runInContext('sessionStreams.add(tokenTestStream)', context);
    try {
      const result = await make(basic);
      assert.equal(result.status, 201);
      const token = result.data.token;
      assert.equal(token.x, 72);
      assert.equal(token.y, 72);
      // Un pion enregistré avant l'alignement est présenté au centre de sa case.
      const tokenFile = path.join(temporary, 'data/tokens', `${map.id}.json`);
      fs.writeFileSync(tokenFile, JSON.stringify([{ ...token, x: 100, y: 101 }]));
      const legacy = (await read(first)).data.tokens[0];
      assert.equal(legacy.x, 120);
      assert.equal(legacy.y, 120);
      assert.equal(JSON.parse(fs.readFileSync(tokenFile, 'utf8'))[0].x, 100);
      const position = { mapId: map.id, x: 125, y: 127 };
      assert.equal((await move(token.id, position, second)).status, 403);
      assert.equal((await move(token.id, position, unassigned)).status, 403);
      assert.equal((await remove(token.id, map.id, first)).status, 401);
      assert.equal(events.filter(event => event.startsWith('event: tokens-updated')).length, 1);
      assert.equal((await move(token.id, position, first)).status, 200);
      assert.equal((await read(second)).data.tokens[0].x, 120);
      assert.equal(loadTokenModule().listTokens(map.id)[0].x, 120);
      assert.equal((await move(token.id, { ...position, x: map.width + 1 }, first)).status, 400);
      assert.equal((await move(token.id, { ...position, ownerProfileId: secondProfile.id }, first)).status, 200);
      assert.equal((await move(token.id, position, second)).status, 403);
      assert.equal((await remove(token.id, 'ancienne-carte')).status, 409);
      assert.equal((await remove(token.id)).status, 200);
      assert.equal((await read()).data.tokens.length, 0);
      assert.ok(events.filter(event => event.startsWith('event: tokens-updated')).every(event => event === 'event: tokens-updated\ndata: {}\n\n'));
      const other = (await make(basic)).data.token;
      const stream = new PassThrough();
      const pending = move(other.id, position, first, stream);
      await request({ url: '/api/session/stop' });
      stream.end(JSON.stringify(position));
      assert.equal((await pending).status, 401);
      assert.equal(loadTokenModule().listTokens(map.id)[0].x, 72);
      const jpeg = fs.readFileSync(path.join(__dirname, 'fixtures/map.jpg'));
      const newMap = await request({ url: '/api/map', method: 'PUT', type: 'image/jpeg', body: jpeg });
      assert.equal(newMap.status, 200);
      assert.notEqual(newMap.data.map.id, map.id);
      assert.equal((await move(other.id, position)).status, 409);
      assert.equal((await read()).data.tokens.length, 0);
      assert.equal(loadTokenModule().listTokens(map.id).length, 1);
      const previousMap = await request({ url: '/api/map/training' });
      assert.equal(previousMap.data.map.id, map.id);
      assert.equal((await read()).data.tokens.length, 1);
    } finally {
      vm.runInContext('sessionStreams.delete(tokenTestStream)', context);
    }
  });

  await t.test('réservation exclusive, changement et expiration', async () => {
    const route = '/api/session/profile';
    assert.equal((await request({ url: '/unknown', auth: null })).status, 404);
    assert.equal((await request({ url: route, auth: null })).status, 401);
    await request({ url: '/api/session/start' });
    async function join() {
      const invitation = await request({ url: '/api/session/invitation' });
      const joined = await request({ url: '/api/session/join', auth: invitation.data.invitationToken });
      assert.equal(joined.status, 201);
      return joined.data.playerToken;
    }
    const first = await join();
    const second = await join();
    const otherProfile = (await request({ body: '{"name":"Mira"}' })).data.profile;
    const thirdProfile = (await request({ body: '{"name":"Lina"}' })).data.profile;
    const choose = (auth, profileId) => request({ url: route, auth, body: JSON.stringify({ profileId }) });
    const me = async (auth) => (await request({ url: '/api/session/me', method: 'GET', auth })).data;
    assert.equal((await me(first)).profileId, null);
    assert.equal((await request({ method: 'GET', auth: first })).status, 200);
    assert.equal((await request({ auth: first })).status, 401);
    assert.equal((await request({ url: route, auth: first, type: 'text/plain' })).status, 415);
    for (const body of ['{', 'null', '[]', '{}', '{"profileId":1}', '{"profileId":""}']) {
      assert.equal((await request({ url: route, auth: first, body })).status, 400);
    }
    assert.equal((await request({ url: route, auth: first, body: 'x'.repeat(4097) })).status, 413);
    assert.equal((await choose(first, 'missing')).status, 404);
    const id = created.data.profile.id;
    const results = await Promise.all([choose(first, id), choose(second, id)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const winner = results[0].status === 200 ? first : second;
    const loser = winner === first ? second : first;
    assert.equal((await choose(winner, id)).status, 200);
    assert.equal((await choose(loser, otherProfile.id)).status, 200);
    assert.equal((await choose(loser, id)).status, 409);
    assert.equal((await me(loser)).profileId, otherProfile.id);
    assert.equal((await choose(winner, thirdProfile.id)).status, 200);
    assert.equal((await choose(loser, id)).status, 200);
    context.expiringToken = winner;
    vm.runInContext('players.get(expiringToken).lastSeenAt = Date.now() - PLAYER_TIMEOUT_MS - 1', context);
    assert.equal((await choose(loser, thirdProfile.id)).status, 200);
    assert.equal((await choose(winner, id)).status, 401);

    const stream = new PassThrough();
    const pending = request({ url: route, auth: loser, stream });
    await request({ url: '/api/session/stop' });
    stream.end(JSON.stringify({ profileId: id }));
    assert.equal((await pending).status, 401);
    assert.equal(vm.runInContext('players.size', context), 0);
  });
});
