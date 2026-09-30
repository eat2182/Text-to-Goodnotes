(function(root){
  'use strict';
  if(!Promise.withResolvers)Promise.withResolvers=function(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
  async function imageCanvas(blob){
    const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await new Promise((a,b)=>{img.onload=a;img.onerror=()=>b(Error('Bild konnte nicht gelesen werden. Bitte PNG oder JPEG verwenden.'))});
      const scale=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(img,0,0,canvas.width,canvas.height);return canvas;
    }finally{URL.revokeObjectURL(url)}
  }
  async function goodnotesThumbnail(file){
    const raw=new Uint8Array(await file.arrayBuffer()),v=new DataView(raw.buffer);let end=-1;
    for(let i=raw.length-22;i>=Math.max(0,raw.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break}
    if(end<0)throw Error('Die Goodnotes-Datei ist kein unterstütztes ZIP-Archiv.');
    const count=v.getUint16(end+10,true);let pos=v.getUint32(end+16,true);if(count>20000)throw Error('Archiv enthält zu viele Einträge.');
    for(let i=0;i<count;i++){
      if(pos+46>raw.length||v.getUint32(pos,true)!==0x02014b50)throw Error('Beschädigtes ZIP-Verzeichnis.');
      const method=v.getUint16(pos+10,true),size=v.getUint32(pos+20,true),unpacked=v.getUint32(pos+24,true),nl=v.getUint16(pos+28,true),el=v.getUint16(pos+30,true),cl=v.getUint16(pos+32,true),offset=v.getUint32(pos+42,true),name=new TextDecoder().decode(raw.subarray(pos+46,pos+46+nl));
      pos+=46+nl+el+cl;
      if(!/(^|\/)thumbnail\.(jpg|jpeg|png)$/i.test(name))continue;
      if(unpacked>8*1024*1024||offset+30>raw.length||v.getUint32(offset,true)!==0x04034b50)throw Error('Vorschaubild ist zu groß oder beschädigt.');
      const start=offset+30+v.getUint16(offset+26,true)+v.getUint16(offset+28,true);if(start+size>raw.length)throw Error('Unvollständiges Archiv.');
      const compressed=new Blob([raw.subarray(start,start+size)]);let out;
      if(method===0)out=compressed;else if(method===8){let stream;try{stream=compressed.stream().pipeThrough(new DecompressionStream('deflate-raw'))}catch{throw Error('Dieser Browser kann dieses Archiv nicht entpacken. Bitte die Seite als Bild oder PDF exportieren.')}
        const reader=stream.getReader(),chunks=[];let bytes=0;while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>8*1024*1024){await reader.cancel();throw Error('Vorschaubild überschreitet das Größenlimit.')}chunks.push(value)}out=new Blob(chunks);
      }else throw Error('Nicht unterstützte ZIP-Kompression. Bitte Bild oder PDF verwenden.');
      return imageCanvas(new Blob([out],{type:/png$/i.test(name)?'image/png':'image/jpeg'}));
    }throw Error('Keine eingebettete Seitenvorschau gefunden. Bitte aus Goodnotes als PDF oder Bild exportieren.');
  }
  let pdfLibrary;
  async function render(file,page=1){
    if(file.size>20*1024*1024)throw Error('Bitte Dateien unter 20 MB verwenden.');
    if(/\.goodnotes$/i.test(file.name||''))return {canvas:await goodnotesThumbnail(file),pages:1,source:'Goodnotes-Vorschaubild (nur die enthaltene Vorschau)'};
    if(file.type==='application/pdf'||/\.pdf$/i.test(file.name||'')){
      if(location.protocol==='file:')throw Error('PDF-Analyse bitte über deine GitHub-Website öffnen; lokale Moduldateien sind hier gesperrt.');
      pdfLibrary??=import('./vendor/pdf.min.mjs');const pdf=await pdfLibrary;pdf.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',document.baseURI).href;
      const task=pdf.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true,disableFontFace:true});
      task.onPassword=()=>task.destroy();let doc;
      try{doc=await task.promise;if(!Number.isInteger(page)||page<1||page>doc.numPages)throw Error('Bitte eine Seite zwischen 1 und '+doc.numPages+' wählen.');const p=await doc.getPage(page),original=p.getViewport({scale:1}),vp=p.getViewport({scale:Math.min(2,1400/Math.max(original.width,original.height))}),canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);await p.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;return {canvas,pages:doc.numPages,source:'PDF-Seite '+page};}finally{if(doc)await doc.destroy();else await task.destroy()}
    }
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)&&!(/\.(png|jpe?g|webp)$/i.test(file.name||'')))throw Error('Bitte PNG, JPEG, WebP, PDF oder .goodnotes verwenden.');
    return {canvas:await imageCanvas(file),pages:1,source:'Bild'};
  }
  root.HandReferences={render,goodnotesThumbnail};
})(globalThis);
