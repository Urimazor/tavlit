const fs=require('fs');let src=fs.readFileSync(__dirname+'/browser.js','utf8');
src=src.replace(/\/\/ run through presets[\s\S]*$/, () => `
  await page.selectOption('#presetSel', 'radial'); await page.waitForTimeout(1500);
  await page.click('.sec-head:has-text("תנועה")');
  for (const t of ['צורת החלק','מסגרת והתאמה']) { await page.click('.sec-head:has-text("'+t+'")'); }
  await page.waitForTimeout(300);
  const secs = await page.$$('.sec.open');
  for (let i=0;i<secs.length;i++) await secs[i].screenshot({ path: OUT + 'r3-sec'+i+'.png' });
  console.log(secs.length, errors); await browser.close(); })();`);
fs.writeFileSync(__dirname+'/ui-r3-run.js', src);
