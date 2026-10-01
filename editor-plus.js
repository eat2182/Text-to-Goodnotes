(function(){
'use strict';
const clone=value=>JSON.parse(JSON.stringify(value));
const store=new HandStorage.Store(), ids=['size','spacing','paper','ink'], defaults=Object.fromEntries(ids.map(id=>[id,$(id).value]));
let ready=false,applying=false,known={},knownValues={},drawing=false;
const status=(s)=>{$('localStatus').textContent=s};
const settings=()=>Object.fromEntries(ids.map(id=>[id,$(id).value]));
function validRecord(r){
 if(!r||typeof r.key!=='string')return false;
 if(/^glyph:\d+:\d$/.test(r.key)){const n=+r.key.split(':')[1];return n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)&&(r.value===null||validSample(r.value))}
 if(r.key==='text'||r.key==='title')return typeof r.value==='string'&&r.value.length<=(r.key==='text'?15000:100);
 if(r.key==='settings'){const v=r.value;return v&&+v.size>=14&&+v.size<=36&&+v.spacing>=1.5&&+v.spacing<=2.8&&['lined','grid','blank'].includes(v.paper)&&['#223d78','#24272c','#6e2b50'].includes(v.ink)}
 return r.key.startsWith('resolved:')&&r.key.length<240&&r.value===true;
}
function hydrate(){applying=true;glyphs=Object.create(null);for(const e of store.records.values())if(e.key.startsWith('glyph:')&&e.value&&validRecord(e)){const [,cp,i]=e.key.split(':');const c=String.fromCodePoint(+cp);glyphs[c]??=Array(10).fill(null);glyphs[c][+i]=clone(e.value)}
 $('text').value=store.get('text','');$('documentTitle').value=store.get('title','Meine Handschrift');const opts=store.get('settings',defaults);for(const id of ids)$(id).value=opts[id]??defaults[id];known=clone(glyphs);knownValues={text:$('text').value,title:$('documentTitle').value,settings:settings()};applying=false;choose(selected,slot);refreshAlphabet();render();
}
persist=function(){if(!ready||applying)return;for(const c of new Set([...Object.keys(known),...Object.keys(glyphs)]))for(let i=0;i<10;i++){const a=known[c]?.[i]||null,b=glyphs[c]?.[i]||null;if(JSON.stringify(a)!==JSON.stringify(b))store.set('glyph:'+c.codePointAt(0)+':'+i,b)}known=clone(glyphs);const next={text:$('text').value,title:$('documentTitle').value,settings:settings()};for(const [key,value]of Object.entries(next))if(JSON.stringify(knownValues[key])!==JSON.stringify(value))store.set(key,value);knownValues=clone(next)};
function lockDraw(){if(pointer!==null)end({pointerId:pointer,type:'pointercancel'});drawing=false;updateMode()}
function updateMode(){pad.parentElement.classList.toggle('active',drawing);$('drawMode').textContent=drawing?'Fertig':'Zeichnen';$('drawMode').setAttribute('aria-pressed',String(drawing));$('drawingState').textContent=drawing?'Zeichnen ist aktiv':'Scrollen ist aktiv'}
pad.addEventListener('pointerdown',e=>{if(!drawing)e.stopImmediatePropagation()},true);
$('drawMode').onclick=()=>{if(drawing)lockDraw();else{drawing=true;updateMode()}};
window.addEventListener('blur',lockDraw);document.addEventListener('visibilitychange',()=>{if(document.hidden)lockDraw()});
ids.forEach(id=>$(id).addEventListener('input',()=>persist()));$('documentTitle').addEventListener('input',()=>persist());
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
function pdf(kind){if(kind==='specimen')return StudioPDF.specimen(glyphs);if(!$('text').value.trim()||missingChars().length)throw Error('Bitte Text eingeben und fehlende Buchstaben zeichnen.');return StudioPDF.text({...layout($('text').value,+$('size').value,+$('spacing').value),paper:$('paper').value,color:$('ink').value})}
const filename=kind=>kind==='specimen'?'Meine-Schriftproben.pdf':($('documentTitle').value.trim()||'Meine-Handschrift').replace(/[^\p{L}\p{N} _-]/gu,'')+'.pdf';
function pdfButtons(){const textOK=!!$('text').value.trim()&&!missingChars().length,sampleOK=Object.values(glyphs).some(ss=>ss.some(Boolean));$('exportPdf').disabled=!textOK;$('specimenPdf').disabled=!sampleOK;let share=false;try{share=!!navigator.canShare?.({files:[new File(['%PDF-1.7'],'Handschrift.pdf',{type:'application/pdf'})]})}catch{}$('sharePdf').disabled=!share||!($('pdfKind').value==='text'?textOK:sampleOK);$('sharePdf').title=share?'PDF über das Teilen-Menü weitergeben':'Dieser Browser unterstützt das Teilen von PDF-Dateien nicht. Bitte PDF herunterladen.'}
const baseRender=render;render=function(){const r=baseRender();pdfButtons();return r};$('pdfKind').onchange=pdfButtons;
for(const [id,kind]of [['exportPdf','text'],['specimenPdf','specimen']])$(id).onclick=()=>{try{download(pdf(kind),filename(kind));$('exportStatus').textContent='PDF erstellt.'}catch(e){$('exportStatus').textContent=e.message}};
$('sharePdf').onclick=()=>{try{const kind=$('pdfKind').value,file=new File([pdf(kind)],filename(kind),{type:'application/pdf'});navigator.share({files:[file],title:'Meine Handschrift'}).then(()=>{$('exportStatus').textContent='PDF an das Teilen-Menü übergeben.'}).catch(e=>{$('exportStatus').textContent=e.name==='AbortError'?'Teilen abgebrochen.':e.message})}catch(e){$('exportStatus').textContent=e.message}};
$('backupExport').onclick=async()=>{try{persist();download(new Blob([JSON.stringify(await store.backup())],{type:'application/json'}),'Handschrift-Backup.json');status('Backup erstellt.')}catch(e){status(e.message)}};
$('backupImport').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>145*1024*1024)throw Error('Backup zu groß (maximal 145 MB).');const data=JSON.parse(await file.text());let records;if(data.version===3&&data.format==='handschrift-studio'&&Array.isArray(data.records)){records=data.records.filter(validRecord)}else if(data.glyphs&&(data.version===1||data.version===2)){records=[];for(const [c,ss]of Object.entries(migrateData(data,data.version===1)))ss.forEach((value,i)=>{if(value)records.push({key:'glyph:'+c.codePointAt(0)+':'+i,value})});if(typeof data.text==='string')records.push({key:'text',value:data.text.slice(0,15000)})}else throw Error('Unbekanntes Backup-Format.');if(!records.length)throw Error('Keine verwendbaren Handschrift-Daten im Backup.');lockDraw();for(const r of records)store.set(r.key,r.value);await store.queue;hydrate();status('Handschrift geladen. Alte KI-Referenzdateien werden nicht importiert.')}catch(err){status('Import fehlgeschlagen: '+err.message)}finally{e.target.value=''}};
store.onStatus=status;
const app=window.StudioApp={store,hydrate,persist:()=>persist(),validRecord,lockDraw,isDrawing:()=>pointer!==null};
document.querySelector('main').classList.add('loading');
app.ready=(async()=>{try{await store.open();if(!store.events.length){for(const[c,ss]of Object.entries(glyphs))ss.forEach((value,i)=>{if(value)store.set('glyph:'+c.codePointAt(0)+':'+i,value)});store.set('text',$('text').value);store.set('settings',settings());await store.queue}ready=true;hydrate();status('Auf diesem Gerät gespeichert.');return true}catch(e){status('Lokaler Speicher nicht verfügbar: '+e.message);$('backupImport').disabled=true;return false}finally{document.querySelector('main').classList.remove('loading');updateMode();pdfButtons()}})();
})();
