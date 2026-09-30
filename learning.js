/* Local statistical stroke model. No remote inference and no invented pen order. */
(function(root){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x)), clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
  function box(ss){const b={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity};for(const s of ss)for(const p of s){b.left=Math.min(b.left,p[0]);b.right=Math.max(b.right,p[0]);b.top=Math.min(b.top,p[1]);b.bottom=Math.max(b.bottom,p[1])}return b}
  function resample(path,n=32){
    const lengths=[0];for(let i=1;i<path.length;i++)lengths.push(lengths.at(-1)+Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]));
    const total=lengths.at(-1);if(!total)return Array.from({length:n},()=>[...path[0]]);
    let j=1;return Array.from({length:n},(_,i)=>{const d=total*i/(n-1);while(j<lengths.length-1&&lengths[j]<d)j++;const t=(d-lengths[j-1])/(lengths[j]-lengths[j-1]||1);return [0,1].map(k=>path[j-1][k]+t*(path[j][k]-path[j-1][k]))});
  }
  function rng(seed){let h=2166136261;for(const c of String(seed))h=Math.imul(h^c.charCodeAt(0),16777619);return()=>{h+=0x6D2B79F5;let t=h;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296}}
  function train(glyphs,phrases=[],images=[]){
    const groups=Object.create(null),widths=[],heights=[],bottoms=[],slants=[];let examples=0,learnable=0;
    for(const [label,samples] of Object.entries(glyphs)){
      const buckets={};for(const ss of samples.filter(Boolean)){
        examples++;const b=box(ss);widths.push(b.right-b.left);heights.push(b.bottom-b.top);bottoms.push(b.bottom);
        let sx=0,sy=0,weight=0;for(const s of ss)for(let i=1;i<s.length;i++){const dx=s[i][0]-s[i-1][0],dy=s[i][1]-s[i-1][1];if(Math.abs(dy)>Math.abs(dx)*1.5){sx+=dx*Math.sign(dy);sy+=Math.abs(dy);weight++}}if(weight)slants.push(-sx/(sy||1));
        // Only interpolate examples with compatible stroke counts and directions.
        const signature=ss.map(s=>{const a=s[0],z=s.at(-1),dx=z[0]-a[0],dy=z[1]-a[1];return s.length===1?'dot':Math.round(Math.atan2(dy,dx)*2/Math.PI)}).join(',');
        const vector=ss.flatMap(s=>resample(s).flatMap(p=>[p[0]-b.left,p[1]]));(buckets[signature]??=[]).push(vector);
      }
      groups[label]=Object.entries(buckets).map(([signature,vs])=>{
        if(vs.length>=2)learnable++;
        const mu=vs[0].map((_,i)=>mean(vs.map(v=>v[i])));
        // Low-rank empirical covariance: centered observations are its factor.
        const residuals=vs.map(v=>v.map((x,i)=>x-mu[i]));
        return {signature,n:vs.length,mean:mu,residuals,strokes:vs[0].length/64};
      });
    }
    const variance=a=>Math.sqrt(mean(a.map(x=>(x-mean(a))**2)));
    return {version:1,algorithm:'empirical-covariance-strokes',createdAt:new Date().toISOString(),groups,
      profile:{examples,learnable,characters:Object.keys(groups).length,phrases:phrases.length,meanWidth:mean(widths),meanHeight:mean(heights),slant:mean(slants),baselineVariation:variance(bottoms),sizeVariation:mean(heights)?variance(heights)/mean(heights):0,imageSamples:images.length,imageInkRatio:mean(images.map(i=>i.inkRatio||0)),imageSlant:mean(images.map(i=>i.slant||0)),imageLetterGap:mean(images.map(i=>i.letterGapRatio||0)),imageWordGap:mean(images.map(i=>i.wordGapRatio||0))}};
  }
  function generate(ss,label,model,settings,seed){
    const r=rng(seed),amount=Number(settings.naturalness||0)/3,variation=Number(settings.stroke||0)/100*amount;
    let paths=clone(ss);const original=box(ss);
    const signature=ss.map(s=>s.length===1?'dot':Math.round(Math.atan2(s.at(-1)[1]-s[0][1],s.at(-1)[0]-s[0][0])*2/Math.PI)).join(',');
    const g=model?.groups?.[label]?.find(g=>g.signature===signature&&g.n>=2);
    if(g&&variation){
      // Conditional bounded blend with a sample from the learned covariance.
      const weights=g.residuals.map(()=>((r()+r()+r())-1.5)/Math.sqrt(g.n-1));
      const base=ss.flatMap(s=>resample(s).flatMap(p=>[p[0]-original.left,p[1]]));
      const v=base.map((x,i)=>x+variation*.35*clamp(g.residuals.reduce((sum,d,j)=>sum+d[i]*weights[j],0),-14,14));
      paths=Array.from({length:g.strokes},(_,s)=>Array.from({length:32},(_,p)=>[v[s*64+p*2]+original.left,v[s*64+p*2+1]]));
    }
    const scale=1+(r()-.5)*.16*amount*Number(settings.scale||0)/100;
    const tilt=(r()-.5)*.24*amount*Number(settings.slant||0)/100;
    const baseline=(r()-.5)*12*amount*Number(settings.baseline||0)/100;
    return paths.map(s=>s.map(([x,y])=>[original.left+(x-original.left)*scale+(175-y)*tilt,175+(y-175)*scale+baseline]));
  }
  function tokenize(word,phrases,strength,seed){
    const labels=[...new Set(phrases.filter(p=>p.label&&!/\s/.test(p.label)).map(p=>p.label))].sort((a,b)=>b.length-a.length),out=[],r=rng(seed);
    for(let at=0;at<word.length;){const match=labels.find(s=>word.startsWith(s,at));if(match&&r()<strength){out.push(match);at+=match.length}else{const c=String.fromCodePoint(word.codePointAt(at));out.push(c);at+=c.length}}return out;
  }
  // A photo supplies style measurements, not imaginary stroke order or OCR.
  function analyzePixels(data,w,h){
    const mask=new Uint8Array(w*h),hist=new Uint32Array(256);let n=0;
    for(let i=0;i<w*h;i++){const k=i*4,lum=Math.round((data[k]*.299+data[k+1]*.587+data[k+2]*.114)*(data[k+3]/255)+255*(1-data[k+3]/255));mask[i]=lum;hist[lum]++}
    let total=0;for(let i=0;i<256;i++)total+=i*hist[i];let a=0,b=0,best=0,threshold=130;
    for(let i=0;i<255;i++){a+=hist[i];if(!a||a===w*h)continue;b+=i*hist[i];const v=a*(w*h-a)*(b/a-(total-b)/(w*h-a))**2;if(v>best){best=v;threshold=i}}
    const rows=new Array(h).fill(0);for(let i=0;i<mask.length;i++){mask[i]=mask[i]<=Math.min(210,threshold)?1:0;n+=mask[i];rows[Math.floor(i/w)]+=mask[i]}
    let bestShift=0,score=0;for(const shift of [0,-1,1,-2,2,-3,3,-4,4,-5,5]){let s=0;for(let y=4;y<h-4;y+=2)for(let x=6;x<w-6;x+=2)s+=mask[y*w+x]*mask[(y+4)*w+x+shift];if(s>score){score=s;bestShift=shift}}
    const bands=[],ranges=[];let start=-1;for(let y=0;y<h;y++){if(rows[y]>w*.01&&start<0)start=y;if((rows[y]<=w*.01||y===h-1)&&start>=0){if(y-start>2){bands.push(y-start);ranges.push([start,y])}start=-1}}
    const gaps=[];for(const [top,bottom]of ranges){let last=-1;for(let x=0;x<w;x++){let ink=0;for(let y=top;y<bottom;y++)ink+=mask[y*w+x];if(ink){if(last>=0&&x-last>1)gaps.push((x-last-1)/(bottom-top));last=x}}}
    const small=gaps.filter(g=>g<.35&&g>.01),large=gaps.filter(g=>g>=.35&&g<2);
    return {inkRatio:n/(w*h),slant:-bestShift/4,lineBands:bands.length,meanBandHeight:mean(bands),letterGapRatio:mean(small),wordGapRatio:mean(large),width:w,height:h,method:'threshold-projection',quality:n/(w*h)>.3?'Foto enthält viel Hintergrund; bitte zuschneiden.':'Grobe Bildmessung; keine Texterkennung.'};
  }
  root.HandLearning={train,generate,tokenize,analyzePixels,resample,box,rng};
  if(typeof module!=='undefined')module.exports=root.HandLearning;
})(globalThis);
