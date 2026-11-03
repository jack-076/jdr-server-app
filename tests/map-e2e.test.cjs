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
  const imagePath = `${base}/api/tokens/${token.id}/image?mapId=${trainingMap.id}`;
  const playerUpload = await fetch(imagePath, { method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'image/png' }, body: png });
  assert.equal(playerUpload.status, 401);
  const invalidImage = await fetch(imagePath, { method: 'PUT', headers: { ...auth(), 'Content-Type': 'image/png' }, body: Buffer.from('non-image') });
  assert.equal(invalidImage.status, 400);
  const mismatchedImage = await fetch(imagePath, { method: 'PUT', headers: { ...auth(), 'Content-Type': 'image/jpeg' }, body: png });
  assert.equal(mismatchedImage.status, 400);
  const uploadedTokenImage = await fetch(imagePath, { method: 'PUT', headers: { ...auth(), 'Content-Type': 'image/png' }, body: png });
  assert.equal(uploadedTokenImage.status, 200);
  const imageId = (await uploadedTokenImage.json()).token.image.id;
  assert.equal((await fetch(`${imagePath}&imageId=${imageId}`)).status, 401);
  const playerTokenImage = await fetch(`${imagePath}&imageId=${imageId}`, { headers: playerHeaders });
  assert.equal(playerTokenImage.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await playerTokenImage.arrayBuffer()), png);
  const moved = await fetch(`${base}/api/tokens/${token.id}`, {
    method: 'PATCH', headers: { ...playerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapId: trainingMap.id, x: 900, y: 400 }),
  });
  assert.equal(moved.status, 200);
  const reloadedTraining = await fetch(base + '/api/map/training', { method: 'POST', headers: auth() });
  assert.equal((await reloadedTraining.json()).map.id, trainingMap.id);
  const currentTokens = await fetch(base + '/api/tokens', { headers: playerHeaders });
  assert.equal((await currentTokens.json()).tokens[0].x, 888);
  const otherProfileResponse = await fetch(base + '/api/profiles', {
    method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Autre' }),
  });
  const otherProfile = (await otherProfileResponse.json()).profile;
  const characterPath = `/api/characters/${profile.id}`;
  assert.equal((await fetch(base + characterPath)).status, 403);
  assert.equal((await fetch(base + `/api/characters/${otherProfile.id}`, { headers: playerHeaders })).status, 403);
  fs.mkdirSync(path.join(temporary, 'data/characters'), { recursive: true });
  fs.writeFileSync(path.join(temporary, 'data/characters', `${profile.id}.json`), JSON.stringify({
    name: 'Ancien Aldric', revision: 2,
    scores: { strength: 14, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
    skills: [
      { id: 'base-26', name: 'Autohypnose', group: 'background', ability: 'wisdom', armorPenalty: false, trainedOnly: true, ranks: 0, classSkill: false, misc: 0 },
      { id: 'base-27', name: 'Artisanat', group: 'background', ability: 'intelligence', armorPenalty: false, trainedOnly: false, ranks: 3, classSkill: true, misc: 1 },
    ],
  }));
  const initialSheet = await fetch(base + characterPath, { headers: playerHeaders });
  const character = (await initialSheet.json()).character;
  assert.equal(character.revision, 2);
  assert.equal(character.scores.strength, 14);
  assert.equal(character.level, 1);
  assert.equal(character.hitPoints.maximum, 0);
  assert.equal(character.identity.ancestry, '');
  assert.equal(character.movement.land, '');
  assert.deepEqual(character.abilityAdjustments.intelligence, { damage: 0, drain: 0, penalty: 0 });
  character.identity.ancestry = 'Humain';
  character.identity.alignment = 'Neutre';
  character.movement.land = '9 m';
  character.movement.fly = '18 m';
  assert.equal(character.skills.some(skill => skill.name === 'Autohypnose'), false);
  assert.equal(character.skills[0].name, 'Artisanat');
  character.skills[0].ranks = 3;
  character.skills[0].classSkill = true;
  character.skills.push({ id: 'trained-only', name: 'Connaissances', group: 'adventure', ability: 'intelligence', armorPenalty: false, trainedOnly: true, ranks: 0, classSkill: false, misc: 0 });
  character.armorCheckPenalty = -2;
  character.biography = { appearance: 'Cheveux bruns', history: 'Originaire de Korvosa' };
  character.notes = 'Tester les sphères';
  character.inventory.currency.gp = 42;
  character.inventory.items.push({ id: 'test-weapon', name: 'Épée', category: 'weapon', quantity: 2,
    weight: 1.5, equipped: true, description: 'Une arme de test' });
  assert.equal(character.combat.armorClass, 10);
  character.combat.armorClass = 17;
  character.combat.will = 8;
  character.attacks.push({ id: 'attack-1', name: 'Épée', category: 'weapon', bonus: '+8/+3', damage: '1d10+2', range: '1,5 m' });
  character.spells.points = { current: 11, maximum: 15 };
  character.spells.entries.push({ id: 'spell-1', name: 'Barrière', level: 2, cost: 1, action: 'Standard', description: 'Capacité de test' });
  character.features.push({ id: 'feature-1', name: 'Mouvement', category: 'class', action: 'Rapide', description: 'Test', uses: { current: 2, maximum: 3 } });
  character.effects.conditions.push('invisible');
  character.effects.entries.push({ id: 'effect-1', name: 'Protection', category: 'temporary', duration: '3 tours', active: true, description: 'Test' });
  character.name = 'Aldric';
  character.level = 7;
  character.hitPoints = { current: -3, maximum: 73, temporary: 5, nonlethal: 2 };
  const savedSheet = await fetch(base + characterPath, {
    method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(character),
  });
  assert.equal(savedSheet.status, 200);
  assert.equal((await savedSheet.json()).character.revision, 3);
  const invalidSheet = await fetch(base + characterPath, {
    method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...character, revision: 3, hitPoints: { ...character.hitPoints, maximum: -1 } }),
  });
  assert.equal(invalidSheet.status, 400);
  const invalidInventory = await fetch(base + characterPath, {
    method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...character, revision: 3, inventory: { ...character.inventory,
      items: [{ ...character.inventory.items[0], quantity: -1 }] } }),
  });
  assert.equal(invalidInventory.status, 400);
  const invalidAttack = await fetch(base + characterPath, {
    method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...character, revision: 3, attacks: [{ ...character.attacks[0], category: 'unknown' }] }),
  });
  assert.equal(invalidAttack.status, 400);
  const invalidSpell = await fetch(base + characterPath, {
    method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...character, revision: 3, spells: { ...character.spells,
      entries: [{ ...character.spells.entries[0], level: 10 }] } }),
  });
  assert.equal(invalidSpell.status, 400);
  const invalidFeature = await fetch(base + characterPath, {
    method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...character, revision: 3, features: [{ ...character.features[0], uses: { current: -1, maximum: 3 } }] }),
  });
  assert.equal(invalidFeature.status, 400);
  const invalidEffect = await fetch(base + characterPath, {
    method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...character, revision: 3, effects: { ...character.effects,
      entries: [{ ...character.effects.entries[0], active: 'true' }] } }),
  });
  assert.equal(invalidEffect.status, 400);
  const invalidAdjustment = await fetch(base + characterPath, {
    method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...character, revision: 3, abilityAdjustments: { ...character.abilityAdjustments,
      intelligence: { damage: -1, drain: 0, penalty: 0 } } }),
  });
  assert.equal(invalidAdjustment.status, 400);
  const invalidIdentity = await fetch(base + characterPath, {
    method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...character, revision: 3, identity: { ...character.identity, ancestry: 'a'.repeat(81) } }),
  });
  assert.equal(invalidIdentity.status, 400);
  const conflict = await fetch(base + characterPath, {
    method: 'PUT', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(character),
  });
  assert.equal(conflict.status, 409);
  const forbiddenSheet = await fetch(base + `/api/characters/${otherProfile.id}`, {
    method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(character),
  });
  assert.equal(forbiddenSheet.status, 403);
  assert.equal((await fetch(base + '/api/rolls')).status, 401);
  const rollBody = { profileId: profile.id, skillId: 'base-27' };
  const rollRequest = (body, headers = playerHeaders) => fetch(base + '/api/rolls', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  assert.equal((await rollRequest({ ...rollBody, profileId: otherProfile.id })).status, 403);
  assert.equal((await rollRequest({ ...rollBody, skillId: 'trained-only' })).status, 400);
  const rollEventsController = new AbortController();
  t.after(() => rollEventsController.abort());
  const rollEvents = await fetch(base + '/api/events', { signal: rollEventsController.signal });
  const rollReader = rollEvents.body.getReader();
  await rollReader.read();
  const rollNotification = rollReader.read();
  const rollResponse = await rollRequest({ ...rollBody, modifier: 9999, die: 20 });
  assert.equal(rollResponse.status, 201);
  const roll = (await rollResponse.json()).roll;
  assert.ok(roll.die >= 1 && roll.die <= 20);
  assert.equal(roll.modifier, 7);
  assert.equal(roll.total, roll.die + 7);
  const rollEventText = Buffer.from((await rollNotification).value).toString();
  assert.match(rollEventText, /event: rolls-updated/);
  assert.doesNotMatch(rollEventText, /Aldric|Artisanat|Bearer/);
  const playerRolls = await fetch(base + '/api/rolls', { headers: playerHeaders });
  assert.equal((await playerRolls.json()).rolls[0].id, roll.id);
  assert.equal((await rollRequest({ profileId: otherProfile.id, kind: 'attack', attackId: 'attack-1' })).status, 403);
  assert.equal((await rollRequest({ profileId: profile.id, kind: 'attack', attackId: 'attack-1', bonusIndex: 2 })).status, 400);
  const attackResponse = await rollRequest({ profileId: profile.id, kind: 'attack', attackId: 'attack-1', bonusIndex: 1, modifier: 999 });
  assert.equal(attackResponse.status, 201);
  const attackRoll = (await attackResponse.json()).roll;
  assert.equal(attackRoll.modifier, 3);
  assert.equal(attackRoll.total, attackRoll.die + 3);
  const damageResponse = await rollRequest({ profileId: profile.id, kind: 'damage', attackId: 'attack-1', dice: [999] });
  assert.equal(damageResponse.status, 201);
  const damageRoll = (await damageResponse.json()).roll;
  assert.equal(damageRoll.sides, 10);
  assert.equal(damageRoll.dice.length, 1);
  assert.ok(damageRoll.dice[0] >= 1 && damageRoll.dice[0] <= 10);
  assert.equal(damageRoll.total, damageRoll.dice[0] + 2);
  const adjustedCharacter = structuredClone(character);
  adjustedCharacter.revision = 3;
  adjustedCharacter.abilityAdjustments.intelligence = { damage: 2, drain: 2, penalty: 0 };
  const adjustedSave = await fetch(base + characterPath, {
    method: 'PUT', headers: { ...playerHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(adjustedCharacter),
  });
  assert.equal(adjustedSave.status, 200);
  const adjustedRollResponse = await rollRequest(rollBody);
  assert.equal(adjustedRollResponse.status, 201);
  const adjustedRoll = (await adjustedRollResponse.json()).roll;
  assert.equal(adjustedRoll.modifier, 5);
  assert.equal(adjustedRoll.total, adjustedRoll.die + 5);
  rollEventsController.abort();
  await hostPost('/api/session/stop');
  const afterStopRolls = await fetch(base + '/api/rolls', { headers: auth() });
  assert.equal((await afterStopRolls.json()).rolls.length, 0);
  await stop();
  ({ base, key } = await start());
  const persisted = await fetch(base + '/api/map', { headers: auth() });
  assert.equal((await persisted.json()).map.id, trainingMap.id);
  const persistedTokens = await fetch(base + '/api/tokens', { headers: auth() });
  const persistedToken = (await persistedTokens.json()).tokens[0];
  assert.equal(persistedToken.x, 888);
  assert.equal(persistedToken.image.id, imageId);
  const persistedImage = await fetch(`${base}/api/tokens/${token.id}/image?mapId=${trainingMap.id}&imageId=${imageId}`, { headers: auth() });
  assert.deepEqual(Buffer.from(await persistedImage.arrayBuffer()), png);
  const persistedSheet = await fetch(base + characterPath, { headers: auth() });
  const persistedCharacter = (await persistedSheet.json()).character;
  assert.equal(persistedCharacter.scores.strength, 14);
  assert.equal(persistedCharacter.level, 7);
  assert.deepEqual(persistedCharacter.hitPoints, { current: -3, maximum: 73, temporary: 5, nonlethal: 2 });
  assert.equal(persistedCharacter.skills[0].ranks, 3);
  assert.equal(persistedCharacter.skills[0].classSkill, true);
  assert.equal(persistedCharacter.armorCheckPenalty, -2);
  assert.equal(persistedCharacter.biography.history, 'Originaire de Korvosa');
  assert.equal(persistedCharacter.notes, 'Tester les sphères');
  assert.equal(persistedCharacter.inventory.currency.gp, 42);
  assert.equal(persistedCharacter.inventory.items[0].name, 'Épée');
  assert.equal(persistedCharacter.inventory.items[0].quantity, 2);
  assert.equal(persistedCharacter.inventory.items[0].weight, 1.5);
  assert.equal(persistedCharacter.combat.armorClass, 17);
  assert.equal(persistedCharacter.combat.will, 8);
  assert.equal(persistedCharacter.attacks[0].bonus, '+8/+3');
  assert.equal(persistedCharacter.attacks[0].damage, '1d10+2');
  assert.equal(persistedCharacter.spells.points.current, 11);
  assert.equal(persistedCharacter.spells.entries[0].name, 'Barrière');
  assert.equal(persistedCharacter.spells.entries[0].cost, 1);
  assert.equal(persistedCharacter.features[0].name, 'Mouvement');
  assert.deepEqual(persistedCharacter.features[0].uses, { current: 2, maximum: 3 });
  assert.deepEqual(persistedCharacter.effects.conditions, ['invisible']);
  assert.equal(persistedCharacter.effects.entries[0].duration, '3 tours');
  assert.equal(persistedCharacter.effects.entries[0].active, true);
  assert.equal(persistedCharacter.identity.ancestry, 'Humain');
  assert.equal(persistedCharacter.identity.alignment, 'Neutre');
  assert.equal(persistedCharacter.movement.land, '9 m');
  assert.equal(persistedCharacter.movement.fly, '18 m');
  assert.deepEqual(persistedCharacter.abilityAdjustments.intelligence, { damage: 2, drain: 2, penalty: 0 });
  assert.equal((await fetch(base + '/api/map', { headers: playerHeaders })).status, 401);
});
