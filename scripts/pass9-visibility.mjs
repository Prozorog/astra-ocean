import {chromium} from 'playwright';
import {isolateHMR} from './pass9-harness.mjs';
const b=await chromium.launch({headless:false,ignoreDefaultArgs:['--disable-backgrounding-occluded-windows','--disable-background-timer-throttling','--disable-renderer-backgrounding'],args:['--ignore-gpu-blocklist']});
try{const c=await b.newContext(),p=await c.newPage();await isolateHMR(p);await p.goto('http://localhost:4103/settings.html');await p.waitForFunction(()=>window.__settings?.ready);await p.bringToFront();console.log('initial',await p.evaluate(()=>({hidden:document.hidden,visibility:document.visibilityState})));
const next=c.waitForEvent('page');await p.evaluate(()=>window.open('about:blank','_blank'));const popup=await next;await popup.bringToFront();await p.waitForTimeout(300);console.log('popup',await p.evaluate(()=>({hidden:document.hidden,visibility:document.visibilityState,paused:[...document.querySelectorAll('video')].map(v=>v.paused)})));await popup.close();await p.bringToFront();
}finally{await b.close();}
