const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  const shots = [[3.5,'ghost-l1'],[5.85,'stroke-l1-liang'],[6.1,'spark-l1-liang'],[7.9,'done-l1'],[23.0,'en-queue'],[24.35,'stroke-l5-the'],[25.1,'spark-l5-morning'],[26.2,'en-done']];
  for (const [t,name] of shots) {
    await page.goto(`http://127.0.0.1:5261/index.html?v=10&t=${t}&pause=1`);
    await page.waitForTimeout(650);
    await page.screenshot({ path: `c:/项目/folia/preview-lyric-condense/shot-${name}.png` });
  }
  console.log(JSON.stringify({ errors: errs }));
  await browser.close(); console.log('SHOTS-OK');
})().catch(e=>{ console.error('FAIL', e); process.exit(1); });
