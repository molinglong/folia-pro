import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { ONLINE_FIXTURES, PROBE_ALBUM, PROBE_PROVIDER_A } from '../../dev/probes/libraryBehavior/fixtureRules';
import '../../dev/probes/libraryBehavior/probeApi';

// test/component/bravaisSeamAlbum.spec.ts
// @fork 本地魔改版（2026-10-13，用户批准的方案 A）：缝的「封面取色底 + 署名行」在真 DOM 里的闸门。
// - 标题区的 --bravais-seam-tone：有色相的封面才写、黑白封面不写、没有封面不写（也不报错）；底色由 CSS 的
//   color-mix 自己算（bravais.css），取色复用歌手磁贴那一份缓存与并发队列（bravaisArtistTone.ts）。
// - 署名行 data-bravais-seam-byline：只有专辑有（同一份描述换成歌单就不占位），艺人是真入口不是装饰文字。
// 挂 libraryBehavior 探针的 bravais suite，但不走 fixture 名单——探针里没有任何专辑带着艺人 / 发行方 / 封面，
// 所以直接写导航 store 塞一份描述（与宿主打开集合是同一个动作，useLibraryProbeHarness.ts:240-242）：
// 曲目、详情、歌手页都由假 provider 现成的 probe-a:album:al-1 / ar-1 / ar-2 供给，改的只是描述上的字段，
// 上游的探针文件一行都不用动（fixtureRules.ts 与 useLibraryProbeHarness.ts 至今保持与官方一致）。

const ALBUM_TRACK_COUNT = PROBE_ALBUM.rawIndexes.length;
const ALBUM_RELEASE_DATE = Date.UTC(2021, 0, 5);
const PUBLISHER = 'Probe Records';
/** 发行信息行：日期由浏览器本地化（Node 与页面的 locale 不同，判据必须在页面里算）。 */
const factLine = (page: Page) => page.evaluate(options => `${new Date(options.timestamp).toLocaleDateString()} · ${options.publisher}`, { timestamp: ALBUM_RELEASE_DATE, publisher: PUBLISHER });

/** 封面：画一张纯色 canvas 转 blob URL（同源、像素读得出——与 bravais-kinds 的封面同一手法，kindsData.ts:33-99）。 */
const makeCover = (page: Page, color: string) => page.evaluate(value => new Promise<string>(resolve => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.fillStyle = value;
    context.fillRect(0, 0, 64, 64);
    canvas.toBlob(blob => resolve(URL.createObjectURL(blob!)), 'image/jpeg');
}), color);

type SeamCollectionInput = {
    coverUrl?: string;
    type?: 'album' | 'playlist';
    id?: string;
    name?: string;
};

/** 把一份带发行信息的集合描述塞进导航 store（首页打开集合的同一条路）。 */
const openSeamCollection = (page: Page, input: SeamCollectionInput) => page.evaluate(options => (async () => {
    const adaptersPath = '/src/components/app/home/gridViewCollectionAdapters.ts';
    const navigationPath = '/src/stores/useCollectionNavigationStore.ts';
    const [adapters, navigation] = await Promise.all([
        import(/* @vite-ignore */ adaptersPath),
        import(/* @vite-ignore */ navigationPath),
    ]) as any[];
    const descriptor = adapters.createOnlineGridViewCollection({
        id: options.id,
        name: options.name,
        type: options.type,
        trackCount: options.trackCount,
        // 这两个 id 与名字就是假 provider 的在线歌手规则（fixtureRules.ts:307-332），所以署名行点了能进歌手页。
        artists: [{ id: 'ar-1', name: 'Probe Artist' }, { id: 'ar-2', name: 'Guest Singer' }],
        publisher: options.publisher,
        publishedAt: options.publishedAt,
        ...(options.coverUrl ? { coverUrl: options.coverUrl } : {}),
    }, options.providerId);
    navigation.useCollectionNavigationStore.getState().openRoot(descriptor, 'home');
})(), {
    providerId: PROBE_PROVIDER_A,
    publisher: PUBLISHER,
    id: input.id ?? PROBE_ALBUM.id,
    name: input.name ?? PROBE_ALBUM.name,
    type: input.type ?? 'album',
    trackCount: ALBUM_TRACK_COUNT,
    publishedAt: ALBUM_RELEASE_DATE,
    coverUrl: input.coverUrl,
});

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await mount('libraryBehavior');
    await expect.poll(() => page.evaluate(() => window.__libraryProbe?.ready() ?? false)).toBe(true);
    await page.evaluate(() => window.__libraryProbe!.setSuite('bravais'));
};

