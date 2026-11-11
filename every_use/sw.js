/* OF01 獨立離線 Service Worker；不更動原有背書控制邏輯 */
'use strict';
const CACHE_NAME='happyrecite-of01-assets';
const APP_BASE=new URL('./', self.location.href);
const ORIGIN=self.location.origin;
const CDN_HOSTS=new Set(['cdnjs.cloudflare.com','cdn.jsdelivr.net']);
const STATIC_EXT=/\.(?:html?|json|pdf|mp4|webp|png|jpe?g|js|css)$/i;
const RANGE_SUPPORTED=/\.mp4$/i;
const EXCLUDE_HOSTS=new Set(['script.google.com','fonts.googleapis.com','fonts.gstatic.com']);

self.addEventListener('install',event=>{
  // 不強制 skipWaiting：避免已開啟的背書頁被新版本搶接。
  event.waitUntil(caches.open(CACHE_NAME));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    // 只清除 OF01 自己管理的舊版快取，絕不動學習進度或原程式 IndexedDB。
    const names=await caches.keys();
    await Promise.all(names.filter(n=>n.startsWith('happyrecite-of01-') && n!==CACHE_NAME).map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});
function targetUrl(request){
  const url=new URL(request.url);
  if(url.origin===ORIGIN && url.pathname.startsWith(APP_BASE.pathname)){
    // 去除 ?t=、?nocache= 等動態參數，網址 s/g/k 不進入快取鍵。
    // 只有程式所需的靜態資源才進入該規則。
    if(!STATIC_EXT.test(url.pathname)) return null;
    const path=url.pathname.endsWith('/') ? 'index.html' : url.pathname;
    return new URL(path.replace(APP_BASE.pathname, ''),APP_BASE).href;
  }
  if(CDN_HOSTS.has(url.hostname) && STATIC_EXT.test(url.pathname)) return url.href;
  return null;
}
function isValidResponse(resp){return resp && (resp.ok || resp.type==='opaque');}
function doFetch(request){return fetch(request);}
async function offlineRange(response, rangeHeader){
  const data=await response.blob();
  const total=data.size;
  const m=/^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if(!m || !total) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${total}`}});
  let start,end;
  if(!m[1]){
    const count=Number(m[2]);
    if(!Number.isSafeInteger(count)||count<=0) return new Response(null,{status:416,headers:{'Content-Range':`bytes */${total}`}});
    start=Math.max(0,total-count);end=total-1;
  } else {
    start=Number(m[1]);end=m[2]?Number(m[2]):total-1;
  }
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=total||end<start)
    return new Response(null,{status:416,headers:{'Content-Range':`bytes */${total}`}});
  end=Math.min(end,total-1);
  const headers=new Headers();
  headers.set('Content-Type',response.headers.get('Content-Type')||'video/mp4');
  headers.set('Accept-Ranges','bytes');
  headers.set('Content-Range',`bytes ${start}-${end}/${total}`);
  headers.set('Content-Length',String(end-start+1));
  return new Response(data.slice(start,end+1),{status:206,statusText:'Partial Content',headers});
}
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(EXCLUDE_HOSTS.has(url.hostname)) return;
  const key=targetUrl(req);
  if(!key) return;
  // 預下載管理程式指定強制網路檢查時不得回傳舊快取；
  // 原背書程式的 ?nocache= 與 cache:no-store 仍然正常使用離線快取。
  if(req.cache==='reload'||req.cache==='no-cache') return; // GAS、上傳、雲端排名等線上功能一律不攔截
  const isNavigate=req.mode==='navigate';
  const isRange=RANGE_SUPPORTED.test(url.pathname)&&req.headers.has('Range');
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const saved=await cache.match(key);
    if(isRange){
      if(saved && saved.type!=='opaque' && saved.status===200)
        return offlineRange(saved,req.headers.get('Range'));
      // 還沒完整預先下載的影片，直接維持原本的網路 Range 播放。
      return doFetch(req);
    }
    if(isNavigate){
      // 主程式有更新時優先取得新版；斷網時退回已預先下載的 index.html。
      try{
        const fresh=await fetch(req);
        if(fresh.ok){
          if(url.pathname===APP_BASE.pathname+'index.html'||url.pathname===APP_BASE.pathname)
            event.waitUntil(cache.put(new URL('index.html',APP_BASE).href,fresh.clone()).catch(()=>{}));
          return fresh;
        }
      }catch(_){ }
      if(saved) return saved;
      const index=await cache.match(new URL('index.html',APP_BASE).href);
      if(index) return index;
      return new Response('離線主程式尚未下載完成，請先連線完成 OF01 下載。',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
    }
    if(saved) return saved;
    // 未預下載的檔案仍照原程式連線讀取，不強制變更行為。
    const fresh=await fetch(req);
    // 不在這裡自動快取大影片的 206 回應；只有完整下載才標記可離線。
    if(fresh.status===200 && isValidResponse(fresh)) {
      event.waitUntil(cache.put(key,fresh.clone()).catch(()=>{}));
    } else if(fresh.type==='opaque') {
      event.waitUntil(cache.put(key,fresh.clone()).catch(()=>{}));
    }
    return fresh;
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='OF01_STATUS') event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    event.source?.postMessage({type:'OF01_STATUS_RESULT',count:(await cache.keys()).length});
  })());
});
