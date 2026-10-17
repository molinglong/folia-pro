const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const shots = [[11.8,'stroke-l2-shi'],[12.85,'spark-l2-qiao'],[14.9,'l3-3char-queue'],[6.75,'stroke-l1-liang'],[7.0,'spark-l1-liang']];
  for (const [t,name] of shots) {
    await page.goto(`http://127.0.0.1:5261/index.html?v=16&t=${t}&pause=1`);
    await page.waitForTimeout(650);
    await page.screenshot({ path: `c:/项目/folia/preview-lyric-condense/shot-${name}.png` });
  }
  console.log(JSON.stringify({ errors: errs }));
  await browser.close(); console.log('FINAL-OK');
})().catch(e=>{ console.error('FAIL', e); process.exit(1); });
