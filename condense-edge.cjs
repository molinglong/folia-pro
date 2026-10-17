const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  // 阈值=3：2字行不生效、5/6/7字与英文行全部凝聚；定格在「灯火漫过」前3排队+石桥凝聚
  const setThr = async (v) => page.evaluate((x) => { const s = document.getElementById('thr'); s.value = x; s.dispatchEvent(new Event('input')); }, v);
  await page.goto('http://127.0.0.1:5261/index.html?v=11&t=11.2&pause=1'); await page.waitForTimeout(500);
  await setThr(3); await page.waitForTimeout(400);
  await page.screenshot({ path: 'c:/项目/folia/preview-lyric-condense/shot-thr3-l2.png' });
  // 阈值=3 时 2字行（梦也）：units=2 < 3  不生效
  await page.goto('http://127.0.0.1:5261/index.html?v=11&t=14.9&pause=1'); await page.waitForTimeout(400);
  await setThr(3); await page.waitForTimeout(400);
  const s2 = await page.evaluate(() => { const st = document.getElementById('stage1'); const vis = Array.from(st.querySelectorAll('.line')).find(l => l.style.display === 'block'); return { anyOv: Array.from(vis.querySelectorAll('.ov')).some(o => o.style.display === 'flex'), words: vis.querySelectorAll('.row > .w').length }; });
  // 阈值=9：所有行都不凝聚（最大行 7 字/6 词）
  await page.goto('http://127.0.0.1:5261/index.html?v=11&t=6.0&pause=1'); await page.waitForTimeout(400);
  await setThr(9); await page.waitForTimeout(400);
  const s9 = await page.evaluate(() => { const st = document.getElementById('stage1'); const vis = Array.from(st.querySelectorAll('.line')).find(l => l.style.display === 'block'); return Array.from(vis.querySelectorAll('.ov')).map(o => o.style.display); });
  await page.screenshot({ path: 'c:/项目/folia/preview-lyric-condense/shot-thr9.png' });
  // 连续播放 3 秒无异常
  await page.goto('http://127.0.0.1:5261/index.html?v=11&t=5.0'); await page.waitForTimeout(3000);
  console.log(JSON.stringify({ thr3_2char: s2, thr9_ov: s9.filter(d => d === 'flex').length, errors: errs }));
  await browser.close(); console.log('EDGE-OK');
})().catch(e=>{ console.error('FAIL', e); process.exit(1); });
