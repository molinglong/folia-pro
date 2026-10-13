// dev/fork/cdp-lattice-entries.mjs
// @fork 本地魔改版专用（2026-10-13 第八刀）：连到自打包 Folia 的 CDP（9222），在真窗口里验两颗新的「进入 Lattice」入口，并截图留证。
// 用法: node dev/fork/cdp-lattice-entries.mjs
// 前提: C:\folia-build\win-unpacked\Folia.exe --remote-debugging-port=9222 已起（见 skills/fork-build-package）。
// 判据与 test/component/bravaisChrome.spec.ts、bravaisPlayingCard.spec.ts 同一条路，只是换成真桌面壳 + 用户真实档案：
//   ① 右下角工具按钮正上方那颗常驻「前往 Lattice」在、48×48、右缘对齐、容器盒子没被它撑高、面板开着不盖住它；
//   ② 展开一张「不是正在播放」的聚焦卡，卡上仍有 open-lattice 那颗（2026-10-13 放开门控的证据）；
//   ③ 点常驻那颗 → 视图变 #lattice，且这颗消失（dock 换成 Lattice 认领）；回来它又出现。
// 两个实测踩过的坑（别再去掉）：
//   应用会开在用户上次停的视图上——可能就是 #lattice，那一面本来就没有这颗，先回墙再量（ensureOnWall）；
//   从 Lattice 回墙时正在播放那张会被强制展开，所以「非正在播放的卡」这一条必须在进 Lattice 之前测。
// 这是用户真实的听歌环境：进去第一件事静音 + 暂停，不碰登录、不碰播放。
import { chromium } from 'playwright-core';

const OUT = 'C:/folia-build';
const problems = [];
const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${JSON.stringify(detail)}` : ''}`);
    if (!ok) problems.push(name);
};

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const pages = browser.contexts()[0].pages();
const page = pages.find(p => /index\.html|file:\/\/|localhost/.test(p.url())) ?? pages[0];
if (!page) {
    console.log('RESULT FAIL 没有可用页面', pages.map(p => p.url()));
    process.exit(1);
}
console.log('URL', page.url());

await page.evaluate(() => {
    document.querySelectorAll('audio, video').forEach(el => {
        el.muted = true;
        el.volume = 0;
        if (typeof el.pause === 'function') el.pause();
    });
    window.__forkMuted = true;
});

// 首启可能挡着引导层（第四刀之后理论上没有，但档案是用户的，先按「关闭」兜一层）。
await page.evaluate(() => {
    const mask = [...document.querySelectorAll('button')]
        .find(b => b.getAttribute('aria-label') === '关闭' && b.closest('div.fixed.inset-0'));
    mask?.click();
});
await page.waitForTimeout(600);

const view = () => page.evaluate(() => ({
    hash: location.hash,
    tools: document.querySelectorAll('.lattice-tools').length,
    companion: document.querySelectorAll('[data-wall-tools-companion]').length,
    stage: document.querySelector('[data-library-stage]')?.getAttribute('data-library-stage') ?? null,
    expanded: document.querySelectorAll('[data-bravais-expanded]').length,
}));

/** 离开海报墙，直到停在资料库墙上（工具按钮与 companion 都在）。 */
const ensureOnWall = async () => {
    for (let step = 0; step < 8; step++) {
        const now = await view();
        if (now.hash !== '#lattice' && now.tools === 1 && now.companion === 1) return now;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1500);
    }
    return view();
};

const onWall = await ensureOnWall();
if (onWall.tools !== 1 || onWall.companion !== 1) {
    console.log('RESULT FAIL 没能停在资料库墙上', JSON.stringify(onWall));
    process.exit(1);
}
// 墙上可能留着上次展开的那张（多半正是正在播放的），先收一次，免得下面的「点一张非正在播放的卡」被它干扰。
if (onWall.expanded > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
}

const geometry = await page.evaluate(() => {
    const box = node => {
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    };
    const companion = document.querySelector('[data-wall-tools-companion]');
    const tools = document.querySelector('.lattice-tools button:not([data-wall-tools-companion])');
    const stack = document.querySelector('.lattice-tools');
    const style = companion ? getComputedStyle(companion) : null;
    return {
        id: companion?.getAttribute('data-wall-tools-companion') ?? null,
        label: companion?.getAttribute('aria-label') ?? null,
        title: companion?.getAttribute('title') ?? null,
        position: style?.position ?? null,
        companion: box(companion),
        tools: box(tools),
        stack: box(stack),
    };
});
check('常驻那颗存在且带可访问名', Boolean(geometry.companion && geometry.label), geometry);
check('与工具按钮同宽同高 48', geometry.companion?.w === 48 && geometry.companion?.h === 48, geometry.companion);
check('右缘对齐工具按钮', Boolean(geometry.companion && geometry.tools
    && Math.abs((geometry.companion.x + geometry.companion.w) - (geometry.tools.x + geometry.tools.w)) < 1),
{ companion: geometry.companion, tools: geometry.tools });
check('排在按钮正上方 10px', Boolean(geometry.companion && geometry.tools
    && Math.abs(geometry.tools.y - (geometry.companion.y + geometry.companion.h) - 10) < 1),
{ gap: geometry.companion && geometry.tools ? geometry.tools.y - (geometry.companion.y + geometry.companion.h) : null });
check('容器盒子仍是 48×48（这颗出文档流）', geometry.stack?.w === 48 && geometry.stack?.h === 48, geometry.stack);
check('可访问名与 tooltip', geometry.label === '前往 Lattice' && /Ctrl \+ B/.test(geometry.title ?? ''),
{ label: geometry.label, title: geometry.title });

