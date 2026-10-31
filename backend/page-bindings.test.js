import test from 'node:test';
import assert from 'node:assert/strict';
import { createExposeFunctionIfAbsent } from './page-bindings.js';

test('concurrent registrations expose a binding once', async () => {
  const expose = createExposeFunctionIfAbsent();
  let calls = 0;
  const page = {
    evaluate: async () => false,
    exposeFunction: async () => { calls++; }
  };
  await Promise.all(Array.from({ length: 10 }, () => expose(page, 'onQRChangedEvent', () => {})));
  assert.equal(calls, 1);
});

test('reinjection tolerates an existing Puppeteer binding after navigation', async () => {
  const expose = createExposeFunctionIfAbsent();
  let calls = 0;
  const page = {
    evaluate: async () => false,
    exposeFunction: async name => {
      if (calls++) throw new Error(`Failed to add page binding with name ${name}: window['${name}'] already exists!`);
    }
  };
  await expose(page, 'onQRChangedEvent', () => {});
  await expose(page, 'onQRChangedEvent', () => {});
  assert.equal(calls, 2);
});

test('existing window binding is preserved', async () => {
  await createExposeFunctionIfAbsent()({
    evaluate: async () => true,
    exposeFunction: async () => assert.fail('must not register again')
  }, 'qr', () => {});
});

test('unrelated failures propagate and allow another attempt', async () => {
  const expose = createExposeFunctionIfAbsent();
  const failure = new Error('Target closed');
  const page = {
    evaluate: async () => false,
    exposeFunction: async () => { throw failure; }
  };
  await assert.rejects(expose(page, 'qr', () => {}), error => error === failure);
  page.exposeFunction = async () => {};
  await expose(page, 'qr', () => {});
});
