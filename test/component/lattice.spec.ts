import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/lattice.spec.ts
// Browser regressions for wall gestures and nested native playback controls.
const cameraX = (wall: Locator) => wall.locator('.lattice-world').evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41);
// Past the end of the opening tile-landing wave, so no test measures a moving wall.
const settle = (page: Page) => page.waitForTimeout(1200);

async function dragCover(page: Page, wall: Locator) {
    const cover = wall.locator('.lattice-poster.is-expanded');
    const box = (await cover.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 3;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
        await page.mouse.move(x + step * 15, y);
        await page.waitForTimeout(16);
    }
}

/**
 * Drags the open cover and lets go, returning where the pointer was released.
 *
 * The hook drops a release more than 80ms after the last sample, and on a loaded machine a single
 * Playwright round trip can exceed that - the wall then simply never coasts. So this goes through
 * CDP and pipelines the final move with the release instead of awaiting them in turn.
 */
async function flingCover(page: Page, wall: Locator) {
    const box = (await wall.locator('.lattice-poster.is-expanded').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 3;
    const session = await page.context().newCDPSession(page);
    const mouse = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', atX: number) => session.send('Input.dispatchMouseEvent', {
        type, x: atX, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
    });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await mouse('mousePressed', x);
    for (let step = 1; step <= 5; step++) {
        await mouse('mouseMoved', x + step * 15);
        await page.waitForTimeout(16);
    }
    const releaseX = x + 6 * 15;
    await Promise.all([mouse('mouseMoved', releaseX), mouse('mouseReleased', releaseX)]);
    await session.detach();
    return { x: releaseX, y };
}

/** Coasting only has to keep going; how far depends on the release speed, which load lowers. */
const COAST_MIN_PX = 3;

test('expanded cover drags and coasts; pressing again stops inertia', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    // Measure only after the release: a measuring round trip before it could make the sample stale.
    const release = await flingCover(page, wall);
    const released = await cameraX(wall);
    expect(released - before).toBeGreaterThan(70);
    await page.waitForTimeout(100);
    expect(await cameraX(wall)).toBeGreaterThan(released + COAST_MIN_PX);
    await page.mouse.move(release.x, release.y);
    await page.mouse.down();
    const stopped = await cameraX(wall);
    await page.waitForTimeout(120);
    expect(await cameraX(wall)).toBeCloseTo(stopped, 1);
    await page.mouse.up();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveCount(1);
});

// 播放中的卡「重新出现才吸一次」：它本来就完整在屏里时，拖完停在哪就待在哪，不吸；
// 从「被边缘裁掉」重新变成完整出现的那次停稳，才吸回正中一次。滚轮停下走同一套检查
// （WHEEL_SETTLE_MS，回中断言见下面 trackpad 那条）。
test('a settled drag recentres the playing card only when it re-enters fully visible', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    const field = (await wall.locator('.lattice-field').boundingBox())!;
    const cover = wall.locator('.lattice-poster.is-expanded');
    const box = (await cover.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 3;
    // 第一段：拖到卡右缘越过 field 右缘（被裁）再松手：停稳不吸，镜头留在松手处。
    const clip = field.x + field.width - (box.x + box.width) + 30;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
        await page.mouse.move(x + step * (clip / 6), y);
        await page.waitForTimeout(90); // 步间隔超过 staleReleaseMs：松手判定为已停住，不带惯性
    }
    await page.mouse.up();
    await page.waitForTimeout(1500); // 把停稳定时器过完
    expect(Math.abs((await cameraX(wall)) - before)).toBeGreaterThan(100);
    // 第二段：拖回来让卡重新完整出现：这次停稳吸回正中一次（弹簧档，比 tween 慢一点，轮询等落定）。
    const box2 = (await cover.boundingBox())!;
    const x2 = box2.x + box2.width / 2;
    const y2 = box2.y + box2.height / 3;
    await page.mouse.move(x2, y2);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
        await page.mouse.move(x2 - step * 40, y2);
        await page.waitForTimeout(90);
    }
    await page.mouse.up();
    await expect.poll(() => cameraX(wall), { timeout: 4000 }).toBeCloseTo(before, 1);
});

