import { createFFmpeg, fetchFile } from "https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js";

const el = sel => document.querySelector(sel);
const player = el('#player');
const fileInput = el('#fileInput');
const analyzeBtn = el('#analyzeBtn');
const analysisStatus = el('#analysisStatus');
const analysisResults = el('#analysisResults');
const clipsEl = el('#clips');
const exportAllBtn = el('#exportAllBtn');

let videoFile = null;
let suggestions = [];
let ffmpeg;

function fmt(s){ return Number(s).toFixed(2); }

// Handle file selection
function setVideo(file){
  videoFile = file;
  const url = URL.createObjectURL(file);
  player.src = url;
  player.classList.remove('hidden');
  el('#videoMeta').textContent = `${file.name} — ${(file.size/1e6).toFixed(1)} MB`;
  analyzeBtn.disabled = false;
  analysisStatus.textContent = '';
  analysisResults.innerHTML = '';
  clipsEl.innerHTML = '';
  exportAllBtn.disabled = true;
}
fileInput.addEventListener('change', e => setVideo(e.target.files[0]));
// Drag & drop
const dropzone = document.querySelector('.dropzone');
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('ring'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('ring'));
dropzone.addEventListener('drop', e => {
  e.preventDefault(); dropzone.classList.remove('ring');
  const f = e.dataTransfer.files[0]; if (f) setVideo(f);
});

// Analysis: scene cuts + silence/energy peaks
async function analyze(){
  if(!videoFile) return;
  analysisStatus.textContent = 'Decoding audio & sampling frames…';
  suggestions = [];
  const duration = await getVideoDuration(player);
  // Audio energy via WebAudio
  const audioE = await computeAudioEnergy(videoFile);
  // Scene cuts via frame sampling
  const cuts = await detectSceneCuts(player, 2.0); // sample every 2s
  // Propose clips around loudness peaks that are near scene cuts
  const peaks = findEnergyPeaks(audioE, 10); // top 10 peaks
  const near = (a,b,thr)=>Math.abs(a-b)<=thr;
  const merged = [];
  for(const p of peaks){
    // find nearest cut to start/end
    const nearCut = cuts.find(c=>near(c,p,3)) ?? p;
    const start = Math.max(0, nearCut - 6);
    const end = Math.min(duration, nearCut + 12);
    merged.push({start, end, score:p.value??p, reason:'energy+cut'});
  }
  // Deduplicate overlaps
  merged.sort((a,b)=>a.start-b.start);
  const dedup = [];
  for(const m of merged){
    const last = dedup[dedup.length-1];
    if(!last || m.start > last.end - 2){ dedup.push(m); }
    else { last.end = Math.max(last.end, m.end); }
  }
  suggestions = dedup.slice(0,8);
  renderSuggestions();
  analysisStatus.textContent = `Found ${suggestions.length} clip candidates.`;
  exportAllBtn.disabled = suggestions.length===0;
}

analyzeBtn.addEventListener('click', analyze);

function renderSuggestions(){
  clipsEl.innerHTML = '';
  const tpl = document.getElementById('clipTpl');
  suggestions.forEach((sug, i)=>{
    const node = tpl.content.cloneNode(true);
    node.querySelector('[data-role=idx]').textContent = String(i+1).padStart(2,'0');
    const startEl = node.querySelector('[data-role=start]');
    const endEl = node.querySelector('[data-role=end]');
    const titleEl = node.querySelector('[data-role=title]');
    startEl.value = fmt(sug.start); endEl.value = fmt(sug.end);
    node.querySelector('[data-role=seekStart]').onclick = ()=>{ player.currentTime = Number(startEl.value); player.play(); };
    node.querySelector('[data-role=seekEnd]').onclick = ()=>{ player.currentTime = Math.max(0, Number(endEl.value)-2); player.play(); };
    const statusEl = node.querySelector('[data-role=status]');
    const exportBtn = node.querySelector('[data-role=export]');
    const downloadA = node.querySelector('[data-role=download]');
    exportBtn.onclick = async ()=>{
      try{
        exportBtn.disabled = true; statusEl.textContent = 'Exporting with ffmpeg.wasm… (first time may take a bit)';
        const blob = await cutClip(videoFile, Number(startEl.value), Number(endEl.value));
        const url = URL.createObjectURL(blob);
        downloadA.href = url;
        const safeTitle = (titleEl.value || `clip_${String(i+1).padStart(2,'0')}`).replace(/[^a-z0-9_-]+/gi,'_');
        downloadA.download = safeTitle + '.mp4';
        downloadA.classList.remove('hidden');
        statusEl.textContent = 'Done.';
      }catch(err){
        console.error(err);
        statusEl.textContent = 'Failed: ' + err.message;
      }finally{
        exportBtn.disabled = false;
      }
    };
    clipsEl.appendChild(node);
  });
}

