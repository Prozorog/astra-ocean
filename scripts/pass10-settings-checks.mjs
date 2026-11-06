import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

export async function checkSettings(page, { viewport, mobile }) {
  const out = 'output/playwright/pass10', name = mobile ? 'mobile' : 'desktop';
  await mkdir(out, { recursive: true });
  const requests = [], failed = [], cancelled = [], errors = [], badResponses = [];
  const onRequest = request => requests.push(request.url());
  const onFailure = request => { const item = { url: request.url(), error: request.failure()?.errorText }; (item.error === 'net::ERR_ABORTED' ? cancelled : failed).push(item); };
  const onResponse = response => { if (response.status() >= 400) badResponses.push({ url: response.url(), status: response.status() }); };
  const onError = error => errors.push(String(error));
  const onConsole = message => { if (message.type() === 'error') errors.push(message.text()); };
  page.on('request', onRequest); page.on('requestfailed', onFailure); page.on('response', onResponse); page.on('pageerror', onError); page.on('console', onConsole);
  const pair = () => page.evaluate(() => ({ main: Number(document.querySelector('#main-player').dataset.tile), storm: Number(document.querySelector('#storm-player').dataset.tile) }));
  const settled = async (main, storm) => {
    result.stage = `Waiting for Main ${main} / Storm ${storm}`;
    await page.waitForFunction(({ main, storm }) => {
      const a = document.querySelector('#main-player'), b = document.querySelector('#storm-player');
      return Number(a.dataset.tile) === main && Number(b.dataset.tile) === storm && a.readyState >= 2 && b.readyState >= 2;
    }, { main, storm });
    assert.deepEqual(await pair(), { main, storm });
    assert.deepEqual(await page.evaluate(() => window.__settings.choice), { version: 1, main, storm });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('floating-ocean.look-assignments.v1') ?? 'null'));
    if (stored) assert.deepEqual(stored, { version: 1, main, storm });
    for (const [role, tile] of [['main', main], ['storm', storm]]) {
      assert.equal(await page.locator(`[data-tile="${tile}"] [data-role="${role}"]`).getAttribute('aria-pressed'), 'true');
      assert((await page.locator(`[data-tile="${tile}"] .badges`).innerText()).includes(role.toUpperCase()));
      assert((await page.locator(`#${role}-player`).getAttribute('src')).endsWith(`/tile-${tile}/loop.webm`));
      assert((await page.locator(`#${role}-label`).innerText()).startsWith(`${tile} ·`));
    }
  };
  const assignTile = async (role, number) => {
    const button = page.locator(`[data-tile="${number}"] [data-role="${role}"]`);
    await button.scrollIntoViewIfNeeded(); const y = await page.evaluate(() => scrollY); await button.click();
    assert.equal(await page.evaluate(() => scrollY), y, 'Assigning a tile must not scroll');
    assert(await page.locator(`#${role}-choice`).evaluate(e => e.classList.contains('assigned')));
  };
  const sync = async selector => {
    await page.waitForFunction(selector => {
      const a = document.querySelector('#main-player'), b = document.querySelector(selector), d = Math.abs(a.currentTime - b.currentTime);
      return !a.paused && !b.paused && !b.seeking && Math.min(d, Math.abs(3.63 - d)) <= .03;
    }, selector);
    return page.evaluate(selector => { const d = Math.abs(document.querySelector('#main-player').currentTime - document.querySelector(selector).currentTime); return Math.min(d, Math.abs(3.63 - d)); }, selector);
  };
  const result = { name };
  try {
    await page.mouse.move(viewport.width / 2, viewport.height - 35);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.waitForFunction(() => window.__settings?.ready);
    assert.equal(new URL(page.url()).pathname, '/settings.html');
    assert.equal(await page.locator('.grid > .tile').count(), 9);
    await settled(5, 3); result.defaults = await pair();
    assert.equal(await page.locator('#reference, #enlarged').count(), 0);
    assert(!/reference/i.test(await page.locator('body').innerText()));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (!mobile) {
      for (const width of [600, 599]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.locator('.pair').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length), width >= 600 ? 2 : 1);
      }
      await page.setViewportSize(viewport);
    }
    await page.evaluate(() => scrollTo(0, 0));
    result.pairPhaseDifference = await sync('#storm-player');
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });

    await assignTile('main', 4); await settled(4, 3);
    await assignTile('storm', 9); await settled(4, 9); result.tileAssignments = await pair();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('floating-ocean.look-assignments.v1'))), { version: 1, main: 4, storm: 9 });
    await page.getByRole('button', { name: 'Reset to defaults' }).click(); await settled(5, 3);
    await page.waitForTimeout(650); assert.equal(await page.locator('.assigned').count(), 0);

    // Keep Main visible to measure the playing sync master directly.
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(100);
    await page.evaluate(() => window.__settings.openPreview(6));
    assert(await page.locator('#preview-dialog').evaluate(e => e.open));
    result.dialogPhaseDifference = await sync('#preview-player');
    assert((await page.locator('#preview-title').innerText()).startsWith('6 ·'));
    assert((await page.evaluate(() => window.__settings.clips())).every(r => r.paused));
    await page.screenshot({ path: `${out}/dialog-${name}.png` });
    if (mobile) assert(Math.abs((await page.locator('#preview-dialog').boundingBox()).width - viewport.width) <= 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#preview-dialog').evaluate(e => e.open), false);
    assert(await page.locator('[data-tile="6"] .preview').evaluate(e => document.activeElement === e));

    await page.locator('[data-tile="9"] .preview').click();
    await page.waitForFunction(() => document.querySelector('#preview-dialog').open && !document.querySelector('#preview-player').paused);
    assert((await page.evaluate(() => window.__settings.clips())).every(r => r.paused));
    result.parkedPair = await page.evaluate(() => ['main', 'storm'].map(role => {
      const v = document.querySelector(`#${role}-player`), rect = v.getBoundingClientRect();
      return { role, onScreen: rect.bottom > 0 && rect.top < innerHeight, paused: v.paused };
    }));
    assert(result.parkedPair.every(v => v.onScreen || v.paused));
    await page.getByRole('button', { name: 'Use as Main look', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#preview-dialog').open); await settled(9, 3);
    await page.locator('[data-tile="4"] .preview').click();
    await page.waitForFunction(() => document.querySelector('#preview-dialog').open);
    await page.getByRole('button', { name: 'Use as Storm look', exact: true }).click(); await settled(9, 4); result.dialogAssignments = await pair();
    // Compatibility alias and explicit closing hook remain usable.
    await page.evaluate(() => window.__settings.select(2)); await page.evaluate(() => window.__settings.closePreview());
    assert.equal(await page.evaluate(() => window.__settings.selected), 2);

    await page.getByRole('button', { name: 'Pause all', exact: true }).click();
    assert(await page.evaluate(() => [...document.querySelectorAll('video')].every(v => v.paused)));
    await page.locator('#scrub').evaluate(e => { e.value = '1.8'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.locator('#clock').evaluate(e => e.value), '1.80 / 3.63 s');
    await page.getByRole('button', { name: 'Restart together' }).click();
    assert.equal(await page.locator('#main-player').evaluate(e => e.currentTime), 0);
    await page.getByRole('button', { name: 'Reset to defaults' }).click(); await settled(5, 3);
    await page.getByRole('button', { name: 'Play all', exact: true }).click();
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(150);
    result.offscreen = await page.evaluate(() => window.__settings.clips()); assert(result.offscreen.every(r => r.visible || r.paused));
    result.visibility = await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
      const paused = [...document.querySelectorAll('video')].every(v => v.paused);
      delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); return { emulatedHiddenEvent: true, paused };
    }); assert(result.visibility.paused);

    await assignTile('main', 4); await settled(4, 3);
    await assignTile('storm', 9); await settled(4, 9);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(requests.filter(url => /reference/i.test(url)).length, 0);
    await page.getByRole('link', { name: 'Back to the ocean', exact: false }).click();
    await page.waitForFunction(() => window.__ready);
    result.roundTrip = await page.evaluate(() => ({ choices: window.__chunk.choices, peakWaves: window.__chunk.settings.peakWaves, heightGain: window.__chunk.settings.heightGain }));
    assert.deepEqual(result.roundTrip, { choices: { version: 1, main: 4, storm: 9 }, peakWaves: 2, heightGain: .72 });
    assert.equal(requests.filter(url => /reference/i.test(url)).length, 0);
    assert.deepEqual(errors, []); assert.deepEqual(failed, []); assert.deepEqual(badResponses, []);
    result.network = { requests: requests.length, referenceRequests: 0, failed, badResponses, cancelled };
    result.pass = true; return result;
  } catch (error) { result.failure = String(error); result.pass = false; result.state = await page.evaluate(() => ({ choice: window.__settings?.choice, players: [...document.querySelectorAll('#main-player,#storm-player,#preview-player')].map(v => ({ id: v.id, tile: v.dataset.tile, ready: v.readyState, paused: v.paused, seeking: v.seeking, time: v.currentTime, error: v.error?.message })) })).catch(() => null); await page.screenshot({ path: `${out}/failure-${name}.png` }).catch(() => {}); throw error; }
  finally {
    page.off('request', onRequest); page.off('requestfailed', onFailure); page.off('response', onResponse); page.off('pageerror', onError); page.off('console', onConsole);
    await writeFile(`${out}/checks-${name}.json`, JSON.stringify({ ...result, errors, failed, badResponses }, null, 2));
  }
}