// 吸附的飞行必须是多帧弹簧：对象式 animate(from, to, { spring, onUpdate }) 在 motion-dom 的
// propEffect 路径上 onUpdate 不按帧回调，吸附曾退化成 onComplete 一次写到位（一帧 250px）。
test('the re-entry snap flies on a spring over several frames', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    const field = (await wall.locator('.lattice-field').boundingBox())!;
    // 第一段：拖到卡右缘越出 field（被裁）再松手：停稳不吸，镜头留在松手处。
    const cover = wall.locator('.lattice-poster.is-expanded');
    const box = (await cover.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 3;
    const clip = field.x + field.width - (box.x + box.width) + 30;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
        await page.mouse.move(x + step * (clip / 6), y);
        await page.waitForTimeout(90);
    }
    await page.mouse.up();
    await page.waitForTimeout(1500);
    // 相机已静止，开始逐帧采样，再拖回大半程（卡重新完整可见但未对中），停稳吸附弹完剩下的。
    await wall.locator('.lattice-world').evaluate(node => {
        const samples: number[] = [];
        const host = window as unknown as { __snapSamples?: number[] };
        host.__snapSamples = samples;
        const read = () => samples.push(new DOMMatrix(getComputedStyle(node).transform).m41);
        read();
        const loop = () => {
            read();
            if (samples.length < 240 && host.__snapSamples === samples) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    });
    const box2 = (await cover.boundingBox())!;
    const x2 = box2.x + box2.width / 2;
    const y2 = box2.y + box2.height / 3;
    await page.mouse.move(x2, y2);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
        await page.mouse.move(x2 - step * 40, y2);
        await page.waitForTimeout(90);
    }
    await page.mouse.up();
    await expect.poll(() => cameraX(wall), { timeout: 4000 }).toBeCloseTo(before, 1);
    await page.waitForTimeout(150);
    const samples = await page.evaluate(() => (window as unknown as { __snapSamples: number[] }).__snapSamples);
    // 最后一段连续运动就是吸附弹簧（与拖动/回滑之间隔着停稳的空帧）：至少 3 帧渐变，
    // 且单帧增量远小于全距离（一帧跳到位只有一个 ≈ 全距离的增量）。
    const deltas = samples.slice(1).map((value, index) => value - samples[index]);
    // 从尾部往回数最后一段连续运动（就是吸附弹簧）：先跳过落定后的零帧，遇到停顿空帧
    // （回滑/拖动与弹簧之间隔着停稳的空窗）就停；一帧跳到位的话这一段只有 1 帧。
    let end = deltas.length - 1;
    while (end >= 0 && Math.abs(deltas[end]) < 0.1) end--;
    let frames = 0;
    let peak = 0;
    let idle = 0;
    for (let index = end; index >= 0; index--) {
        const delta = Math.abs(deltas[index]);
        if (delta >= 0.5) {
            frames += 1;
            peak = Math.max(peak, delta);
            idle = 0;
        } else if (delta < 0.1) {
            idle += 1;
            if (idle >= 3) break;
        }
    }
    expect(frames).toBeGreaterThanOrEqual(3);
    expect(peak).toBeLessThan(150);
});

test('a drag that leaves the playing card clipped does not recentre', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    const field = (await wall.locator('.lattice-field').boundingBox())!;
    const cover = wall.locator('.lattice-poster.is-expanded');
    const box = (await cover.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 3;
    // 一直拖到卡右缘越过 field 右缘：卡被边缘裁掉，吸附不触发，镜头留在松手处。
    const drag = field.x + field.width - (box.x + box.width) + 30;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
        await page.mouse.move(x + step * (drag / 6), y);
        await page.waitForTimeout(90);
    }
    await page.mouse.up();
    await page.waitForTimeout(1500); // 把停稳定时器与可能的吸附动画都过完
    expect(Math.abs((await cameraX(wall)) - before)).toBeGreaterThan(100);
});