await page.screenshot({ path: `${OUT}/lattice-entries-corner.png`, clip: {
    x: Math.max(0, geometry.stack.x - 340), y: Math.max(0, geometry.stack.y - 340), width: 360, height: 360,
} }).catch(() => null);

// 展开面板：面板要整块让开常驻那颗。
await page.evaluate(() => document.querySelector('.lattice-tools button:not([data-wall-tools-companion])')?.click());
await page.waitForTimeout(700);
const panelFit = await page.evaluate(() => {
    const panel = document.querySelector('.lattice-tools-panel');
    const companion = document.querySelector('[data-wall-tools-companion]');
    if (!panel || !companion) return { panel: !!panel, companion: !!companion };
    const p = panel.getBoundingClientRect();
    const c = companion.getBoundingClientRect();
    return { panel: true, companion: true, panelBottom: Math.round(p.bottom * 10) / 10, companionTop: Math.round(c.top * 10) / 10 };
});
check('面板开着时常驻那颗没被盖住', panelFit.panel && panelFit.companion && panelFit.panelBottom <= panelFit.companionTop + 0.5, panelFit);
await page.screenshot({ path: `${OUT}/lattice-entries-panel.png` }).catch(() => null);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// 展开一张「不是正在播放」的聚焦卡：那颗仍要画（门控已放开）。必须在进 Lattice 之前测。
// 两件事得先做对：① 回到首页层——集合层里点磁贴是进下一层，不展开聚焦卡；② 用真鼠标点——element.click() 打不开磁贴。
for (let step = 0; step < 5; step++) {
    const layer = await page.evaluate(() => document.querySelector('[data-library-stage]')?.getAttribute('data-bravais-layer') ?? null);
    if (layer?.startsWith('home:')) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1400);
}
const target = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.bravais-tile[data-library-entry]')];
    const pick = tiles.find(tile => {
        const r = tile.getBoundingClientRect();
        return r.left > 200 && r.top > 140 && r.right < window.innerWidth - 200 && r.bottom < window.innerHeight - 200
            && tile.getAttribute('data-bravais-current') !== 'true';
    });
    if (!pick) return { picked: false, tiles: tiles.length };
    const r = pick.getBoundingClientRect();
    return { picked: true, entry: pick.getAttribute('data-library-entry'), x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (target.picked) await page.mouse.click(target.x, target.y);
await page.waitForFunction(() => document.querySelectorAll('[data-bravais-expanded]').length > 0, null, { timeout: 8_000 }).catch(() => null);
await page.waitForTimeout(1200);
const card = await page.evaluate(() => {
    const open = document.querySelector('[data-bravais-expanded]');
    const button = open?.querySelector('[data-bravais-action="open-lattice"]');
    return {
        expanded: Boolean(open),
        isCurrent: open?.getAttribute('data-bravais-current') === 'true',
        entry: open?.getAttribute('data-library-entry') ?? null,
        button: Boolean(button),
        label: button?.getAttribute('aria-label') ?? null,
        actions: open ? [...open.querySelectorAll('[data-bravais-action]')].map(b => b.getAttribute('data-bravais-action')) : null,
    };
});
check('展开的是非正在播放的那张', target.picked && card.expanded && !card.isCurrent && card.entry === target.entry, { target, card });
check('非正在播放的卡上也画那颗', card.button, card);
await page.screenshot({ path: `${OUT}/lattice-entries-focus-card.png` }).catch(() => null);
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

// 点常驻那颗 → 进 Lattice，且这颗消失（dock 换成 Lattice 认领）。
await page.evaluate(() => document.querySelector('[data-wall-tools-companion]')?.click());
await page.waitForTimeout(2500);
const inLattice = await view();
check('点了进 Lattice', inLattice.hash === '#lattice' || /#lattice/.test(inLattice.hash), inLattice);
check('进了 Lattice 这颗不再画', inLattice.companion === 0 && inLattice.tools === 1, inLattice);
await page.screenshot({ path: `${OUT}/lattice-entries-in-lattice.png` }).catch(() => null);

// 回资料库墙：先按 Esc（Lattice 自己的阶梯），没退就走它左上角那颗返回按钮；两种都试到离开为止。
for (let step = 0; step < 4; step++) {
    if ((await view()).hash !== '#lattice') break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1600);
    if ((await view()).hash === '#lattice') {
        await page.evaluate(() => document.querySelector('.lattice-back')?.click());
        await page.waitForTimeout(1600);
    }
}
await page.waitForTimeout(1200);
const backOnWall = await view();
check('回到资料库墙它又出现', backOnWall.companion === 1 && backOnWall.tools === 1, backOnWall);

console.log(problems.length ? `RESULT FAIL ${problems.join(' | ')}` : 'RESULT PASS 全部通过');
await browser.close().catch(() => {});
process.exit(problems.length ? 1 : 0);
