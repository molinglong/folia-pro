const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
  const shots = [[5.85,'stroke-l1-chui'],[6.1,'spark-l1-chui'],[10.25,'stroke-l2-shi'],[12.15,'spark-l2-qiao'],[24.35,'stroke-l5-the'],[32.15,'stroke-l6-gui'],[7.9,'done-l1'],[18.0,'music-line']];
  for (const [t,name] of shots) {
    await page.goto(`http://127.0.0.1:5261/index.html?v=9&t=${t}&pause=1`);
    await page.waitForTimeout(650);
    await page.screenshot({ path: `c:/项目/folia/preview-lyric-condense/shot-${name}.png` });
  }
  await browser.close(); console.log('SHOTS-OK');
})().catch(e=>{ console.error('FAIL', e); process.exit(1); });