// 触控板式的增量（单轴小于一格、或两轴同时）照旧当帧直接写进相机；鼠标滚轮的平滑见 wallWheelSmoothing.spec.ts。
test('trackpad-sized wheel deltas apply immediately without a tail and leave browser zoom intact', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    const result = await wall.locator('.lattice-field').evaluate(node => {
        const first = new WheelEvent('wheel', { deltaX: 30, bubbles: true, cancelable: true });
        const second = new WheelEvent('wheel', { deltaX: 30, bubbles: true, cancelable: true });
        node.dispatchEvent(first);
        node.dispatchEvent(second);
        return {
            cancelled: first.defaultPrevented && second.defaultPrevented,
            x: new DOMMatrix(getComputedStyle(node.querySelector('.lattice-world')!).transform).m41,
        };
    });
    expect(result.cancelled).toBe(true);
    expect(result.x).toBeCloseTo(before - 60, 4);
    // 停稳定时器（300ms）还没到：确认触控板增量没有平滑尾巴。
    await page.waitForTimeout(250);
    expect(await cameraX(wall)).toBeCloseTo(before - 60, 0);
    // 定时器到点后，卡本来就完整在屏（没有「被裁 → 完整出现」的转变）：不吸，镜头留在停下的地方。
    await page.waitForTimeout(400);
    expect(await cameraX(wall)).toBeCloseTo(before - 60, 0);
    expect(await wall.locator('.lattice-field').evaluate(node => {
        const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: 20, bubbles: true, cancelable: true });
        node.dispatchEvent(event);
        return event.defaultPrevented;
    })).toBe(false);
});

test('playback buttons and seek gestures do not pan; slider arrows keep native behavior', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    await wall.locator('.lattice-transport-button').click();
    await expect(wall.locator('[data-toggles]')).toHaveAttribute('data-toggles', '1');
    // @fork 2026-10-14：展开态的 details 里多了内联音量滑条（Lattice 去掉 playback-quick 浮层入口，
    // 静音/滑条/洗牌直接放「下一首」右边），页面上不再只有一颗 range，seek 目标要限定进度条自己那颗。
    const input = wall.locator('.lattice-progress input[type=range]');
    const box = (await input.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    expect(Number(await input.inputValue())).toBeGreaterThan(90);
    await input.focus();
    const value = Number(await input.inputValue());
    await input.press('ArrowRight');
    expect(Number(await input.inputValue())).toBeGreaterThan(value);
    await settle(page);
    expect(await cameraX(wall)).toBeCloseTo(before, 1);
});

// 拆成两条、并且改用设置而不是 emulateMedia：动效不再跟随系统偏好（issue #370），
// emulateMedia 已经影响不了 fling。这里用 addInitScript 在页面脚本运行前写好 localStorage，
// store 初始化时读到的就是降级值；运行时切换开关是即时生效的，只是这个测试框架里没有入口去点它，
// 所以「降级」和「完整动效」各挂一次。
test('reduced queue collage motion disables fling', async ({ mount, page }) => {
    await page.addInitScript(() => localStorage.setItem('reduce_motion_lattice', 'true'));
    const wall = await mount('lattice');
    await settle(page);
    await dragCover(page, wall);
    await page.mouse.up();
    const released = await cameraX(wall);
    await page.waitForTimeout(150);
    expect(await cameraX(wall)).toBeCloseTo(released, 1);
});

test('cancellation never starts a fling', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await dragCover(page, wall);
    await wall.locator('.lattice-field').dispatchEvent('pointercancel', { pointerId: 1 });
    const cancelled = await cameraX(wall);
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await cameraX(wall)).toBeCloseTo(cancelled, 1);
});

test('the system preference alone no longer reduces motion', async ({ mount, page }) => {
    // #370 的回归点：系统关掉动画效果时，应用默认仍然播放完整动效。
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const wall = await mount('lattice');
    await settle(page);
    await flingCover(page, wall);
    const released = await cameraX(wall);
    await page.waitForTimeout(100);
    expect(await cameraX(wall)).toBeGreaterThan(released + COAST_MIN_PX);
});

