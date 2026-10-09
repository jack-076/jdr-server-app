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
  function loadProfilesModule() {
    const module = { exports: {} };
    vm.runInNewContext(profileSource, {
      require: nodeRequire, module, __dirname: isolatedServer,
    });
    return module.exports;
  }
  const profiles = loadProfilesModule();
  let handler;
  const context = vm.createContext({
    require(name) {
      if (name === 'node:http') return {
        createServer(callback) { handler = callback; return { listen() {} }; },
      };
      if (name === './profiles') return profiles;
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
      writeHead(code) { assert.equal(data, undefined, 'Réponse déjà envoyée'); assert.equal(typeof code, 'number'); status = code; },
      end(value) { assert.equal(data, undefined, 'Une seule réponse par requête'); data = JSON.parse(value); },
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
  assert.equal(profiles.getProfiles().length, 0);
  const created = await request({ body: '{"name":"  Aldric  "}' });
  assert.equal(created.status, 201);
  assert.equal(created.data.profile.name, 'Aldric');
  assert.ok(created.data.profile.id);
  assert.equal(created.headers['cache-control'], 'no-store');
  const listed = await request({ method: 'GET' });
  assert.deepEqual(listed.data.profiles, [created.data.profile]);
  const restored = JSON.parse(JSON.stringify(loadProfilesModule().getProfiles()));
  assert.deepEqual(restored, [created.data.profile]);

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
