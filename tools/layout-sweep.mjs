/**
 * Every page on the shared layout, desktop and phone: no console error, no
 * failed asset, no band of bare background under the footer, no sideways scroll.
 *
 * The last two are why this exists. The footer used to stop wherever the content
 * did, so /deposit ended 200px above the fold. The first fix made the body a
 * column flex container - which silently disabled cross-axis stretch on every
 * child with margin:0 auto, so the phone lobby fell back to the carousel's
 * min-content width and scrolled 810px sideways. Asserting the CSS rule exists
 * would not have caught that; only measuring a real page does.
 *
 * Run: TL_PLAYWRIGHT=<path to playwright> node tools/layout-sweep.mjs
 * (needs the dev server up: php -S 127.0.0.1:8000 server.php)
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.TL_PLAYWRIGHT);
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const BASE = process.env.TL_BASE || 'http://127.0.0.1:8000';
const USER = process.env.TL_USER || 'uitest.tl@example.com';
const PASS = process.env.TL_PASS || 'Test@12345';
const exe = process.env.TL_CHROME
    || join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1208/chrome-win64/chrome.exe');
const b = await chromium.launch({ headless: true, executablePath: existsSync(exe) ? exe : undefined });
const PAGES = ['/dashboard', '/deposit', '/withdraw', '/profile', '/deposit_withdrawals',
    '/about', '/rules', '/contacts', '/faq', '/affiliate'];
// /referal is on Layout/usergame2, whose footer include is commented out upstream
let bad = 0;
for (const [tag, w, h] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const page = await b.newPage({ viewport: { width: w, height: h } });
    await page.goto(BASE + '/');
    await page.evaluate(async ([u, pw]) => {
        const t = document.querySelector('input[name=_token]').value;
        await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _token: t, username: u, password: pw }) });
    }, [USER, PASS]);
    for (const path of PAGES) {
        const errs = [];
        const onErr = (e) => errs.push('js: ' + String(e).slice(0, 90));
        const onMsg = (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 90)); };
        const onRes = (r) => { if (r.status() >= 400) errs.push(r.status() + ' ' + r.url().slice(-48)); };
        page.on('pageerror', onErr); page.on('console', onMsg); page.on('response', onRes);
        const st = (await page.goto(BASE + path, { waitUntil: 'networkidle' })).status();
        await page.waitForTimeout(300);
        const m = await page.evaluate(() => {
            const f = document.querySelector('.tl-footer');
            return {
                gap: f ? Math.round(document.documentElement.scrollHeight - (f.getBoundingClientRect().bottom + scrollY)) : null,
                hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
        });
        page.off('pageerror', onErr); page.off('console', onMsg); page.off('response', onRes);
        const probs = [...errs];
        if (m.gap === null) probs.push('no footer');
        else if (m.gap > 1) probs.push('gap under footer ' + m.gap);
        if (m.hscroll > 1) probs.push('h-scroll ' + m.hscroll);
        if (probs.length) bad++;
        console.log(`  [${probs.length ? 'FAIL' : ' ok '}] ${tag.padEnd(7)} ${path.padEnd(22)} ${st}${probs.length ? '  ' + probs.join(' | ') : ''}`);
    }
    await page.close();
}
await b.close();
console.log(bad ? `\n${bad} problem(s)` : '\nlayout-sweep OK');
process.exit(bad ? 1 : 0);