const titleArea = (page: Page) => page.locator('[data-library-stage="bravais"] .bravais-seam-full .bravais-seam-title-area');
const byline = (page: Page) => page.locator('[data-library-stage="bravais"] .bravais-seam-full [data-bravais-seam-byline]');
/** 标题区上写死的自定义属性（没写时是空串）；CSS 拿它算 color-mix 的底色。 */
const seamTone = (page: Page) => titleArea(page).evaluate(node => node.style.getPropertyValue('--bravais-seam-tone'));
/** 标题区底色的不透明度：透明档是 0，取色底那一档是 10%（color-mix 的强度写在 bravais.css 里）。 */
const backgroundAlpha = (locator: Locator) => locator.evaluate(node => {
    const value = getComputedStyle(node).backgroundColor;
    // Chrome 把 color-mix 出来的颜色序列化成 color(srgb r g b / a)，不是 rgba()，两种都按 alpha 读。
    const numbers = (value.match(/[\d.]+/g) ?? []).map(Number);
    if (value.startsWith('color(')) return numbers[3] ?? 0;
    return numbers.length > 3 ? numbers[3] : 1;
});

/** 打开集合，等完整信息条就位、详情请求也落定（署名行读的是详情盖在描述上的那一份），再等翻牌转完。 */
const openAndSettle = async (page: Page, input: SeamCollectionInput, op: 'albumDetail' | 'playlistDetail') => {
    const expected = input.name ?? PROBE_ALBUM.name;
    await openSeamCollection(page, input);
    await expect(page.locator('[data-library-stage="bravais"] .bravais-seam-full [data-bravais-seam-title]')).toHaveText(expected);
    await expect.poll(
        () => page.evaluate(callOp => window.__libraryProbe!.requests().some(request => request.op === callOp), op),
        { timeout: 15_000 },
    ).toBe(true);
    await page.waitForTimeout(1200);
};

