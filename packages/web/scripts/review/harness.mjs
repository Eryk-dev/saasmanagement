import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

export async function reviewHarness(screen, heading, prototypeNavigation, {nativeTimers = false} = {}) {
  const output = path.resolve(`.review-artifacts/${screen}`);
  await fs.mkdir(output, {recursive:true});
  const server = await createServer({configFile:path.resolve('vite.preview.config.js'),server:{port:0,strictPort:false}});
  await server.listen();
  const base=server.resolvedUrls.local[0];
  const browser=await chromium.launch();
  const errors=[];
  async function open(width, query='', reference=false) {
    const page=await browser.newPage({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce',timezoneId:'America/Sao_Paulo',permissions:['clipboard-read','clipboard-write']});
    page.setDefaultTimeout(10000);
    page.on('pageerror',error=>errors.push(error.message));
    const time = new Date('2026-09-18T15:00:00-03:00');
    if (nativeTimers) await page.clock.setFixedTime(time);
    else await page.clock.install({time});
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      return url.origin===new URL(base).origin || /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname) || (reference&&url.hostname==='unpkg.com') ? route.continue() : route.abort();
    });
    if(reference){
      await page.goto(`${base}responsive.html?width=${width}&prototype=1`);
      await page.goto(await page.locator('iframe').getAttribute('src'));
      await prototypeNavigation(page);
    } else await page.goto(`${base}?shell&review=${screen}${query}#${screen}`);
    await page.getByRole('heading',{name:heading,exact:true}).waitFor();
    await page.evaluate(()=>document.fonts.ready);
    return page;
  }
  return {open,errors,output,capture:(page,name)=>page.screenshot({path:path.join(output,`${name}.png`)}),write:(name,data)=>fs.writeFile(path.join(output,name),JSON.stringify(data,null,2)),close:async()=>{await browser.close();await server.close();}};
}
