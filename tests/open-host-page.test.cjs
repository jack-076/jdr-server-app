const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, '../apps/server/open-host-page.js'), 'utf8');

for (const [platform, command] of [['linux', 'xdg-open'], ['win32', 'explorer.exe']]) {
  test(`le lancement ${platform} transmet le lien privé sans shell`, () => {
    const module = { exports: {} };
    const child = new EventEmitter();
    let unreferenced = false;
    child.unref = () => { unreferenced = true; };
    const warnings = [];
    const url = 'http://127.0.0.1:3000/host#host=test-only';
    vm.runInNewContext(source, {
      module,
      process: { platform },
      console: { warn: (text) => warnings.push(text) },
      require(name) {
        assert.equal(name, 'node:child_process');
        return { spawn(binary, args, options) {
          assert.equal(binary, command);
          assert.deepEqual(Array.from(args), [url]);
          assert.equal(options.shell, false);
          return child;
        } };
      },
    });
    module.exports.openHostPage(url);
    assert.equal(unreferenced, true);
    child.emit('error', new Error('No desktop'));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /lien privé/);
  });
}
