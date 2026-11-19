/* OF01 離線管理（V999.101）：背景靜默檢查，僅實際需要下載時顯示進度。 */
(function(){
'use strict';
const PREFIX='OF01::';
const APP_ROOT=new URL('./',location.href);
const CACHE='happyrecite-of01-assets-root-v2';
const classic=(new URLSearchParams(location.search).get('classic')||'er_sheng');
const SAFE_CLASSIC=/^[A-Za-z0-9_-]+$/.test(classic)?classic:'er_sheng';
const ELEM_ID='of01-offline-banner';
let panel,progressEl,detailEl,closeBtn;
let manifest;
let running=false;
let hideTimer=null;
function assetKey(file){return new URL(file,APP_ROOT).href;}
function showPanel(){
  if(panel){panel.style.display='block';return;}
  panel=document.createElement('section');panel.id=ELEM_ID;
  panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');
  panel.style.cssText='position:fixed;z-index:999998;right:10px;bottom:10px;width:min(350px,calc(100vw - 20px));box-sizing:border-box;background:#111827;color:#fff;border:2px solid #34d399;border-radius:12px;padding:11px 12px;font:600 14px/1.45 system-ui,sans-serif;box-shadow:0 5px 20px #0008;';
  panel.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px"><strong>📦 OF01 離線教材</strong><button type="button" id="of01-close" aria-label="隱藏下載面板" style="background:#374151;color:white;border:0;border-radius:5px;padding:2px 8px">×</button></div><div id="of01-detail" style="font-size:12px;word-break:break-word;margin-top:5px">準備檢查…</div><progress id="of01-progress" max="100" value="0" style="display:block;width:100%;height:12px;margin-top:7px"></progress><div style="margin-top:5px;font-size:11px;color:#d1d5db">下載中仍可繼續背書；完成前請勿斷網</div>';
  document.body.appendChild(panel);
  progressEl=panel.querySelector('#of01-progress');detailEl=panel.querySelector('#of01-detail');closeBtn=panel.querySelector('#of01-close');
  closeBtn.addEventListener('click',()=>{panel.style.display='none';});
}
function status(message,done,total){
  if(!panel)showPanel();panel.style.display='block';
  detailEl.textContent=message;
  progressEl.value=total?Math.round(done/total*100):0;
}
function storedRev(url){try{return localStorage.getItem(PREFIX+'rev:'+url);}catch(_){return null;}}
function markRev(url,rev){try{localStorage.setItem(PREFIX+'rev:'+url,rev);}catch(_){}}
async function checkCapacity(){
  if(!navigator.storage?.estimate) return;
  try{const est=await navigator.storage.estimate();
    if(est.quota&&est.usage&&est.usage/est.quota>0.8){console.warn('[OF01] 手機儲存空間接近上限，可能無法快取大型 MP4');}
    if(navigator.storage.persist) await navigator.storage.persist().catch(()=>false);
  }catch(_){ }
}
async function getManifest(){
  const url=assetKey('offline_manifest.json');
  try{
    const response=await fetch(url,{cache:'no-cache'});
    if(!response.ok) throw new Error('HTTP '+response.status);
    const data=await response.json();
    if(!Array.isArray(data.commonFiles)||!Array.isArray(data.classicTemplates))throw new Error('清單格式錯誤');
    return data;
  }catch(err){
    const c=await caches.open(CACHE);
    const old=await c.match(url);
    if(old)return old.json();
    throw err;
  }
}
async function clearOldPdfIndexedDB(fileUrl){
  // 只清除同經文的 PDF 暫存資料，不觸碰學習進度、排程或其他資料庫。
  if(!fileUrl.endsWith('/classic/'+SAFE_CLASSIC+'_pdf.pdf'))return;
  try{
    const request=indexedDB.open('HappyReciteDB_'+SAFE_CLASSIC,1);
    await new Promise(resolve=>{
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('app_offline_files'))db.createObjectStore('app_offline_files');};
      request.onerror=()=>resolve();
      request.onsuccess=()=>{
        const db=request.result;
        try{const tx=db.transaction('app_offline_files','readwrite');tx.objectStore('app_offline_files').delete('pdf_file_v905');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();resolve();};}
        catch(_){db.close();resolve();}
      };
    });
  }catch(_){ }
}
async function ensureOne(cache,item){
  const url=item.url;const current=await cache.match(url);
  if(current&&storedRev(url)===item.rev) return true;
  try{
    const remote=new URL(url);
    // CDN 採 no-cors，允許儲存 opaque JS；同源檔案必須是完整 200。
    const isExternal=remote.origin!==location.origin;
    const request=new Request(url,isExternal?{mode:'no-cors',cache:'reload'}:{cache:'no-cache'});
    const response=await fetch(request);
    if(!(response.ok||isExternal&&response.type==='opaque')) throw new Error('HTTP '+response.status);
    if(!isExternal && response.status!==200) throw new Error('未取得完整檔案');
    // 影片必須是完整 200，不能將 206 分段回應當成已完成離線。
    await cache.put(url,response.clone());
    if(!isExternal && url.endsWith('/classic/'+SAFE_CLASSIC+'_pdf.pdf'))await clearOldPdfIndexedDB(url);
    markRev(url,item.rev);
    return true;
  }catch(err){
    console.warn('[OF01] 快取未完成',url,err);
    return false;
  }
}
function makeItems(data){
  const commonRev=String(data.commonRevision||'1');
  const classicRev=String(data.classicRevisions?.[SAFE_CLASSIC]||data.classicDefaultRevision||'1');
  const fileRevisions=data.fileRevisions||{};
  const common=[...new Set(data.commonFiles||[])].map(file=>({url:assetKey(file),rev:String(fileRevisions[file]||commonRev)}));
  const external=[...new Set(data.externalFiles||[])].map(file=>({url:file,rev:String(fileRevisions[file]||commonRev)}));
  const classicItems=[...new Set(data.classicTemplates||[])].map(t=>{const file=t.replaceAll('{classic}',SAFE_CLASSIC);return {url:assetKey(file),rev:String(fileRevisions[file]||classicRev)};});
  return [...common,...external,...classicItems];
}
async function downloadAll(){
  if(running)return;
  running=true;
  let completed=0,failed=[],toDownload=[];
  try{
    if(!('serviceWorker'in navigator)||!('caches'in window))throw new Error('此瀏覽器不支援離線快取');
    // 註冊、比對清單、查詢快取都在背景執行，不開啟提示視窗。
    await navigator.serviceWorker.register(assetKey('sw.js'),{scope:APP_ROOT.pathname});
    await navigator.serviceWorker.ready;
    await checkCapacity();
    manifest=await getManifest();
    const files=makeItems(manifest);
    const cache=await caches.open(CACHE);
    for(const item of files){
      const current=await cache.match(item.url);
      if(!current || storedRev(item.url)!==item.rev)toDownload.push(item);
    }
    // 已下載且版本一致：完全靜默，使用者不會看到檢查或完成訊息。
    if(toDownload.length===0){
      window.OF01_OFFLINE_STATE={ready:true,completed:files.length,total:files.length,failed:[]};
      return;
    }
    // 僅在確實有缺少或版本不同的檔案、開始取得新內容時才顯示下載狀態。
    if(hideTimer){clearTimeout(hideTimer);hideTimer=null;}
    let begun=false;
    function onDownloadProgress(){
      const prefix=failed.length?'（失敗 '+failed.length+'）':'';
      status('正在下載教材 '+completed+' / '+toDownload.length+' 個檔案'+prefix,completed,toDownload.length);
    }
    const otherFiles=toDownload.filter(x=>!(/\.mp4(?:$|\?)/i.test(x.url)));
    const videoFiles=toDownload.filter(x=>/\.mp4(?:$|\?)/i.test(x.url));
    async function fetchItems(items,parallel){
      let cursor=0;
      async function worker(){while(cursor<items.length){
        const item=items[cursor++];
        if(!begun){begun=true;onDownloadProgress();}
        const ok=await ensureOne(cache,item);
        completed++;
        if(!ok)failed.push(item.url);
        onDownloadProgress();
      }}
      await Promise.all(Array.from({length:parallel},worker));
    }
    // 沿用原本的低並行數，避免手機同時下載多支影片。
    await fetchItems(otherFiles,3);
    await fetchItems(videoFiles,1);
    if(failed.length){
      status('⚠️ '+failed.length+' 個教材尚未下載完成，下次開啟將自動補齊。',completed,toDownload.length);
      console.warn('[OF01] 以下未完整快取',failed);
    }else{
      status('✅ 教材更新完成',toDownload.length,toDownload.length);
      try{localStorage.setItem(PREFIX+'ready:'+SAFE_CLASSIC,new Date().toISOString());}catch(_){ }
    }
    // 更新結束即迅速收起，不再長時間擋住畫面。
    hideTimer=setTimeout(()=>{if(panel)panel.style.display='none';hideTimer=null;},failed.length?5000:1800);
    window.OF01_OFFLINE_STATE={ready:failed.length===0,completed:files.length-failed.length,total:files.length,failed};
  }catch(err){
    // 未開始下載前的錯誤也保持背景靜默；不彈出下載提示。
    console.warn('[OF01] 離線檢查未完成',err);
    if(panel&&panel.style.display!=='none'){
      panel.style.display='none';
    }
    window.OF01_OFFLINE_STATE={ready:false,error:String(err)};
  }finally{running=false;}
}
// LINE 內建瀏覽器不適合預下載；原程式會提示改用預設瀏覽器。
function start(){if(/Line/i.test(navigator.userAgent))return;downloadAll();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
window.OF01_retryDownload=downloadAll;
})();
