import { createRequire } from 'node:module';
import { createExposeFunctionIfAbsent } from './page-bindings.js';

const require = createRequire(import.meta.url);
// Install before Client.js captures the helper. Keep this compatibility fix
// in project code so npm install does not erase it.
const puppeteerHelpers = require('whatsapp-web.js/src/util/Puppeteer.js');
puppeteerHelpers.exposeFunctionIfAbsent = createExposeFunctionIfAbsent();

export default require('whatsapp-web.js');
