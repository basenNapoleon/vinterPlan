import subprocess
import json,hashlib,os
s=open('shell.html').read()
for tag,f in [('DATA','data.js'),('FIGURES','figures.js'),('APP','app.js')]:
    s=s.replace('/*%s*/'%tag,subprocess.run(['terser',f,'-c','-m'],capture_output=True,text=True,check=True).stdout)
os.makedirs('dist',exist_ok=True)
open('dist/index.html','w').write(s)
v=hashlib.sha1(s.encode()).hexdigest()[:8]
open('dist/sw.js','w').write(f"""const C='vp-{v}';
const FILER=['./','index.html','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{{e.waitUntil(caches.open(C).then(c=>c.addAll(FILER)));self.skipWaiting();}});
self.addEventListener('activate',e=>{{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim();}});
self.addEventListener('fetch',e=>{{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;
e.respondWith(fetch(e.request).then(r=>{{const k=r.clone();caches.open(C).then(c=>c.put(e.request,k));return r;}}).catch(()=>caches.match(e.request).then(r=>r||caches.match('index.html'))));}});
""")
json.dump({"name":"Vinterplan","short_name":"Vinterplan","start_url":"./#idag","display":"standalone","background_color":"#f4f5f7","theme_color":"#1F3A5F",
 "icons":[{"src":"icon-192.png","sizes":"192x192","type":"image/png"},{"src":"icon-512.png","sizes":"512x512","type":"image/png"}]},open('dist/manifest.webmanifest','w'),ensure_ascii=False)
from PIL import Image
im=Image.open('icon-512.png')
for n in (180,192,512): im.resize((n,n),Image.LANCZOS).save(f'dist/icon-{n}.png')
print(v, len(s))
