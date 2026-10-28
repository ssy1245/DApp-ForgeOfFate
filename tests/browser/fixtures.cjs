const { test: base, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.on('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const number = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return number;
}
async function start(command, args, directory, name, env) {
  const fd = fs.openSync(path.join(directory, name + '.log'), 'a', 0o600);
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], detached: true });
  fs.closeSync(fd);
  child.on('error', error => { child.failure = error; });
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exit = new Promise(resolve => child.once('exit', resolve));
  try { process.kill(-child.pid, 'SIGTERM'); } catch { return; }
  await Promise.race([exit, pause(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    await exit;
  }
}
async function ready(url, child) {
  for (let i = 0; i < 120; i++) {
    if (child.failure || child.exitCode !== null) throw Error('Isolated test service stopped; inspect its log.');
    try { if ((await fetch(url)).ok) return; } catch {}
    await pause(250);
  }
  throw Error('Isolated test service did not become ready.');
}
const test = base.extend({
  game: [async ({}, use) => {
    fs.mkdirSync(path.join(root, '.local'), { recursive: true });
    const directory = fs.mkdtempSync(path.join(root, '.local/browser-tests-'));
    fs.chmodSync(directory, 0o700);
    const apiPort = await port(); let uiPort = await port();
    while (uiPort === apiPort) uiPort = await port();
    const apiUrl = `http://127.0.0.1:${apiPort}`, url = `http://127.0.0.1:${uiPort}`;
    const env = { FORGE_NETWORK: 'local', FORGE_LOCAL_DIR: directory, FORGE_RPC_URL: '', LOCAL_RPC_URL: 'http://127.0.0.1:1', DEMO_MODE: '1', FORGE_API_TARGET: apiUrl };
    const python = path.join(root, '.venv/bin/python');
    const boot = () => start(python, ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], directory, 'backend', env);
    let backend, frontend;
    const sql = (statement, params = []) => JSON.parse(execFileSync(python, ['-c',
      'import sqlite3,json,sys; db=sqlite3.connect(sys.argv[1]); db.row_factory=sqlite3.Row; q=db.execute(sys.argv[2],json.loads(sys.argv[3])); rows=[dict(r) for r in q.fetchall()]; db.commit(); print(json.dumps(rows))',
      path.join(directory, 'game.sqlite3'), statement, JSON.stringify(params)], { encoding: 'utf8' }));
    try {
      backend = await boot(); await ready(apiUrl + '/api/health', backend);
      frontend = await start(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort', '--config', path.join(root, 'frontend/vite.config.ts'), path.join(root, 'frontend')], directory, 'frontend', env);
      await ready(url, frontend);
      console.log('Isolated browser test data: ' + directory);
      await use({ url, sql, directory, async restart() { await stop(backend); backend = await boot(); await ready(apiUrl + '/api/health', backend); } });
    } finally { await stop(frontend); await stop(backend); }
  }, { scope: 'worker' }],
  baseURL: async ({ game }, use) => use(game.url),
  page: async ({ page, game }, use, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('isolated-database', { contentType: 'application/json', body: JSON.stringify({
        players: game.sql('SELECT address,materials,shields,coins FROM players'),
        weapons: game.sql('SELECT id,owner,level,status,strikes,heat_charges FROM weapons'),
      }, null, 2) });
    }
    expect(errors, 'No uncaught browser errors').toEqual([]);
  },
});

async function register(page, tester, game) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '账号登录 / 注册', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '账号登录 / 注册', exact: true }).click();
  const dialog = page.locator('.account-dialog');
  await dialog.getByRole('button', { name: '注册新账号', exact: true }).click();
  const username = 'ui_' + require('node:crypto').randomBytes(6).toString('hex');
  await dialog.locator('input').nth(0).fill(username);
  await dialog.locator('input').nth(1).fill('test-only-password-2026');
  await dialog.locator('button.primary').click();
  await expect(page.locator('.account-name')).toContainText(username);
  const address = game.sql('SELECT game_address FROM accounts WHERE username=?', [username])[0].game_address;
  if (tester) { game.sql("UPDATE accounts SET role='tester' WHERE username=?", [username]); await page.reload(); await expect(page.locator('.cheat-panel')).toBeVisible(); if (await page.locator('.cheat-heading').getAttribute('aria-expanded') === 'false') await page.locator('.cheat-heading').click(); }
  return { address, username };
}
async function state(page) {
  return page.evaluate(async () => { const response = await fetch('/api/state'); if (!response.ok) throw Error('state request failed'); return response.json(); });
}
async function agree(page) { await page.getByRole('alertdialog').getByRole('button', { name: '确认', exact: true }).click(); }
async function consistent(page, game, address) {
  const saved = game.sql('SELECT materials,shields,coins FROM players WHERE address=?', [address])[0];
  await expect.poll(async () => {
    const texts = await page.locator('.resources .resource strong').allTextContents();
    return texts.map(value => Number(value.replace(/[^\d]/g, '')));
  }).toEqual([saved.materials, saved.shields, saved.coins]);
  const api = await state(page);
  expect(api.player.address).toBe(address);
  for (const key of ['materials','shields','coins']) expect(api.player[key]).toBe(saved[key]);
  const weapons = game.sql("SELECT id,level,status,strikes,heat_charges FROM weapons WHERE owner=? AND status IN ('active','sealed') ORDER BY created DESC", [address]);
  expect(api.weapons.map(({id,level,status,strikes,heat_charges})=>({id,level,status,strikes,heat_charges}))).toEqual(weapons);
  return api;
}
module.exports = { test, expect, register, state, agree, consistent };
