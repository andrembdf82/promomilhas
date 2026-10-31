// Puppeteer keeps bindings across navigation even when window[name] is absent.
// Serialize registrations per page/name and tolerate only its duplicate error.
export function createExposeFunctionIfAbsent() {
  const pending = new WeakMap();

  return async function exposeFunctionIfAbsent(page, name, fn) {
    let bindings = pending.get(page);
    if (!bindings) {
      bindings = new Map();
      pending.set(page, bindings);
    }
    if (bindings.has(name)) return bindings.get(name);

    const registration = (async () => {
      if (process.env.DEBUG_WHATSAPP === '1') console.log(`🔧 Registrando evento: ${name}`);
      const exists = await page.evaluate(name => !!window[name], name);
      if (exists) return;
      try {
        await page.exposeFunction(name, fn);
      } catch (error) {
        if (error.message !== `Failed to add page binding with name ${name}: window['${name}'] already exists!`) {
          throw error;
        }
      }
      if (process.env.DEBUG_WHATSAPP === '1') console.log(`🔧 Evento registrado: ${name}`);
    })();
    bindings.set(name, registration);
    try {
      await registration;
    } finally {
      bindings.delete(name);
    }
  };
}
