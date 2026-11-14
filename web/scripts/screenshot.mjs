// Regenerate docs/screenshot.png (README) and web/public/og.png (link previews) from the live site.
//   cd web && npx -y playwright@1.49.1 install chromium   (once, if you have no Playwright browser)
//   node scripts/screenshot.mjs [url]
// Default URL: the Jezero view with a discovery open on the satellite basemap.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const url = process.argv[2] ?? 'https://site-comparer-thing.vercel.app/#t=mars_jezero&v=25,40,1.8';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto(url);
await page.waitForSelector('#loader', { state: 'hidden', timeout: 180000 });
await page.waitForTimeout(6000); // let basemap tiles arrive
await page.screenshot({ path: path.join(root, 'docs', 'screenshot.png') });
const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await og.goto(url);
await og.waitForSelector('#loader', { state: 'hidden', timeout: 180000 });
await og.waitForTimeout(6000);
await og.screenshot({ path: path.join(root, 'web', 'public', 'og.png') });
await browser.close();
console.log('wrote docs/screenshot.png and web/public/og.png');