exportAllBtn.addEventListener('click', async ()=>{
  const rows = [...document.querySelectorAll('.clip')];
  el('#exportStatus').textContent = 'Batch exporting…';
  for(let i=0;i<rows.length;i++){
    const row = rows[i];
    const start = Number(row.querySelector('[data-role=start]').value);
    const end = Number(row.querySelector('[data-role=end]').value);
    const title = row.querySelector('[data-role=title]').value || `clip_${String(i+1).padStart(2,'0')}`;
    const statusEl = row.querySelector('[data-role=status]');
    const downloadA = row.querySelector('[data-role=download]');
    try{
      statusEl.textContent = 'Exporting…';
      const blob = await cutClip(videoFile, start, end);
      const url = URL.createObjectURL(blob);
      downloadA.href = url;
      downloadA.download = title.replace(/[^a-z0-9_-]+/gi,'_') + '.mp4';
      downloadA.classList.remove('hidden');
      statusEl.textContent = 'Done.';
    }catch(e){ statusEl.textContent = 'Failed: ' + e.message; }
  }
  el('#exportStatus').textContent = 'Batch export finished.';
});

function getVideoDuration(video){
  return new Promise(res=>{
    if(!isFinite(video.duration) || video.duration === 0){
      video.addEventListener('loadedmetadata', ()=>res(video.duration), {once:true});
      video.load();
    } else res(video.duration);
  });
}

async function computeAudioEnergy(file){
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await file.arrayBuffer();
  const audio = await ctx.decodeAudioData(buf);
  const data = audio.getChannelData(0);
  const sampleRate = audio.sampleRate;
  const windowSec = 0.2;
  const hop = Math.floor(sampleRate * windowSec);
  const rms = [];
  for(let i=0;i<data.length;i+=hop){
    let sum=0, n=0;
    for(let j=i;j<Math.min(i+hop,data.length);j++){ const v=data[j]; sum+=v*v; n++; }
    const r = Math.sqrt(sum/Math.max(1,n));
    rms.push(r);
  }
  // normalize
  const max = Math.max(...rms);
  const norm = rms.map(v=>v/(max||1));
  return { values: norm, hopSec: windowSec };
}

async function detectSceneCuts(video, stepSec=2){
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  await new Promise(r=>{ if(video.readyState>=2) r(); else video.addEventListener('loadeddata', r, {once:true}); });
  canvas.width = 160; canvas.height = 90;
  const diffs = [];
  for(let t=0; t<video.duration; t+=stepSec){
    video.currentTime = t;
    await waitEvent(video,'seeked');
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    const img = ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const hist = new Array(16).fill(0);
    for(let i=0;i<img.length;i+=4){
      const y = Math.round((0.2126*img[i] + 0.7152*img[i+1] + 0.0722*img[i+2]) / 16);
      hist[y]++;
    }
    diffs.push({t, hist});
  }
  const cuts = [];
  for(let i=1;i<diffs.length;i++){
    let d=0;
    for(let b=0;b<16;b++){ d += Math.abs(diffs[i].hist[b]-diffs[i-1].hist[b]); }
    const norm = d/(160*90);
    if(norm>0.12) cuts.push(diffs[i].t);
  }
  return cuts;
}
function waitEvent(el, ev){ return new Promise(r=>el.addEventListener(ev, r, {once:true})); }

function findEnergyPeaks(energy, count=10){
  // simple peak picking
  const v = energy.values;
  const peaks = [];
  for(let i=1;i<v.length-1;i++){
    if(v[i]>0.35 && v[i]>v[i-1] && v[i]>v[i+1]){
      peaks.append??peaks.push;
      peaks.push({pos:i*energy.hopSec, value:v[i]});
    }
  }
  peaks.sort((a,b)=>b.value-a.value);
  return peaks.slice(0,count).map(p=>p.pos);
}

// ffmpeg.wasm clipper
async function ensureFFmpeg(){
  if(ffmpeg) return ffmpeg;
  ffmpeg = createFFmpeg({ log: true, corePath: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js" });
  await ffmpeg.load();
  return ffmpeg;
}
async function cutClip(file, start, end){
  await ensureFFmpeg();
  const data = await fetchFile(file);
  const inputName = 'input.mp4';
  const outputName = 'out.mp4';
  ffmpeg.FS('writeFile', inputName, data);
  const ss = Math.max(0, start);
  const to = Math.max(0, end - start);
  await ffmpeg.run(
    '-ss', String(ss),
    '-i', inputName,
    '-t', String(to),
    '-c:v', 'copy',
    '-c:a', 'copy',
    outputName
  );
  const out = ffmpeg.FS('readFile', outputName);
  ffmpeg.FS('unlink', inputName);
  ffmpeg.FS('unlink', outputName);
  return new Blob([out.buffer], {type: 'video/mp4'});
}

// PWA install prompt
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('installBtn');
  btn.classList.remove('hidden');
  btn.onclick = async ()=>{
    deferredPrompt.prompt();
    deferredPrompt = null;
    btn.classList.add('hidden');
  };
});