test('touch swipe coasts and a secondary pointer cannot replace the gesture', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const field = wall.locator('.lattice-field');
    const before = await cameraX(wall);
    // CDP touch input creates a native active pointer and exercises real pointer capture.
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 500, y: 250, id: 0 }] });
    for (let step = 1; step <= 5; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 500 + step * 20, y: 250, id: 0 }] });
        await page.waitForTimeout(16);
    }
    await field.dispatchEvent('pointerdown', { pointerId: 99, isPrimary: false, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    // The first finger keeps moving after the secondary pointer, which also keeps the release
    // sample fresh: the hook ignores samples older than 80ms, and on a loaded machine a single CDP
    // round trip can exceed that. So the last move and the release are pipelined, not awaited in
    // turn, and the camera is measured only after the release.
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 620, y: 250, id: 0 }] });
    await page.waitForTimeout(16);
    await Promise.all([
        session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 640, y: 250, id: 0 }] }),
        session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    ]);
    const released = await cameraX(wall);
    expect(released - before).toBeGreaterThan(75);
    await page.waitForTimeout(100);
    expect(await cameraX(wall)).toBeGreaterThan(released + COAST_MIN_PX);
    await session.detach();
});

test('Shift and line-mode wheels pan horizontally with normalized distance', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    // 先把正在播放的卡滚出屏幕：停稳后的吸附只对完整在屏里的卡生效，别让它盖住落点断言。
    await wall.locator('.lattice-field').dispatchEvent('wheel', { shiftKey: true, deltaY: 70, deltaMode: 1 });
    await page.waitForTimeout(1500);
    const before = await cameraX(wall);
    await wall.locator('.lattice-field').dispatchEvent('wheel', { shiftKey: true, deltaY: 3, deltaMode: 1 });
    // 按行的是鼠标滚轮：平滑地走过去，落定后正好 3 行。
    await expect.poll(() => cameraX(wall)).toBeCloseTo(before - 48, 1);
});

test('Tab adopts the actual poster for arrow navigation without stealing nested focus', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.lattice-field').press('Escape');
    await page.keyboard.press('Tab');
    const tabbed = await page.evaluate(() => document.activeElement?.getAttribute('data-instance-id'));
    expect(tabbed).toBeTruthy();
    await expect(wall.locator(`.lattice-poster[data-instance-id="${tabbed}"]`)).toHaveClass(/is-focused/);
    await page.keyboard.press('ArrowRight');
    await expect(wall.locator('.lattice-poster.is-focused')).toBeFocused();
    expect(await wall.locator('.lattice-poster.is-focused').getAttribute('data-instance-id')).not.toBe(tabbed);
    await page.keyboard.press('Enter');
    const button = wall.locator('.lattice-transport-button');
    await button.focus();
    await wall.locator('.lattice-field').dispatchEvent('wheel', { deltaX: 500 });
    await page.waitForTimeout(100);
    await expect(button).toBeFocused();
});

test('Escape returns only after card focus has been cleared', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const state = wall.locator('[data-backs]');
    await wall.locator('.lattice-field').press('Escape');
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveCount(0);
    await expect(wall.locator('.lattice-poster.is-focused')).toHaveCount(0);
    await expect(state).toHaveAttribute('data-backs', '0');
    await wall.locator('.lattice-field').press('Escape');
    await expect(state).toHaveAttribute('data-backs', '1');
});

test('primary modifier B exits Lattice immediately', async ({ mount, page }) => {
    const wall = await mount('lattice');
    const state = wall.locator('[data-backs]');

    await page.keyboard.press('Control+b');

    await expect(state).toHaveAttribute('data-backs', '1');
});

test('Enter expands first, then plays the focused card or toggles the current song', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const state = wall.locator('[data-toggles]');
    const current = wall.locator('.lattice-poster.is-current').first();
    await current.focus();
    await current.press('Enter');
    await expect(state).toHaveAttribute('data-toggles', '1');

    const other = wall.locator('.lattice-poster[aria-label="Poster 3 · Artist"]').first();
    await other.focus();
    await other.press('Enter');
    await expect(state).toHaveAttribute('data-toggles', '1');
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 3 · Artist');
    await expect(wall.locator('.lattice-poster.is-current').first()).toHaveAttribute('aria-label', 'Poster 0 · Artist');
    await other.press('Enter');
    await expect(state).toHaveAttribute('data-toggles', '1');
    await expect(wall.locator('.lattice-poster.is-current').first()).toHaveAttribute('aria-label', 'Poster 3 · Artist');
});

