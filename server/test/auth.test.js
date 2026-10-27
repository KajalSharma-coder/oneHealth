const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLE_PERMISSIONS, authenticateUser, createToken, readAuthUser, requirePermission } = require('../auth');
const User = require('../models/User');

test('auth issues signed role tokens with permissions', async () => {
  const user = await authenticateUser('analyst', 'analyst123');
  assert.equal(user.role, 'analyst');
  assert.ok(user.permissions.includes('alerts:validate'));

  const token = createToken(user);
  const req = { get: (name) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined) };
  assert.deepEqual(readAuthUser(req), user);
});

test('auth rejects bad credentials and insufficient roles', async () => {
  assert.equal(await authenticateUser('analyst', 'wrong'), null);

  const user = await authenticateUser('viewer', 'viewer123');
  const token = createToken(user);
  const req = {
    get: (name) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined),
  };
  const res = {
    code: 200,
    body: null,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await requirePermission('reports:write')(req, res, () => assert.fail('viewer should not write reports'));
  assert.equal(res.code, 403);
});

test('viewer is read-only while admin retains direct API write permissions', async () => {
  assert.ok(ROLE_PERMISSIONS.viewer.includes('reports:read'));
  assert.ok(!ROLE_PERMISSIONS.viewer.includes('reports:write'));
  assert.ok(!ROLE_PERMISSIONS.viewer.includes('alerts:validate'));
  assert.ok(ROLE_PERMISSIONS.admin.includes('reports:write'));
  assert.ok(ROLE_PERMISSIONS.admin.includes('alerts:validate'));

  const check = async (username, password, permission) => {
    const user = await authenticateUser(username, password);
    const token = createToken(user);
    const req = { get: (name) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined) };
    const res = {
      code: 200,
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; },
    };
    let called = false;
    await requirePermission(permission)(req, res, () => { called = true; });
    return { called, status: res.code };
  };

  assert.deepEqual(await check('viewer', 'viewer123', 'reports:write'), { called: false, status: 403 });
  assert.deepEqual(await check('viewer', 'viewer123', 'alerts:validate'), { called: false, status: 403 });
  assert.deepEqual(await check('admin', 'admin123', 'reports:write'), { called: true, status: 200 });
  assert.deepEqual(await check('admin', 'admin123', 'alerts:validate'), { called: true, status: 200 });
});

test('user model hashes and verifies passwords without storing the raw secret', () => {
  const user = new User({ username: 'analyst', role: 'analyst' });
  user.setPassword('strong-password');

  assert.ok(user.passwordHash);
  assert.ok(user.passwordSalt);
  assert.notEqual(user.passwordHash, 'strong-password');
  assert.equal(user.verifyPassword('strong-password'), true);
  assert.equal(user.verifyPassword('wrong-password'), false);
});
