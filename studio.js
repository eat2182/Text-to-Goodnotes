/* Progressive extension of the original editor. GoodnotesExport is unchanged. */
(async function(){
  'use strict';
  const L=HandLearning, store=new HandStorage.Store(), byId=id=>document.getElementById(id);
  const settingsIds=['size','spacing','paper','ink','naturalness','slant','scale','baseline','letterGap','wordGap','stroke','connections'];
  let learned=null,phrases=[],seed=1,ready=false,applying=false,knownGlyphs={},knownText='',trainingPaths=[],trainingPointer=null,trainingCurrent=null,referenceCanvas=null,referenceFile=null,referenceId=null,traceImage=null,trainingBusy=false;
  const originalLayout=layout,originalPersist=persist,originalAvailable=available,originalMissing=missingChars,originalIncomplete=incompleteChars;
  const status=(text,error=false)=>{byId('localStatus').textContent=text;byId('localStatus').classList.toggle('studio-error',error)};
  const tell=(text,error=false)=>{byId('trainingStatus').textContent=text;byId('trainingStatus').classList.toggle('studio-error',error)};
  store.onStatus=status;
  document.querySelector('main').classList.add('studio-boot');
  function settings(){return Object.fromEntries(settingsIds.map(id=>[id,byId(id).value]))}
  function currentInputs(){return {glyphs,phrases,images:store.values('sample:').flatMap(s=>Object.values(s.analyses||{}))}}
  function digest(){const s=JSON.stringify(currentInputs());let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return String(h>>>0)}
  function settingsValid(v){if(!v||typeof v!=='object')return false;const ranges={size:[14,36],spacing:[1.5,2.8],naturalness:[0,3],slant:[0,100],scale:[0,100],baseline:[0,100],letterGap:[30,180],wordGap:[40,200],stroke:[0,100],connections:[0,100]};return Object.entries(ranges).every(([k,[a,b]])=>Number.isFinite(+v[k])&&+v[k]>=a&&+v[k]<=b)&&['lined','grid','blank'].includes(v.paper)&&['#223d78','#24272c','#6e2b50'].includes(v.ink)}
  function validPaths(ss,maxX=720){return Array.isArray(ss)&&ss.length>0&&ss.length<=200&&ss.reduce((n,s)=>n+(Array.isArray(s)?s.length:50001),0)<=50000&&ss.every(s=>Array.isArray(s)&&s.length>0&&s.length<=10000&&s.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=maxX&&p[1]>=0&&p[1]<=240))}
  function refreshProfile(){
    const p=learned?.profile,view=byId('profileView');view.replaceChildren();
    if(!p){view.textContent='Noch kein Modell gelernt. Zeichne mehrere Varianten und starte das Lernen.';return}
    const fields=[['Echte Strichproben',p.examples],['Lernbare Formgruppen',p.learnable],['Neigung (Strichschätzung)',p.slant>.08?'leicht rechts':p.slant<-.08?'leicht links':'annähernd gerade'],['Mittlere Zeichenhöhe',p.meanHeight.toFixed(1)+' Zeicheneinheiten'],['Grundlinien-Streuung',p.baselineVariation.toFixed(1)+' (enthält Unterlängen)'],['Verbindungs-/Wortproben',phrases.length],['Bildmessungen',p.imageSamples],['Lernverfahren','Empirische Form-Kovarianz']];
    for(const [label,value] of fields){const el=document.createElement('div'),b=document.createElement('strong');b.textContent=label+': ';el.append(b,document.createTextNode(String(value)));view.append(el)}
    byId('modelStatus').textContent=store.get('modelDigest')===digest()?' Modell aktuell.':' Neue Proben vorhanden: bitte erneut lernen.';
  }
  function refreshLists(){
    phrases=store.values('phrase:');const list=byId('phraseList');list.replaceChildren();
    if(!phrases.length)list.textContent='Noch keine Wort- oder Verbindungsprobe.';
    for(const p of phrases){const row=document.createElement('div');row.className='sample-row';const label=document.createElement('span');label.textContent=p.label+' · '+p.ss.length+' Striche';const load=document.createElement('button');load.className='button';load.textContent='Ansehen';load.onclick=()=>{trainingPaths=clone(p.ss);byId('trainingLabel').value=p.label;drawTraining()};const remove=document.createElement('button');remove.className='button';remove.textContent='Entfernen';remove.onclick=()=>{store.set('phrase:'+p.id,null);refreshLists();refreshProfile();render()};row.append(label,load,remove);list.append(row)}
    const refs=byId('referenceList');refs.replaceChildren();for(const m of store.values('sample:')){const row=document.createElement('div');row.className='sample-row';const label=document.createElement('span');label.textContent=m.name+' · '+(m.size/1024/1024).toFixed(1)+' MB · '+Object.keys(m.analyses||{}).length+' Seiten analysiert';const open=document.createElement('button');open.className='button';open.textContent='Öffnen';open.onclick=()=>guard(async()=>{const b=await store.getFile(m.id);if(!b)throw Error('Originaldatei fehlt. Bitte erneut hochladen.');referenceFile=new File([b],m.name,{type:b.type});referenceId=m.id;byId('referencePage').value=1;await displayReference(1)});const remove=document.createElement('button');remove.className='button';remove.textContent='Entfernen';remove.onclick=()=>guard(async()=>{store.set('sample:'+m.id,null);await store.deleteFile(m.id);if(referenceId===m.id){referenceFile=null;referenceId=null;referenceCanvas=null;traceImage=null;byId('referencePreview').hidden=true;byId('traceReference').disabled=true;drawTraining()}refreshLists();refreshProfile()});row.append(label,open,remove);refs.append(row)}
    if(!refs.children.length)refs.textContent='Noch keine Seiten hochgeladen.';
  }
  function hydrate(){
    applying=true;const next=Object.create(null);for(const e of store.records.values()){if(!e.key.startsWith('glyph:')||e.value===null)continue;const parts=e.key.split(':');const char=String.fromCodePoint(Number(parts[1])),index=Number(parts[2]);if(validSample(e.value)){next[char]??=Array(10).fill(null);next[char][index]=clone(e.value)}}
    glyphs=next;knownGlyphs=JSON.parse(JSON.stringify(glyphs));$('text').value=store.get('text','Hallo, das ist meine Handschrift.');knownText=$('text').value;
    const opts=store.get('settings');if(settingsValid(opts))for(const id of settingsIds)byId(id).value=opts[id];seed=store.get('seed',1);learned=store.get('model');
    refreshLists();for(const id of settingsIds)if(byId(id+'Value'))byId(id+'Value').textContent=byId(id).value+(id==='size'||id==='spacing'?'':'%');
    strokes=clone(glyphs[selected]?.[slot]||[]);choose(selected,slot);render();refreshProfile();applying=false;
  }
  persist=function(){
    if(!ready||applying)return;
    const chars=new Set([...Object.keys(knownGlyphs),...Object.keys(glyphs)]);
    for(const char of chars)for(let i=0;i<10;i++){const a=knownGlyphs[char]?.[i]||null,b=glyphs[char]?.[i]||null;if(JSON.stringify(a)!==JSON.stringify(b))store.set('glyph:'+char.codePointAt(0)+':'+i,b)}
    knownGlyphs=JSON.parse(JSON.stringify(glyphs));const t=$('text').value;if(t!==knownText){store.set('text',t);knownText=t}store.set('settings',settings());store.set('seed',seed);refreshProfile();
  };
  available=function(c){if([...c].length===1)return originalAvailable(c);return phrases.filter(p=>p.label===c).map((p,index)=>({ss:p.ss,index}))};
  function chunks(text){
    const r=L.rng(seed+'connections'),list=[],s=text.replace(/\r\n?/g,'\n').normalize('NFC'),strength=+byId('connections').value/100;
    const sentences=[...new Set(phrases.filter(p=>/\s/.test(p.label)).map(p=>p.label))].sort((a,b)=>b.length-a.length);
    let at=0;while(at<s.length){
      const match=sentences.find(p=>s.startsWith(p,at)&&(at===0||/\s/.test(s[at-1]))&&(at+p.length===s.length||/\s|[.,!?]/.test(s[at+p.length])));
      if(match&&r()<strength){list.push([match]);at+=match.length;continue}
      const part=s.slice(at).match(/^\n|^[^\S\n]+|^[^\s]+/u)[0];at+=part.length;if(/^\s/.test(part)){list.push([part]);continue}
      list.push(L.tokenize(part,phrases,strength,seed+':'+at));
    }return list;
  }
  missingChars=function(){return [...new Set(chunks($('text').value).flat().filter(c=>!/\s/.test(c)&&!available(c).length))]};
  incompleteChars=function(){return [...new Set(chunks($('text').value).flat().filter(c=>[...c].length===1&&!/\s/.test(c)&&available(c).length<10))]};
  layout=function(text,size,spacing){
    if(!ready)return originalLayout(text,size,spacing);
    const opt=settings(),factor=size/120,line=size*spacing,pages=[[]],pick=variantPicker(),right=550;let x=45,y=60,occurrence=0;
    function newline(){x=45;y+=line;if(y>795){pages.push([]);y=60}}
    function info(c){
      if(/^\s+$/u.test(c))return {width:size*.43*[...c].length*(+opt.wordGap/100)};
      const chosen=pick(c);if(!chosen)return {width:size*.56,missing:true};
      const generated=L.generate(chosen.ss,c,learned,opt,seed+':'+(occurrence++)+':'+c),ss=generated.map(InkGeometry.prepare),bb=L.box(ss),b={min:bb.left,max:bb.right};
      // A stored sentence is a single learned motion. Fit unusually wide tokens.
      if((b.max-b.min)*factor>right-45){const squeeze=(right-45-4)/((b.max-b.min)*factor);for(const s of ss)for(const p of s)p[0]=b.min+(p[0]-b.min)*squeeze;b.max=b.min+(b.max-b.min)*squeeze}
      return {width:Math.max(2,(b.max-b.min)*factor)+size*.12*(+opt.letterGap/100),b,ss,variant:chosen.index};
    }
    for(const token of chunks(text)){
      if(token[0]==='\n'){newline();continue}
      const list=token.map(c=>({c,g:info(c)})),width=list.reduce((n,i)=>n+i.g.width,0);
      if(!/^\s/.test(token[0])&&x>45&&x+width>right)newline();
      for(const item of list){if(x+item.g.width>right)newline();if(!/^\s+$/.test(item.c))pages.at(-1).push({...item,x,y});x+=item.g.width}
    }return {pages,factor,line};
  };
  for(const id of settingsIds)byId(id).addEventListener('input',()=>{if(byId(id+'Value'))byId(id+'Value').textContent=byId(id).value+(id==='size'||id==='spacing'?'':'%');persist();render()});
  byId('newVariation').onclick=()=>{seed++;persist();render()};
  const tp=byId('trainingPad'),tc=tp.getContext('2d');tc.scale(2,2);
  function drawTraining(){tc.clearRect(0,0,720,240);tc.fillStyle='#f8fbff';tc.fillRect(0,0,720,240);if(traceImage){tc.save();tc.globalAlpha=.25;const sc=Math.min(660/traceImage.width,160/traceImage.height);tc.drawImage(traceImage,30,175-traceImage.height*sc,traceImage.width*sc,traceImage.height*sc);tc.restore()}
    for(const y of [55,95,175,215]){tc.beginPath();tc.strokeStyle=y===95||y===175?'#b8cdec':'#e1e8f3';tc.lineWidth=1;tc.moveTo(0,y);tc.lineTo(720,y);tc.stroke()}tc.strokeStyle=tc.fillStyle='#223d78';tc.lineWidth=3.2;tc.lineCap=tc.lineJoin='round';for(const s of trainingPaths)InkGeometry.draw(tc,InkGeometry.prepare(s));byId('trainingSave').disabled=trainingPointer!==null||!trainingPaths.length;byId('trainingUndo').disabled=byId('trainingClear').disabled=trainingPointer!==null}
  function point(e){const r=tp.getBoundingClientRect();return [Math.max(0,Math.min(720,(e.clientX-r.left)*720/r.width)),Math.max(0,Math.min(240,(e.clientY-r.top)*240/r.height))]}
  tp.addEventListener('pointerdown',e=>{if(trainingPointer!==null||e.button!==0||trainingPaths.length>=200)return;e.preventDefault();trainingPointer=e.pointerId;tp.setPointerCapture(e.pointerId);trainingCurrent=[point(e)];trainingPaths.push(trainingCurrent);drawTraining()});
  tp.addEventListener('pointermove',e=>{if(trainingPointer!==e.pointerId)return;e.preventDefault();for(const p of e.getCoalescedEvents?.()?.length?e.getCoalescedEvents():[e]){const v=point(p);if(trainingCurrent.length<10000&&Math.hypot(v[0]-trainingCurrent.at(-1)[0],v[1]-trainingCurrent.at(-1)[1])>.5)trainingCurrent.push(v)}drawTraining()});
  const endTraining=e=>{if(e.pointerId!==trainingPointer)return;if(e.type==='pointerup'&&trainingCurrent.length<10000)trainingCurrent.push(point(e));trainingPointer=null;trainingCurrent=null;drawTraining()};for(const type of ['pointerup','pointercancel','lostpointercapture'])tp.addEventListener(type,endTraining);
  byId('trainingUndo').onclick=()=>{if(trainingPointer!==null)return;trainingPaths.pop();drawTraining()};byId('trainingClear').onclick=()=>{if(trainingPointer!==null)return;trainingPaths=[];drawTraining()};
  byId('trainingSave').onclick=()=>guard(async()=>{
    const label=byId('trainingLabel').value.normalize('NFC').trim();if(!label||label.length>80||/[\r\n]/.test(label))throw Error('Bitte den geschriebenen Text in einer Zeile angeben.');if(!validPaths(trainingPaths))throw Error('Bitte zuerst eine gültige Probe zeichnen.');
    if([...label].length===1){const slots=glyphs[label]||Array(10).fill(null),i=slots.findIndex(s=>!s);if(i<0)throw Error('Für dieses Zeichen sind alle zehn Plätze belegt. Bitte im Buchstabenbereich eine Variante bearbeiten.');const b=L.box(trainingPaths);if(b.right-b.left>330)throw Error('Einzelbuchstaben bitte kleiner zeichnen.');const ss=trainingPaths.map(s=>s.map(([x,y])=>[x-b.left+15,y]));slots[i]=ss;glyphs[label]=slots;persist();choose(label,i);
    }else{if(phrases.length>=500)throw Error('Maximal 500 Wortproben. Bitte nicht mehr benötigte Proben entfernen.');if(phrases.filter(p=>p.label===label).length>=10)throw Error('Für diesen Text sind bereits zehn Proben gespeichert.');const id=HandStorage.uid();store.set('phrase:'+id,{id,label,ss:clone(trainingPaths),source:traceImage?'nachgezeichnet':'canvas'})}
    trainingPaths=[];drawTraining();refreshLists();refreshProfile();render();tell('Probe gespeichert. Nach weiteren Beispielen „Persönliches Modell lernen“ wählen.');
  });
  async function train(){
    if(trainingBusy)return;trainingBusy=true;byId('trainModel').disabled=true;try{
      persist();const count=Object.values(glyphs).flat().filter(Boolean).length+phrases.length;if(!count)throw Error('Zeichne zuerst Buchstaben oder Wörter.');byId('modelStatus').textContent=' Modell lernt lokal …';await new Promise(r=>setTimeout(r,30));
      const all=Object.assign(Object.create(null),JSON.parse(JSON.stringify(glyphs)));for(const p of phrases)(all[p.label]??=[]).push(p.ss);
      learned=L.train(all,phrases,currentInputs().images);store.set('model',learned);store.set('modelDigest',digest());refreshProfile();render();tell(learned.profile.learnable?'Modell gelernt. Zusätzliche Formen entstehen nur für passende Gruppen mit mindestens zwei Proben.':'Profil erstellt. Für gelernte Formvarianten brauchst du mindestens zwei ähnlich gezeichnete Proben desselben Zeichens oder Wortes.');
    }finally{trainingBusy=false;byId('trainModel').disabled=false}
  }
  byId('trainModel').onclick=()=>guard(train);
  async function displayReference(page){
    if(!referenceFile)throw Error('Bitte zuerst eine Handschriftseite auswählen.');tell('Seite wird lokal gelesen …');const result=await HandReferences.render(referenceFile,page);referenceCanvas=result.canvas;
    const analysis=L.analyzePixels(referenceCanvas.getContext('2d').getImageData(0,0,referenceCanvas.width,referenceCanvas.height).data,referenceCanvas.width,referenceCanvas.height);
    byId('referencePreview').src=referenceCanvas.toDataURL('image/png');byId('referencePreview').hidden=false;byId('referencePage').max=result.pages;byId('traceReference').disabled=false;byId('applyImageStyle').disabled=false;
    byId('referenceAnalysis').textContent=result.source+' · '+result.pages+' Seite(n) · Tintenanteil '+(analysis.inkRatio*100).toFixed(1)+' % · '+analysis.quality;
    const m=store.get('sample:'+referenceId);if(m)store.set('sample:'+referenceId,{...m,analyses:{...(m.analyses||{}),[page]:analysis}});refreshLists();refreshProfile();tell('Seite lokal analysiert. Für gelernte Buchstabenformen bitte beschriftete Strichproben ergänzen.');
  }
  byId('referenceFiles').onchange=()=>guard(async()=>{
    const files=[...byId('referenceFiles').files];let used=store.values('sample:').reduce((s,m)=>s+m.size,0);if(files.length>20)throw Error('Bitte höchstens 20 Dateien auf einmal auswählen.');
    for(const file of files){if(file.size>20*1024*1024||used+file.size>100*1024*1024)throw Error('Maximal 20 MB pro Datei und 100 MB insgesamt.');if(!/\.(png|jpe?g|webp|pdf|goodnotes)$/i.test(file.name))throw Error('Nicht unterstützter Dateityp: '+file.name);const id=HandStorage.uid();await store.putFile(id,file);store.set('sample:'+id,{id,name:file.name.slice(0,200),size:file.size,type:file.type,analyses:{}});used+=file.size;referenceFile=file;referenceId=id;byId('referencePage').value=1;try{await displayReference(1)}catch(e){tell(file.name+': '+e.message,true)}}
    byId('referenceFiles').value='';refreshLists();
  });
  byId('showReferencePage').onclick=()=>guard(()=>displayReference(Number(byId('referencePage').value)));
  byId('applyImageStyle').onclick=()=>{const a=store.get('sample:'+referenceId)?.analyses?.[byId('referencePage').value];if(!a)return;if(a.letterGapRatio>0)byId('letterGap').value=Math.round(Math.max(50,Math.min(160,a.letterGapRatio/.18*100)));if(a.wordGapRatio>0)byId('wordGap').value=Math.round(Math.max(60,Math.min(180,a.wordGapRatio/.65*100)));for(const id of ['letterGap','wordGap'])byId(id+'Value').textContent=byId(id).value+'%';persist();render();tell('Gemessene Abstände als Vorschlag übernommen. Bei Bedarf mit den Reglern korrigieren.');};
  byId('traceReference').onclick=()=>{traceImage=referenceCanvas;drawTraining();tp.scrollIntoView({behavior:'smooth',block:'center'})};byId('clearReference').onclick=()=>{traceImage=null;drawTraining()};
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
  byId('backupExport').onclick=()=>guard(async()=>{persist();byId('backupExport').disabled=true;try{const data=await store.backup();download(new Blob([JSON.stringify(data)],{type:'application/json'}),'handschrift-backup.json');status('Backup erstellt: bitte in deinem privaten Repository oder auf einem sicheren Laufwerk ablegen.')}finally{byId('backupExport').disabled=false}});
  function validateRecord(r){
    if(!r||typeof r.key!=='string'||!('value' in r))return false;if(r.value===null)return /^glyph:\d+:\d$|^phrase:[a-f0-9]{32}$|^sample:[a-f0-9]{32}$/.test(r.key);
    if(/^glyph:\d+:\d$/.test(r.key)){const n=Number(r.key.split(':')[1]);return n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)&&validSample(r.value)}
    if(r.key.startsWith('phrase:')){const v=r.value;return /^[a-f0-9]{32}$/.test(v.id)&&r.key==='phrase:'+v.id&&typeof v.label==='string'&&v.label.length>1&&v.label.length<=80&&!/[\r\n]/.test(v.label)&&validPaths(v.ss)}
    if(r.key==='settings')return settingsValid(r.value);
    if(r.key==='text')return typeof r.value==='string'&&r.value.length<=15000;
    if(r.key==='seed')return Number.isSafeInteger(r.value)&&r.value>=0;
    if(r.key==='model'||r.key==='modelDigest')return true; // Recomputed from validated source samples, never executed/trusted.
    if(r.key.startsWith('sample:')){const v=r.value;return /^[a-f0-9]{32}$/.test(v.id)&&r.key==='sample:'+v.id&&typeof v.name==='string'&&v.name.length<=200&&Number.isFinite(v.size)&&v.size>=0&&v.size<=20*1024*1024&&(!v.analyses||Object.values(v.analyses).every(a=>a&&['inkRatio','slant','lineBands','meanBandHeight','width','height'].every(k=>Number.isFinite(a[k]))&&a.inkRatio>=0&&a.inkRatio<=1&&Math.abs(a.slant)<=2))}
    return false;
  }
  byId('backupImport').onchange=()=>guard(async()=>{
    const file=byId('backupImport').files[0];if(!file)return;if(file.size>145*1024*1024)throw Error('Backup ist zu groß (maximal 145 MB).');const data=JSON.parse(await file.text());
    let records;if(data.format==='handschrift-studio'&&data.version===3){records=data.records;if(!Array.isArray(records)||records.length>3000||records.some(r=>!validateRecord(r)))throw Error('Das Backup enthält ungültige Daten. Nichts wurde importiert.');}
    else if(data.glyphs&&(data.version===2||data.version===1)){const migrated=migrateData(data,data.version===1);records=[];for(const [c,ss]of Object.entries(migrated))ss.forEach((s,i)=>{if(s)records.push({key:'glyph:'+c.codePointAt(0)+':'+i,value:s})});if(typeof data.text==='string')records.push({key:'text',value:data.text.slice(0,15000)});}else throw Error('Kein unterstütztes Handschrift-Backup.');
    const files=data.files||[];if(!Array.isArray(files)||files.length>100)throw Error('Zu viele Dateien im Backup.');const decoded=[];let total=0;
    for(const f of files){if(!/^[a-f0-9]{32}$/.test(f.id)||typeof f.data!=='string'||f.data.length>28*1024*1024||!records.some(r=>r.key==='sample:'+f.id&&r.value))throw Error('Ungültige Probendatei.');const str=atob(f.data);total+=str.length;if(total>100*1024*1024)throw Error('Proben überschreiten 100 MB.');decoded.push({id:f.id,blob:new Blob([Uint8Array.from(str,c=>c.charCodeAt(0))],{type:typeof f.type==='string'?f.type:'application/octet-stream'})})}
    // Snapshot before any write, so recovery remains possible without downloading it.
    await store.putDB('workspaces','before-import-'+Date.now(),store.events);
    for(const f of decoded)await store.putFile(f.id,f.blob);
    for(const r of records)if(r.key!=='model'&&r.key!=='modelDigest')store.set(r.key,r.value);
    store.set('model',null);store.set('modelDigest',null);await store.queue;hydrate();if(Object.keys(glyphs).length||phrases.length)await train();byId('backupImport').value='';status('Backup geladen. Enthaltene Varianten ersetzen dieselben Plätze; andere Proben bleiben erhalten. Modell aus den Strichen neu gelernt.');
  });
  async function guard(fn){try{await fn()}catch(e){tell(e.message,true);status(e.message,true)}}
  function connection(){byId('connectionStatus').textContent=navigator.onLine?'Lokal gespeichert · kein Cloudkonto':'Offline · lokale Speicherung'}window.addEventListener('online',connection);window.addEventListener('offline',connection);
  try{
    await store.open();if(!store.events.length){for(const [char,samples]of Object.entries(glyphs))samples.forEach((ss,i)=>{if(ss)store.set('glyph:'+char.codePointAt(0)+':'+i,ss)});store.set('text',$('text').value);store.set('settings',settings());await store.queue}
    ready=true;hydrate();drawTraining();connection();status('Auf diesem Gerät gespeichert. Regelmäßig ein Backup sichern.');
    // Never automatically overwrite another tab's active drawing.
    if('BroadcastChannel' in window){const channel=new BroadcastChannel('handschrift-studio-v3');channel.onmessage=()=>status('Eine andere Registerkarte hat Daten geändert. Bitte diese Seite neu laden, bevor du weiterzeichnest.');store.broadcast=()=>channel.postMessage('changed')}
    window.addEventListener('pagehide',()=>persist());
    if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol))navigator.serviceWorker.register('./sw.js').then(async reg=>{await navigator.serviceWorker.ready;const update=()=>{if(reg.waiting)status('Neue Website-Version bereit. Bitte alle geöffneten Studio-Tabs schließen und neu öffnen.');};reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',update));update();}).catch(()=>status('Lokale Daten gespeichert. Offline-Start konnte hier nicht eingerichtet werden.'));
  }catch(e){ready=false;persist=originalPersist;layout=originalLayout;available=originalAvailable;missingChars=originalMissing;incompleteChars=originalIncomplete;for(const id of ['trainingSave','trainModel','referenceFiles','backupExport','backupImport'])byId(id).disabled=true;status('Erweiterte Speicherung nicht verfügbar: '+e.message+' Die ursprüngliche Zeichenfunktion bleibt nutzbar.',true)}
  finally{document.querySelector('main').classList.remove('studio-boot')}
  window.HandStudio={store,train,settings,validateRecord,hydrate,get model(){return learned}};
})();