test('queue edits preserve the expanded song and clearing does not resurrect the selection', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.getByRole('button', { name: 'Reverse queue', exact: true }).click();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 0 · Artist');
    const other = wall.locator('.lattice-poster[aria-label="Poster 3 · Artist"]').first();
    await other.focus();
    await other.press('Enter');
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 3 · Artist');
    await wall.getByRole('button', { name: 'Reverse queue', exact: true }).click();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 3 · Artist');
    await wall.getByRole('button', { name: 'Remove poster 3', exact: true }).click();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveCount(0);
    await wall.getByRole('button', { name: 'Restore queue', exact: true }).click();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveCount(0);
    await wall.locator('.lattice-poster[aria-label="Poster 3 · Artist"]').first().press('Enter');
    await wall.getByRole('button', { name: 'Clear queue', exact: true }).click();
    await expect(wall.locator('.lattice-poster')).toHaveCount(0);
    await wall.getByRole('button', { name: 'Restore queue', exact: true }).click();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveCount(0);
});

test('a queue reorder moves DOM focus with the selected song', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const selected = wall.locator('.lattice-poster[aria-label="Poster 3 · Artist"]').first();
    await selected.focus();
    // Update the queue without moving focus to the probe toolbar, as an external queue update would.
    await wall.getByRole('button', { name: 'Reverse queue', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
    const focused = wall.locator('.lattice-poster.is-focused');
    await expect(focused).toHaveAttribute('aria-label', 'Poster 3 · Artist');
    await expect(focused).toBeFocused();
});

// Compare actual rendered bounds so reflowed positions, scale and camera motion are all covered.
async function expectExpandedCentered(wall: Locator) {
    await expect.poll(async () => {
        const field = (await wall.locator('.lattice-field').boundingBox())!;
        const poster = (await wall.locator('.lattice-poster.is-expanded').boundingBox())!;
        return Math.hypot(
            poster.x + poster.width / 2 - field.x - field.width / 2,
            poster.y + poster.height / 2 - field.y - field.height / 2,
        );
    }).toBeLessThan(2);
}

test('the wall opens centred on the playing song, whatever the viewport measures', async ({ mount, page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    const wall = await mount('lattice');
    await settle(page);
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 0 · Artist');
    await expectExpandedCentered(wall);
});

test('focused poster stays centered after expanding with Space', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.lattice-field').press('Escape');
    await page.keyboard.press('ArrowRight');
    await expect(wall.locator('.lattice-poster.is-focused')).toBeFocused();
    await settle(page);
    await page.keyboard.press(' ');
    await expectExpandedCentered(wall);
});

test('pointer hover and keyboard focus grow every poster edge by one rendered grid gap', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.lattice-field').press('Escape');
    await settle(page);
    const copies = wall.locator('.lattice-poster[aria-label="Poster 3 · Artist"]');
    const visibleInstanceId = await copies.evaluateAll(nodes => nodes.find(node => {
        const rect = node.getBoundingClientRect();
        return rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    })?.getAttribute('data-instance-id'));
    expect(visibleInstanceId).toBeTruthy();
    const poster = wall.locator(`.lattice-poster[data-instance-id="${visibleInstanceId}"]`);
    const base = (await poster.boundingBox())!;
    const worldScale = await wall.locator('.lattice-world').evaluate(node => (
        Math.abs(new DOMMatrix(getComputedStyle(node).transform).a)
    ));
    const renderedGrowth = 2 * 8 * worldScale;
    const expectGapGrowth = async () => {
        await expect.poll(async () => (await poster.boundingBox())!.width - base.width).toBeCloseTo(renderedGrowth, 1);
        await expect.poll(async () => (await poster.boundingBox())!.height - base.height).toBeCloseTo(renderedGrowth, 1);
    };

    await poster.hover();
    await expectGapGrowth();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await poster.boundingBox())!.width).toBeCloseTo(base.width, 1);

    await poster.focus();
    await expectGapGrowth();
});