test.describe('[bravais-only] seam cover tone and byline', () => {
    test('a colored cover tints the title area, and the byline names the release', async ({ mount, page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error)));
        await mountBravais(mount, page);
        await openAndSettle(page, { coverUrl: await makeCover(page, '#7c3aed') }, 'albumDetail');

        // 取色落定：hsl(h 62% 66%)——饱和与亮度是取色器的定档，只有色相由封面决定（#7c3aed ≈ 262°，JPEG 有 ±2 的抖动）。
        const tone = await seamTone(page);
        expect(tone).toMatch(/^hsl\(\d+ 62% 66%\)$/);
        const hue = Number(tone.match(/^hsl\((\d+)/)?.[1] ?? '-1');
        expect(hue).toBeGreaterThanOrEqual(250);
        expect(hue).toBeLessThanOrEqual(275);
        // 底色真的画出来了：样张定的那一档 10%（不是透明、也没盖过纸）。
        expect(await backgroundAlpha(titleArea(page))).toBeCloseTo(0.1, 2);

        // 署名行：艺人一行（两个名字）、发行信息一行（本地化的日期 · 出版方）。
        await expect(byline(page)).toBeVisible();
        await expect(page.locator('[data-bravais-seam-byline-artist]')).toHaveText(['Probe Artist', 'Guest Singer']);
        await expect(page.locator('[data-bravais-seam-byline-fact]')).toHaveText([await factLine(page)]);
        expect(errors).toEqual([]);
    });

    test('a black-and-white cover leaves the title area on paper', async ({ mount, page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error)));
        await mountBravais(mount, page);
        await openAndSettle(page, { coverUrl: await makeCover(page, '#808080') }, 'albumDetail');
        // 平均色的色度不到门槛（MIN_CHROMA）→ 取色结果是 null → 属性不写，标题区保持透明（画在纸上）。
        expect(await seamTone(page)).toBe('');
        expect(await backgroundAlpha(titleArea(page))).toBeCloseTo(0, 5);
        // @fork 反向断言：不变色不代表这块没了——署名行照旧在。
        await expect(page.locator('[data-bravais-seam-byline-artist]')).toHaveCount(2);
        expect(errors).toEqual([]);
    });

    test('no cover writes nothing and still shows the byline', async ({ mount, page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error)));
        await mountBravais(mount, page);
        await openAndSettle(page, {}, 'albumDetail');
        expect(await seamTone(page)).toBe('');
        expect(await backgroundAlpha(titleArea(page))).toBeCloseTo(0, 5);
        await expect(page.locator('[data-bravais-seam-byline-fact]')).toHaveText([await factLine(page)]);
        expect(errors).toEqual([]);
    });

    test('the byline artists are real entries into the artist page', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await openAndSettle(page, { coverUrl: await makeCover(page, '#2f9e44') }, 'albumDetail');
        // @fork 反向断言：署名行的艺人是真入口（点了压栈进歌手页），不是装饰文字。
        await page.locator('[data-bravais-seam-byline-artist]').first().click();
        await expect(page.locator('[data-library-stage="bravais"] [data-bravais-seam-title]')).toHaveText('Probe Artist');
    });

    test('the same description as a playlist gets no byline', async ({ mount, page }) => {
        await mountBravais(mount, page);
        // @fork 反向断言：署名行是专辑专属（与网格的 isAlbumCollection 同一道门）——只换类型，字段一个不少。
        // 名字由假 provider 的集合数据说了算（describe() 拿的是它那份 'Public Playlist'）。
        const name = ONLINE_FIXTURES['online-public'].name;
        await openAndSettle(page, { type: 'playlist', id: 'public', name }, 'playlistDetail');
        await expect(byline(page)).toHaveCount(0);
        await expect(page.locator('[data-bravais-seam-byline-artist]')).toHaveCount(0);
    });

    test('at a 720-high window the byline takes its height off the title, not the actions', async ({ mount, page }) => {
        // 用户选的档位（样张实测的窗口高度）。判据是同一次会话里的差值：同一份描述先按歌单开（没有署名行）、
        // 再按专辑开（有署名行），标题区那一格必须被压小、而那一排动作仍在缝里也在视口里——
        // 「署名行占掉的高度从标题区扣」（样张代价表：一行 24px / 两行 43px / 三行 63px）。
        await page.setViewportSize({ width: 1280, height: 720 });
        await mountBravais(mount, page);
        const playlistName = ONLINE_FIXTURES['online-public'].name;
        await openAndSettle(page, { type: 'playlist', id: 'public', name: playlistName }, 'playlistDetail');
        const titleWithoutByline = (await titleArea(page).boundingBox())!.height;
        expect(await byline(page).count()).toBe(0);

        await openAndSettle(page, { coverUrl: await makeCover(page, '#e8590c') }, 'albumDetail');
        const bylineBox = await byline(page).boundingBox();
        const titleWithByline = (await titleArea(page).boundingBox())!.height;
        // 标题区让出来的高度 ≈ 署名行占的那一段（余 6px 给间距与四舍五入）。
        expect(bylineBox).not.toBeNull();
        expect(titleWithoutByline - titleWithByline).toBeGreaterThanOrEqual(bylineBox!.height - 6);

        const seamBox = await page.locator('[data-library-stage="bravais"] .bravais-seam-full').boundingBox();
        expect(seamBox).not.toBeNull();
        const viewport = page.viewportSize()!;
        for (const action of ['play-scope', 'enqueue-scope', 'list', 'more']) {
            const box = await page.locator(`[data-library-stage="bravais"] .bravais-seam-full [data-bravais-seam-action="${action}"]`).first().boundingBox();
            expect(box, action).not.toBeNull();
            expect(box!.y, action).toBeGreaterThanOrEqual(0);
            expect(box!.y + box!.height, action).toBeLessThanOrEqual(Math.min(viewport.height, seamBox!.y + seamBox!.height) + 0.5);
        }
    });
});
