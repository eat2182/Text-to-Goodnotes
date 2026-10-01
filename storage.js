(function(root){
  'use strict';
  const uid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const copy=x=>JSON.parse(JSON.stringify(x));
  const compare=(a,b)=>a.clock-b.clock||a.device.localeCompare(b.device)||a.id.localeCompare(b.id);
  function compact(events){const grouped=new Map();for(const e of [...events].sort(compare)){const a=grouped.get(e.key)||[];a.push(e);if(a.length>2)a.shift();grouped.set(e.key,a)}return [...grouped.values()].flat()}
  function project(events){const map=new Map();for(const e of [...events].sort(compare))map.set(e.key,e);return map}
  function validEvent(e){return e&&/^[a-f0-9]{32}$/.test(e.id)&&typeof e.key==='string'&&e.key.length<240&&Number.isSafeInteger(e.clock)&&e.clock>=0&&typeof e.device==='string'&&e.device.length<=64&&('value' in e)}
  class Store{
    constructor(){this.events=[];this.records=new Map();this.scope='local';this.device=uid();this.db=null;this.queue=Promise.resolve();this.saving=false;this.dirty=false;this.onStatus=()=>{};this.onChange=()=>{}}
    async open(){
      if(!root.indexedDB)throw Error('Dieser Browser bietet keine lokale Datenbank. Bitte einen aktuellen Browser verwenden.');
      this.db=await new Promise((resolve,reject)=>{let finished=false;const fail=error=>{if(finished)return;finished=true;clearTimeout(timer);reject(error)},timer=setTimeout(()=>fail(Error('Die lokale Datenbank antwortet nicht. Andere Studio-Tabs schließen und die Seite erneut öffnen.')),12000);const r=indexedDB.open('handschrift-studio-v3',1);r.onupgradeneeded=()=>{r.result.createObjectStore('workspaces');r.result.createObjectStore('files')};r.onsuccess=()=>{if(finished){r.result.close();return}finished=true;clearTimeout(timer);r.result.onversionchange=()=>r.result.close();resolve(r.result)};r.onerror=()=>fail(r.error);r.onblocked=()=>fail(Error('Die lokale Datenbank ist durch einen anderen Tab blockiert. Bitte andere Studio-Tabs schließen.'))});
      const device=await this.getDB('workspaces','device');if(device)this.device=device;else await this.putDB('workspaces','device',this.device);
      await this.switchScope('local');return this;
    }
    getDB(store,key){return new Promise((resolve,reject)=>{const tx=this.db.transaction(store),r=tx.objectStore(store).get(key),timer=setTimeout(()=>{try{tx.abort()}catch{}reject(Error('Lesen der lokalen Daten dauert zu lange. Bitte andere Studio-Tabs schließen und neu laden.'))},12000);r.onsuccess=()=>{clearTimeout(timer);resolve(r.result)};r.onerror=()=>{clearTimeout(timer);reject(r.error)};tx.onabort=()=>{clearTimeout(timer);reject(tx.error||Error('Lesen abgebrochen'))}})}
    putDB(store,key,value){return new Promise((resolve,reject)=>{const t=this.db.transaction(store,'readwrite');t.objectStore(store).put(value,key);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('Speicherung abgebrochen'))})}
    async switchScope(scope){await this.queue;this.scope=scope;this.events=(await this.getDB('workspaces',scope))||[];this.records=project(this.events);this.onChange()}
    get(key,fallback=null){return this.records.get(key)?.value??fallback}
    values(prefix){return [...this.records.values()].filter(e=>e.key.startsWith(prefix)&&e.value!==null).map(e=>e.value)}
    save(){
      this.dirty=true;if(this.saving)return this.queue;this.saving=true;const scope=this.scope;
      // Batch synchronous mutations. At most one snapshot/transaction is in flight.
      // Events are immutable, so a shallow array snapshot is sufficient.
      this.queue=Promise.resolve().then(async()=>{while(this.dirty){this.dirty=false;const snapshot=this.events.slice();await new Promise((resolve,reject)=>{
        const tx=this.db.transaction('workspaces','readwrite'),os=tx.objectStore('workspaces'),request=os.get(scope);let merged;
        const timer=setTimeout(()=>{try{tx.abort()}catch{}reject(Error('Speicherung antwortet nicht. Bitte ein Backup sichern.'))},15000);
        request.onsuccess=()=>{try{const map=new Map((request.result||[]).map(e=>[e.id,e]));for(const e of snapshot)map.set(e.id,e);merged=compact([...map.values()]);os.put(merged,scope)}catch(e){clearTimeout(timer);try{tx.abort()}catch{}reject(e)}};
        tx.oncomplete=()=>{clearTimeout(timer);if(this.scope===scope){const map=new Map(merged.map(e=>[e.id,e]));for(const e of this.events)map.set(e.id,e);this.events=compact([...map.values()]);this.records=project(this.events)}resolve()};tx.onerror=()=>{clearTimeout(timer);reject(tx.error)};tx.onabort=()=>{clearTimeout(timer);reject(tx.error||Error('Speicherung abgebrochen'))};
      })}this.broadcast?.();this.onStatus('Auf diesem Gerät gespeichert.');}).catch(e=>{this.onStatus('Speichern fehlgeschlagen: '+e.message+'. Bitte sofort ein Backup exportieren.',true);throw e}).finally(()=>{this.saving=false});return this.queue;
    }
    set(key,value){if(JSON.stringify(this.get(key))===JSON.stringify(value))return false;const old=this.records.get(key),clock=Math.max(0,...this.events.map(e=>e.clock))+1;
      const e={id:uid(),device:this.device,clock,key,value:copy(value),parent:old?.id||null,createdAt:new Date().toISOString()};this.events.push(e);this.records.set(key,e);this.save().catch(()=>{});this.onChange();return true}
    async merge(events){if(events.some(e=>!validEvent(e)))throw Error('Ungültige Synchronisierungsdaten.');const ids=new Set(this.events.map(e=>e.id));for(const e of events)if(!ids.has(e.id)){this.events.push(copy(e));ids.add(e.id)}this.records=project(this.events);await this.save();this.onChange()}
    conflicts(){const families=new Map();for(const e of this.events){const key=e.key+'|'+(e.parent||'root');if(!families.has(key))families.set(key,[]);families.get(key).push(e)}return [...families.values()].filter(es=>new Set(es.map(e=>JSON.stringify(e.value))).size>1&&!this.get('resolved:'+es[0].key+':'+(es[0].parent||'root')))}
    async putFile(id,file){await this.putDB('files',this.scope+':'+id,file)}
    getFile(id){return this.getDB('files',this.scope+':'+id)}
    deleteFile(id){return new Promise((resolve,reject)=>{const tx=this.db.transaction('files','readwrite');tx.objectStore('files').delete(this.scope+':'+id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
    async backup(){await this.queue.catch(()=>{});const files=[];let total=0;for(const meta of this.values('sample:')){const file=await this.getFile(meta.id);if(!file)continue;total+=file.size;if(total>100*1024*1024)throw Error('Die Proben sind größer als 100 MB. Bitte einige Proben entfernen oder einzeln sichern.');const bytes=new Uint8Array(await file.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));files.push({id:meta.id,type:file.type,name:meta.name,data:btoa(s)})}
      return {format:'handschrift-studio',version:3,exportedAt:new Date().toISOString(),records:[...this.records.values()].map(e=>({key:e.key,value:e.value})),history:this.events,files};
    }
  }
  root.HandStorage={Store,uid,project,validEvent};if(typeof module!=='undefined')module.exports=root.HandStorage;
})(globalThis);