test('mouse expansion centers the reflowed card and remains interruptible by trackpad input', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.lattice-field').press('Escape');
    await page.keyboard.press('ArrowRight');
    await settle(page);
    await wall.locator('.lattice-poster.is-focused').click();
    await expectExpandedCentered(wall);
    await settle(page);
    const before = await cameraX(wall);
    await wall.locator('.lattice-field').dispatchEvent('wheel', { deltaX: 40 });
    expect(await cameraX(wall)).toBeCloseTo(before - 40, 1);
    await settle(page);
    expect(await cameraX(wall)).toBeCloseTo(before - 40, 1);
});

test('playback follow uses the expanded card position after reflow', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const poster = wall.locator('.lattice-poster[aria-label="Poster 3 · Artist"]').first();
    await poster.focus();
    await poster.press('Enter');
    await expectExpandedCentered(wall);
    await wall.locator('.lattice-transport-button').click();
    await expect(wall.locator('.lattice-progress input[type=range]')).toBeEnabled();
    await settle(page);
    await expectExpandedCentered(wall);
});

test('the wall tool panel focuses the current song', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.lattice-field').dispatchEvent('wheel', { deltaX: 600, deltaY: 400 });
    const toolsButton = wall.getByRole('button', { name: 'Lattice tools', exact: true });
    const focusButton = wall.getByRole('menuitem', { name: 'Focus current song', exact: true });
    await toolsButton.click();
    await wall.screenshot({ path: 'test-results/lattice-focus-button.png' });
    await focusButton.click();
    await expectExpandedCentered(wall);
    await expect(wall.locator('.is-expanded')).toHaveAttribute('aria-label', 'Poster 0 · Artist');
    await wall.getByRole('button', { name: 'Clear queue', exact: true }).click();
    await toolsButton.click();
    await expect(focusButton).toBeDisabled();
});

test('auto-focus toggle leaves browsing position alone until the next enabled track change', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const field = wall.locator('.lattice-field');
    const toolsButton = wall.getByRole('button', { name: 'Lattice tools', exact: true });
    const autoFocusToggle = wall.getByRole('menuitemcheckbox', { name: 'Auto-focus on track change', exact: true });

    await toolsButton.click();
    await expect(autoFocusToggle).toBeChecked();
    await autoFocusToggle.click();
    await expect(autoFocusToggle).not.toBeChecked();
    await field.dispatchEvent('wheel', { deltaX: 600, deltaY: 400 });
    const browsingX = await cameraX(wall);

    await wall.getByRole('button', { name: 'Next track', exact: true }).click();
    await settle(page);
    expect(await cameraX(wall)).toBeCloseTo(browsingX, 1);
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 0 · Artist');

    await toolsButton.click();
    await autoFocusToggle.click();
    await wall.getByRole('button', { name: 'Next track', exact: true }).click();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 2 · Artist');
    await expectExpandedCentered(wall);
});

test('publishes when the current playing card leaves and re-enters the viewport', async ({ mount, page }) => {
    const wall = await mount('lattice');
    const visibility = wall.locator('[data-current-song-poster-visible]');
    await settle(page);
    await expect(visibility).toHaveAttribute('data-current-song-poster-visible', 'true');
    await expect(wall.locator('.z-60')).toHaveCount(0);
    await wall.locator('.lattice-field').dispatchEvent('wheel', { deltaX: 1200, deltaY: 900 });
    await expect(visibility).toHaveAttribute('data-current-song-poster-visible', 'false');
    await expect(wall.locator('.z-60')).toBeVisible();
    await wall.getByRole('button', { name: 'Lattice tools', exact: true }).click();
    await wall.getByRole('menuitem', { name: 'Focus current song', exact: true }).click();
    await expect(visibility).toHaveAttribute('data-current-song-poster-visible', 'true');
    await expect(wall.locator('.z-60')).toHaveCount(0);
});

