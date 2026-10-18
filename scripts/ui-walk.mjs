import { chromium } from 'playwright-core';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', (error) => logs.push(`PAGEERROR: ${error.message}`));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Connect wallet/ }).first().click();
await page.waitForTimeout(6000);
logs.push(`notice after connect (no wallet): ${await page.locator('.notice').count() ? (await page.locator('.notice').textContent())?.trim() : '(none)'}`);
await page.screenshot({ path: 'audit-connect.png', fullPage: true });
console.log(logs.join('\n'));
await browser.close();
