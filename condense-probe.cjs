// 凝聚原型定格自查：?t=&pause=1 截图 + DOM 状态断言（playwright，repo 内已有依赖）
const { chromium } = require('playwright');
const URL0 = 'http://127.0.0.1:5261/index.html';
const OUT = 'c:/项目/folia/preview-lyric-condense';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  const shot = async (t, name) => {
    await page.goto(`${URL0}?t=${t}&pause=1`);
    await page.waitForTimeout(600); // 让 rAF 至少渲染一帧定格
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };

  const state = async (t) => {
    await page.goto(`${URL0}?t=${t}&pause=1`);
    await page.waitForTimeout(500);
    return page.evaluate(() => {
      const stage = document.getElementById('stage1');
      const visible = Array.from(stage.querySelectorAll('.line')).find(l => l.style.display === 'block');
      const idx = Array.from(stage.children).indexOf(visible);
      const words = Array.from(visible.querySelectorAll('.row > .w')).map(el => ({
        text: el.textContent, display: el.style.display, op: el.style.opacity
      }));
      const ovs = Array.from(visible.querySelectorAll('.ov')).map(el => ({
        display: el.style.display, left: el.style.left, width: el.style.width
      }));
      return { idx, words, ovs };
    });
  };

  // —— 定格截图组 ——（l1：吹 start=5.6 凉 start=6.45，凝聚窗各 0.7s）
  await shot(3.5,  'shot-3.5-l1-mid');      // 前5字排队中，末2槽影预留
  await shot(5.8,  'shot-5.8-l1-chui');     // 「吹」凝聚中段（描边收紧）
  await shot(6.2,  'shot-6.2-l1-chui2');    // 「吹」阶段二：填充+四芒
  await shot(6.6,  'shot-6.6-l1-liang');    // 「凉」凝聚起（与吹间隔0.85s>窗，不需顺延）
  await shot(7.1,  'shot-7.1-l1-late');     // 「凉」阶段二
  await shot(7.45, 'shot-7.45-l1-done');    // 落定后：全句补齐
  await shot(8.5,  'shot-8.5-l2-ghost');    // 5字临界行：前3排队，末2槽影预留
  await shot(11.0, 'shot-11.0-l2-stone');   // 「石」凝聚（start=11.0）
  await shot(11.62,'shot-11.62-l2-qiao');   // 「桥」凝聚（start=11.9）
  await shot(14.5, 'shot-14.5-l3-plain');   // 2字行：不生效
  await shot(18.0, 'shot-18.0-l4-music');   // 纯音乐行
  await shot(24.35,'shot-24.35-l5-en');     // 英文行 the 凝聚（start=24.2）
  await shot(25.0, 'shot-25.0-l5-en2');     // morning 顺延至 24.9 后凝聚
  await shot(28.5, 'shot-28.5-l6');         // 6字行「归」凝聚（归 start=32.0? 否→此帧为排队段）
  await shot(32.2, 'shot-32.2-l6-cond');    // 6字行末两字凝聚段（归 32.0 / 途 32.9）

  // —— 关键断言 ——
  const a = await state(6.9);   // liang condensing: word display none, overlay visible
  const liang = a.words[6];
  const ovLiang = a.ovs[6];
  const b1 = await state(8.5);  // 石桥未出生：display 有、opacity≈0.10（槽影占位）
  const c = await state(25.0);  // morning 凝聚中
  const d = await state(14.5);  // 2字行：两个都排队，无覆盖层可见
  const e = await state(7.45);  // 落定后：凉 display 恢复、覆盖层隐藏
  console.log(JSON.stringify({
    t69: { liangDisplay: liang.display, ovDisplay: ovLiang.display, ovLeft: ovLiang.left, ovWidth: ovLiang.width },
    t85: { wu5: b1.words[4], wu6: b1.words[5] },
    t25: { morningDisplay: c.words[5].display, ovMorning: c.ovs[5].display },
    t145: { line3Words: d.words, anyOv: d.ovs.some(o => o.display === 'flex') },
    t745: { liangDisplay: e.words[6].display, ovLiang: e.ovs[6].display },
    errors: errs
  }, null, 1));

  // —— 拖回重演（f(t) 纯函数）——
  await page.goto(`${URL0}?t=7.45&pause=1`);
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => document.getElementById('lno1').textContent);
  await page.evaluate(() => { const s = document.getElementById('seek'); s.value = 6.9; s.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => {
    const st = document.getElementById('stage1');
    const vis = Array.from(st.querySelectorAll('.line')).find(l => l.style.display === 'block');
    const w = vis.querySelectorAll('.row > .w')[6];
    const ov = vis.querySelectorAll('.ov')[6];
    return { liangDisplay: getComputedStyle(w).display, ovDisplay: ov.style.display };
  });
  console.log(JSON.stringify({ before, dragBack: back }));
  await page.screenshot({ path: `${OUT}/shot-replay-back.png` });

  await browser.close();
  console.log('PROBE-DONE');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