test('chrome has three quiet controls at rest and reveals details on hover without moving seek targets', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await page.mouse.move(0, 0);
    const chrome = wall.locator('.lattice-chrome');
    await expect(chrome).not.toHaveClass(/is-revealed/);
    await expect(chrome.getByRole('button')).toHaveCount(2);
    // @fork 2026-10-14：内联音量滑条常驻挂载，页面上有两颗 slider，seek 目标限定进度条那颗。
    await expect(chrome.locator('.lattice-progress input[type=range]')).toHaveCount(1);
    const input = chrome.locator('.lattice-progress input[type=range]');
    const before = (await input.boundingBox())!;
    await wall.screenshot({ path: 'test-results/lattice-chrome-rest.png' });
    await wall.locator('.is-expanded').hover({ position: { x: 100, y: 80 } });
    await expect(chrome).toHaveClass(/is-revealed/);
    await expect(chrome.getByRole('button')).toHaveCount(6);
    // 内联快捷排（@fork 2026-10-14）：playback-quick 入口被滤掉，洗牌顶在「下一首」右边；静音是 switch 不计入 button。
    await expect(chrome.locator('.lattice-chrome-actions button').last()).toHaveAttribute('data-action', 'shuffle');
    await expect(chrome.locator('[role=switch][aria-label="Mute"]')).toBeVisible();
    await expect(chrome.locator('.lattice-chrome-volume')).toBeVisible();
    // playback-quick 入口被滤掉（浮层在卡片里会飘错位置），末尾多了内联静音 + 洗牌。
    expect(await chrome.locator('.lattice-chrome-actions button').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-action'))))
        .toEqual(['prev', 'loop', 'next', 'mute', 'shuffle']);
    await expect(chrome.locator('[data-action=prev]')).toBeVisible();
    await expect(chrome.locator('[data-action=next]')).toBeVisible();
    await expect(chrome.locator('[data-action=loop]')).toBeVisible();
    await expect(chrome.locator('strong')).toHaveCount(0);
    await page.waitForTimeout(250);
    const after = (await input.boundingBox())!;
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.width).toBeCloseTo(before.width, 0);
    const chromeBox = (await chrome.boundingBox())!;
    const copyBox = (await wall.locator('.is-expanded .lattice-poster-copy').boundingBox())!;
    expect(chromeBox.x).toBeCloseTo(copyBox.x, 0);
    await wall.screenshot({ path: 'test-results/lattice-chrome-revealed.png' });
    await page.mouse.move(0, 0);
    await expect(chrome).not.toHaveClass(/is-revealed/);
    await wall.locator('.lattice-field').press('Escape');
    await expect(wall.locator('.is-expanded')).toHaveCount(0);
});

test('touch taps reveal and dismiss chrome, while a touch drag leaves it collapsed', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const session = await page.context().newCDPSession(page);
    const box = (await wall.locator('.is-expanded').boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 3, id: 0 };
    for (const revealed of [true, false]) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect(wall.locator('.lattice-chrome')).toHaveClass(revealed ? /is-revealed/ : /^lattice-chrome\s*$/);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x + 80 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(wall.locator('.lattice-chrome')).not.toHaveClass(/is-revealed/);
    await session.detach();
});

