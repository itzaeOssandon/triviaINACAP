import { test, expect } from '@playwright/test';
import { BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
import { makeLiveHandler } from '../../api/live.js';

test.setTimeout(90000);

function testApi({failFirstStart=false,onState=()=>{}}={}) {
  const files=new Map();let sequence=0;
  const storage={
    async head(path){const f=files.get(path);if(!f)throw new BlobNotFoundError();return {etag:f.etag};},
    async get(path){const f=files.get(path);return f?{stream:new Blob([f.text]).stream(),blob:{etag:`W/"download-${f.etag}"`}}:null;},
    async put(path,text,opts){const old=files.get(path);if(opts.ifMatch&&old?.etag!==opts.ifMatch)throw new BlobPreconditionFailedError();if(old&&!opts.allowOverwrite)throw new Error('Already exists');files.set(path,{text,etag:String(++sequence),uploadedAt:new Date(Date.now()+sequence)});},
    async del(path){files.delete(path);},
    async list({prefix}){return {blobs:[...files].filter(([p])=>p.startsWith(prefix)).map(([pathname,f])=>({pathname,uploadedAt:f.uploadedAt})),hasMore:false};}
  };
  const handler=makeLiveHandler(storage);
  return async route=>{
    const request=route.request(),body=request.postDataJSON();
    if(body.action==='state')onState();
    if(body.action==='start'&&failFirstStart){failFirstStart=false;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'La sala se está actualizando. Inténtalo de nuevo.'})});}
    const result=await new Promise((resolve,reject)=>{
      const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){resolve({status:this.code,body:JSON.stringify(data),headers:{...this.headers,'Content-Type':'application/json'}});}};
      handler({method:request.method(),headers:request.headers(),body,query:{}},res).catch(reject);
    });
    await route.fulfill(result);
  };
}

test('presenter starts a room and both connected phones receive the first question',async({browser})=>{
  const api=testApi(),context=await browser.newContext(),host=await context.newPage();
  const phone1=await context.newPage(),phone2=await context.newPage();
  const errors=[];for(const page of [host,phone1,phone2]){page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/live',api);}
  await host.goto('/');await host.getByRole('button',{name:'Crear sala · Presentador'}).click();
  await host.getByRole('button',{name:'Crear sala y mostrar QR'}).click();
  await expect(host.locator('.live-pin')).toBeVisible();
  const code=(await host.locator('.live-pin').textContent()).trim();
  for(const [index,phone] of [phone1,phone2].entries()){
    await phone.goto(`/?sala=${code}`);await phone.locator('#live-name').fill(`Persona ${index+1}`);await phone.getByRole('button',{name:'¡Entrar a la sala!'}).click();await expect(phone.getByRole('heading',{name:'¡Estás dentro!'})).toBeVisible();
  }
  await expect(host.locator('#audience-title')).toContainText('2 participantes');
  await expect(host.getByRole('button',{name:'¡Comenzar el show!'})).toBeEnabled();
  await host.getByRole('button',{name:'¡Comenzar el show!'}).click();
  await expect(host.locator('.live-question')).toBeVisible();
  for(const phone of [phone1,phone2])await expect(phone.locator('.live-question')).toHaveText(await host.locator('.live-question').textContent());
  expect(errors).toEqual([]);await context.close();
});


test('start errors remain visible through polling and the presenter can retry',async({browser})=>{
  let stateRequests=0;
  const api=testApi({failFirstStart:true,onState:()=>stateRequests++});
  const context=await browser.newContext(),host=await context.newPage(),phone=await context.newPage();
  for(const page of [host,phone])await page.route('**/api/live',api);
  await host.goto('/');await host.getByRole('button',{name:'Crear sala · Presentador'}).click();
  await host.getByRole('button',{name:'Crear sala y mostrar QR'}).click();
  const code=(await host.locator('.live-pin').textContent()).trim();
  await phone.goto(`/?sala=${code}`);await phone.locator('#live-name').fill('Participante');
  await phone.getByRole('button',{name:'¡Entrar a la sala!'}).click();
  const start=host.getByRole('button',{name:'¡Comenzar el show!'});
  await expect(start).toBeEnabled();await start.click();
  await expect(host.locator('#live-notice')).toHaveText('La sala se está actualizando. Inténtalo de nuevo.');
  const polls=stateRequests;
  await expect.poll(()=>stateRequests).toBeGreaterThanOrEqual(polls+4);
  await expect(host.locator('#live-notice')).toHaveText('La sala se está actualizando. Inténtalo de nuevo.');
  await expect(start).toBeEnabled();await start.click();
  await expect(host.locator('.live-question')).toBeVisible();
  await expect(host.locator('#live-notice')).toHaveText('');
  await context.close();
});
