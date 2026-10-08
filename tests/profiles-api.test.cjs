const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
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
  async function request({ method = 'POST', auth = key, body = '{"name":"Aldric"}', type = 'application/json' } = {}) {
    const req = Readable.from([Buffer.from(body)]);
    req.method = method;
    req.url = '/api/profiles';
    req.headers = { host: 'localhost:3000', 'content-type': type };
    if (auth !== null) req.headers.authorization = `Bearer ${auth}`;
    const headers = {};
    let status, data;
    const res = {
      destroyed: false,
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      writeHead(code) { status = code; },
      end(value) { data = JSON.parse(value); },
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
});