test('the player shortcut remains reachable on a narrow touch screen', async ({ mount, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const wall = await mount('lattice');
    await settle(page);
    await wall.getByRole('button', { name: 'Lattice tools', exact: true }).click();
    await wall.getByRole('menuitem', { name: 'Focus current song', exact: true }).click();
    await expectExpandedCentered(wall);
    await expect(wall.locator('.lattice-secondary-action')).toBeVisible();
    const shortcutBox = (await wall.locator('.lattice-secondary-action').boundingBox())!;
    expect(shortcutBox.width).toBeGreaterThanOrEqual(44);
    expect(shortcutBox.height).toBeGreaterThanOrEqual(44);
    await wall.screenshot({ path: 'test-results/lattice-chrome-mobile.png' });
});

test('expanded chrome operates next, previous and all three loop modes', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const chrome = wall.locator('.lattice-chrome');
    await wall.locator('.is-expanded').hover({ position: { x: 100, y: 80 } });
    await chrome.getByRole('button', { name: 'Next track', exact: true }).click();
    await expect(wall.locator('.is-expanded')).toHaveAttribute('aria-label', 'Poster 1 · Artist');
    await expectExpandedCentered(wall);
    await wall.locator('.is-expanded').hover({ position: { x: 100, y: 80 } });
    await chrome.getByRole('button', { name: 'Previous track', exact: true }).click();
    await expect(wall.locator('.is-expanded')).toHaveAttribute('aria-label', 'Poster 0 · Artist');
    await expectExpandedCentered(wall);
    // 循环按钮的名字跟随当前模式（Loop all / Loop one / Loop off），所以按 data-action 找它。
    const loop = chrome.locator('[data-action=loop]');
    for (const [mode, name] of [['one', 'Loop one'], ['off', 'Loop off'], ['all', 'Loop all']]) {
        await wall.locator('.is-expanded').hover({ position: { x: 100, y: 80 } });
        await loop.click();
        await expect(wall.locator('[data-loop]')).toHaveAttribute('data-loop', mode);
        await expect(loop).toHaveAttribute('aria-pressed', String(mode !== 'off'));
        await expect(loop).toHaveAccessibleName(name);
    }
});

test('expanded chrome uses the configured main-bar slot to open volume', async ({ mount, page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('player_control_slot_primary', 'prev');
        localStorage.setItem('player_control_slot_secondary', 'volume');
    });
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.is-expanded').hover({ position: { x: 100, y: 80 } });
    expect(await wall.locator('.lattice-chrome-actions button').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-action'))))
        .toEqual(['prev', 'prev', 'volume', 'next', 'mute', 'shuffle']);
    await wall.locator('.lattice-chrome [data-action=volume]').click();
    await expect(wall.locator('[data-command]')).toHaveAttribute('data-command', 'playback-volume');
    await expect(wall.locator('.lattice-chrome [data-action=lyrics-timeline]')).toHaveCount(0);
});

test('pause, resume and duration updates re-render no poster', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const transport = wall.locator('.lattice-poster.is-expanded .lattice-transport-button');
    const playing = await transport.getAttribute('aria-label');
    await expect(wall.locator('.lattice-poster')).not.toHaveCount(0);

    const counts = () => page.evaluate(() => (window as unknown as { __renderCounts: Record<string, number> }).__renderCounts);
    const resetCounts = () => page.evaluate(() => { (window as unknown as { __renderCounts: Record<string, number> }).__renderCounts = {}; });
    // Armed after the wall has settled so the opening wave's own renders are not counted. On a
    // loaded machine the wave can still be re-rendering posters after `settle`, so wait for a quiet
    // 300ms window rather than trusting the fixed wait. Renders that never stop still fail here.
    await expect.poll(async () => {
        await resetCounts();
        await page.waitForTimeout(300);
        return (await counts()).LatticePoster ?? 0;
    }, { intervals: [0], timeout: 10_000 }).toBe(0);
    await resetCounts();
    await wall.getByRole('button', { name: 'Toggle player state' }).click();
    await wall.getByRole('button', { name: 'Bump duration' }).click();

    // The expanded card's chrome still follows the transport...
    await expect(transport).not.toHaveAttribute('aria-label', playing!);
    // ...and the update reached it through the wall, not around it.
    expect((await counts()).Lattice ?? 0).toBeGreaterThan(0);
    expect((await counts()).LatticePoster ?? 0).toBe(0);
});

// bravais 的集合叠页边（--lattice-poster-elevation 接进共享海报的阴影列表）与缝的叠色 / 熄灯只在 bravais 的样式里：
// Lattice 的海报仍是四条阴影（三条透明的聚焦环位 + 抬升投影），没有向右下错开的页边。
test('Lattice posters keep their own shadow list without bravais stack edges', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const shadows = await wall.locator('.lattice-poster:not(.is-expanded):not(.is-focused)').first().evaluate((node) => {
        const text = getComputedStyle(node).boxShadow;
        return text.split(/,(?![^(]*\))/).map(part => part.trim());
    });
    expect(shadows).toHaveLength(4);
    expect(shadows.some(part => /\b3px 3px\b|\b6px 6px\b/.test(part))).toBe(false);
});
