import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestCoordinator, responseWasNotModified } from '../src/sharedDataRequest.mjs';

test('newer shared-data requests become current without aborting the older valid request', () => {
  const coordinator = createRequestCoordinator(1000);
  const first = coordinator.begin();
  const second = coordinator.begin();
  assert.equal(first.signal.aborted, false);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  first.finish();
  second.finish();
});

test('request invalidation protects against effect cleanup overwriting newer state', () => {
  const coordinator = createRequestCoordinator(1000);
  const request = coordinator.begin();
  coordinator.invalidate();
  assert.equal(request.isCurrent(), false);
  request.finish();
});

test('HTTP 304 is recognized as a cache revalidation response', () => {
  assert.equal(responseWasNotModified({ status: 304 }), true);
  assert.equal(responseWasNotModified({ status: 200 }), false);
});

test('request timeout aborts only the timed-out request', async () => {
  const coordinator = createRequestCoordinator(5);
  const request = coordinator.begin();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(request.signal.aborted, true);
  request.finish();
});
