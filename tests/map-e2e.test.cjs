const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const png = fs.readFileSync(path.join(__dirname, 'fixtures/map.png'));

// Lance une copie isolée sur un port temporaire : aucune donnée locale n'est modifiée.
test('import de carte complet sur un serveur HTTP isolé', async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jdr-map-e2e-'));
  fs.cpSync(path.join(root, 'apps'), path.join(temporary, 'apps'), { recursive: true });
  fs.cpSync(path.join(root, 'assets'), path.join(temporary, 'assets'), { recursive: true });
  fs.cpSync(path.join(root, 'packages'), path.join(temporary, 'packages'), { recursive: true });
  const serverFile = path.join(temporary, 'apps/server/index.js');
  const source = fs.readFileSync(serverFile, 'utf8')
    .replace('server.listen(3000, "127.0.0.1"', 'server.listen(0, "127.0.0.1"')
    .replace('console.log("Serveur accessible sur http://127.0.0.1:3000");', 'console.log(`TEST_PORT:${server.address().port}`);');
  fs.writeFileSync(serverFile, source);
  fs.writeFileSync(path.join(temporary, 'apps/server/open-host-page.js'), 'module.exports = { openHostPage() {} };\n');
  let child;
  let streamController;
  async function stop() {
    if (streamController) { streamController.abort(); streamController = null; }
    if (!child || child.exitCode !== null) return;
    const stopped = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    await stopped;
    child = null;
  }
  t.after(async () => { await stop(); fs.rmSync(temporary, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, [serverFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    const ready = await new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';
      child.stderr.on('data', data => { errorOutput += data.toString(); });
      const timeout = setTimeout(() => reject(new Error('Démarrage du serveur isolé expiré')), 5000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Serveur isolé terminé (${code}) : ${errorOutput}`)); });
      child.stdout.on('data', data => {
        output += data.toString();
        const port = output.match(/TEST_PORT:(\d+)/);
        const key = output.match(/#host=([a-f0-9]{64})/);
        if (port && key) { clearTimeout(timeout); resolve({ base: `http://127.0.0.1:${port[1]}`, key: key[1] }); }
      });
    });
    return ready;
  }
  let { base, key } = await start();
  const auth = () => ({ Authorization: `Bearer ${key}` });
  async function hostPost(route) {
    const response = await fetch(base + route, { method: 'POST', headers: auth(), signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    return response.json();
  }
  assert.equal((await fetch(base + '/api/map')).status, 401);
  await hostPost('/api/session/start');
  const invitation = await hostPost('/api/session/invitation');
  const joined = await fetch(base + '/api/session/join', {
    method: 'POST', headers: { Authorization: `Bearer ${invitation.invitationToken}` },
  });
  assert.equal(joined.status, 201);
  const playerToken = (await joined.json()).playerToken;
  const playerHeaders = { Authorization: `Bearer ${playerToken}` };
  streamController = new AbortController();
  const events = await fetch(base + '/api/events', { signal: streamController.signal });
  const reader = events.body.getReader();
  await reader.read(); // État initial.
  const nextEvent = reader.read();
  const rejected = await fetch(base + '/api/map', { method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'image/png' }, body: png });
  assert.equal(rejected.status, 401);
  const uploaded = await fetch(base + '/api/map', { method: 'PUT', headers: { ...auth(), 'Content-Type': 'image/png' }, body: png });
  assert.equal(uploaded.status, 200);
  const map = (await uploaded.json()).map;
  const eventText = Buffer.from((await nextEvent).value).toString();
  assert.match(eventText, /event: map-updated/);
  assert.ok(!eventText.includes(key));
  const metadata = await fetch(base + '/api/map', { headers: playerHeaders });
  assert.equal((await metadata.json()).map.id, map.id);
  const image = await fetch(`${base}/api/map/image?id=${map.id}`, { headers: playerHeaders });
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  const playerTraining = await fetch(base + '/api/map/training', { method: 'POST', headers: playerHeaders });
  assert.equal(playerTraining.status, 401);
  const trainingEvent = reader.read();
  const training = await fetch(base + '/api/map/training', { method: 'POST', headers: auth() });
  assert.equal(training.status, 200);
  const trainingMap = (await training.json()).map;
  assert.equal(trainingMap.width, 1536);
  assert.equal(trainingMap.height, 1024);
  assert.match(Buffer.from((await trainingEvent).value).toString(), /event: map-updated/);
  const trainingImage = await fetch(`${base}/api/map/image?id=${trainingMap.id}`, { headers: playerHeaders });
  assert.deepEqual(Buffer.from(await trainingImage.arrayBuffer()), fs.readFileSync(path.join(root, 'assets/maps/terrain-entrainement.png')));
  const createdProfile = await fetch(base + '/api/profiles', {
    method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Aldric' }),
  });
  assert.equal(createdProfile.status, 201);
  const profile = (await createdProfile.json()).profile;
  const selected = await fetch(base + '/api/session/profile', {
    method: 'POST', headers: { ...playerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: profile.id }),
  });
  assert.equal(selected.status, 200);
  const tokenEvent = reader.read();
  const createdToken = await fetch(base + '/api/tokens', {
    method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapId: trainingMap.id, name: 'Aldric', ownerProfileId: profile.id, x: 744, y: 504 }),
  });
  assert.equal(createdToken.status, 201);
  const token = (await createdToken.json()).token;
  assert.match(Buffer.from((await tokenEvent).value).toString(), /event: tokens-updated/);
  const moved = await fetch(`${base}/api/tokens/${token.id}`, {
    method: 'PATCH', headers: { ...playerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapId: trainingMap.id, x: 900, y: 400 }),
  });
  assert.equal(moved.status, 200);
  const reloadedTraining = await fetch(base + '/api/map/training', { method: 'POST', headers: auth() });
  assert.equal((await reloadedTraining.json()).map.id, trainingMap.id);
  const currentTokens = await fetch(base + '/api/tokens', { headers: playerHeaders });
  assert.equal((await currentTokens.json()).tokens[0].x, 888);
  await stop();
  ({ base, key } = await start());
  const persisted = await fetch(base + '/api/map', { headers: auth() });
  assert.equal((await persisted.json()).map.id, trainingMap.id);
  const persistedTokens = await fetch(base + '/api/tokens', { headers: auth() });
  assert.equal((await persistedTokens.json()).tokens[0].x, 888);
  assert.equal((await fetch(base + '/api/map', { headers: playerHeaders })).status, 401);
});
