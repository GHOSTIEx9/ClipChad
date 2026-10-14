/* ClipChad — browser video editor with 4K export */
(() => {
"use strict";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (t) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), s = Math.floor(t % 60), d = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
};
function toast(msg, ms = 2600) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ================= STATE ================= */
const S = {
  media: [],            // {id,kind:'video'|'image'|'audio',name,url,duration,w,h}
  clips: [],            // {id,track:'video'|'overlay'|'audio',kind,mediaId,name,start,duration,offset,vol,speed,fadeIn,fadeOut,scale,op,x,y,rot,flip,fit,bri,con,sat,blur,filter,text,font,color,anim,speak}
  captions: [],         // {id,start,end,text}
  currentTime: 0,
  playing: false,
  selected: null,
  aspect: "16:9",
  bg: "#000000",
  brand: { color: "#22d3ee", name: "CHAD TV", logoId: null },
};
let pxPerSec = 80;
let undoStack = [], redoStack = [];
function snap() { return JSON.stringify({ clips: S.clips, captions: S.captions, bg: S.bg, aspect: S.aspect }); }
function pushUndo() { undoStack.push(snap()); if (undoStack.length > 80) undoStack.shift(); redoStack = []; }
function restore(j) { const o = JSON.parse(j); S.clips = o.clips; S.captions = o.captions; S.bg = o.bg; S.aspect = o.aspect; S.selected = null; S.playing = false; pauseAll(); renderAll(); }
function undo() { if (!undoStack.length) return toast("Nothing to undo"); redoStack.push(snap()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return toast("Nothing to redo"); undoStack.push(snap()); restore(redoStack.pop()); }

const trackOf = (id) => S.clips.filter((c) => c.track === id).sort((a, b) => a.start - b.start);
const getClip = (id) => S.clips.find((c) => c.id === id);
const getMedia = (id) => S.media.find((m) => m.id === id);
function projectDuration() {
  let d = 8;
  for (const c of S.clips) d = Math.max(d, c.start + c.duration);
  for (const c of S.captions) d = Math.max(d, c.end);
  return d;
}
function trackEnd(track) { let e = 0; for (const c of S.clips.filter((x) => x.track === track)) e = Math.max(e, c.start + c.duration); return e; }

/* ================= MEDIA ELEMENTS CACHE ================= */
const elCache = new Map(); // mediaId -> element
function mediaEl(m) {
  if (!m) return null;
  if (elCache.has(m.id)) return elCache.get(m.id);
  let el = null;
  if (m.kind === "video") { el = document.createElement("video"); el.src = m.url; el.preload = "auto"; el.crossOrigin = "anonymous"; el.playsInline = true; }
  else if (m.kind === "audio") { el = document.createElement("audio"); el.src = m.url; el.preload = "auto"; el.crossOrigin = "anonymous"; }
  else if (m.kind === "image") { el = new Image(); el.src = m.url; }
  if (el) elCache.set(m.id, el);
  return el;
}

/* ================= IMPORT ================= */
const VID_EXT = ["mp4", "m4v", "webm", "mov", "mkv", "mka", "avi", "flv", "wmv", "mpg", "mpeg", "mpe", "m2ts", "mts", "3gp", "3g2", "ogv", "mxf", "divx", "f4v", "vob", "qt"];
const AUD_EXT = ["mp3", "wav", "ogg", "oga", "opus", "m4a", "flac", "aac", "wma", "aiff", "f4a", "mp2"];
const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif", "avif", "svg"];
function kindFromFile(f) {
  if (f.type.startsWith("video")) return "video";
  if (f.type.startsWith("image")) return "image";
  if (f.type.startsWith("audio")) return "audio";
  // MKV and friends often ship with an empty MIME type — fall back to extension
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  if (VID_EXT.includes(ext)) return "video";
  if (AUD_EXT.includes(ext)) return "audio";
  if (IMG_EXT.includes(ext)) return "image";
  return null;
}
function addFiles(files) {
  [...files].forEach((f) => {
    const url = URL.createObjectURL(f);
    const kind = kindFromFile(f);
    if (!kind) { URL.revokeObjectURL(url); return toast("Skipped " + f.name + " (need video/image/audio)"); }
    const m = { id: uid(), kind, name: f.name, url, duration: kind === "image" ? 4 : 0, w: 0, h: 0 };
    S.media.push(m);
    const el = mediaEl(m);
    if (kind === "video") {
      el.onloadedmetadata = () => { m.duration = el.duration || 5; m.w = el.videoWidth; m.h = el.videoHeight; renderMedia(); };
      el.onerror = () => toast(m.name + ": this browser can't decode this file — try MP4 (H.264) or WebM");
    }
    if (kind === "audio") { el.onloadedmetadata = () => { m.duration = el.duration || 5; renderMedia(); }; }
  });
  renderMedia();
  toast("Imported — click + to add to timeline");
}
function addMediaObj(m) { S.media.push(m); renderMedia(); return m; }
function addToTimeline(mediaId, trackHint) {
  const m = getMedia(mediaId);
  if (!m) return;
  pushUndo();
  const track = trackHint || (m.kind === "audio" ? "audio" : m.kind === "video" || m.kind === "image" ? "video" : "overlay");
  const dur = m.kind === "image" ? 4 : (m.duration || 5);
  const clip = {
    id: uid(), track, kind: m.kind, mediaId: m.id, name: m.name,
    start: trackEnd(track), duration: Math.min(dur, 60), offset: 0,
    vol: 1, speed: 1, fadeIn: 0, fadeOut: 0, scale: 1, op: 1, x: 0, y: 0, rot: 0,
    flip: false, fit: "fit", bri: 1, con: 1, sat: 1, blur: 0, filter: "none",
    text: "", font: 64, color: "#ffffff", anim: "none",
  };
  S.clips.push(clip);
  S.selected = clip.id;
  renderAll();
}
function addTextClip(preset, custom) {
  pushUndo();
  const map = {
    "Title": { text: custom || "CHAD TITLE 💪", font: 84, anim: "pop" },
    "Lower third": { text: custom || "CHAD TV — subscribe", font: 44, anim: "slide" },
    "Subtitle POP": { text: custom || "let's gooo", font: 56, anim: "pop" },
    "Typewriter": { text: custom || "editing like a chad...", font: 52, anim: "type" },
    "Like & Subscribe": { text: "🔔 LIKE & SUBSCRIBE 👍", font: 58, anim: "pop" },
  };
  const p = map[preset] || map["Title"];
  S.clips.push({
    id: uid(), track: "overlay", kind: "text", mediaId: null, name: preset,
    start: S.currentTime, duration: 3, offset: 0, vol: 0, speed: 1,
    fadeIn: 0.25, fadeOut: 0.25, scale: 1, op: 1, x: 0, y: preset === "Lower third" ? 0.68 : 0,
    rot: 0, flip: false, fit: "fit", bri: 1, con: 1, sat: 1, blur: 0, filter: "none",
    text: p.text, font: p.font, color: "#ffffff", anim: p.anim,
  });
  renderAll();
}
function addSticker(ch) {
  pushUndo();
  S.clips.push({
    id: uid(), track: "overlay", kind: "sticker", mediaId: null, name: "Sticker " + ch,
    start: S.currentTime, duration: 2.5, offset: 0, vol: 0, speed: 1,
    fadeIn: 0.15, fadeOut: 0.15, scale: 1, op: 1, x: 0.55, y: -0.5, rot: 0,
    flip: false, fit: "fit", bri: 1, con: 1, sat: 1, blur: 0, filter: "none",
    text: ch, font: 120, color: "#ffffff", anim: "pop",
  });
  renderAll();
}

/* generated stock */
function canvasURL(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  return c.toDataURL("image/png");
}
function addStock(kind) {
  let url, name;
  if (kind === "bars") {
    url = canvasURL(1280, 720, (x, w, h) => {
      const cols = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
      cols.forEach((c, i) => { x.fillStyle = c; x.fillRect((w / 7) * i, 0, w / 7, h * 0.7); });
      x.fillStyle = "#111"; x.fillRect(0, h * 0.7, w, h * 0.3);
      x.fillStyle = "#fff"; x.font = "bold 60px Inter,sans-serif"; x.fillText("CLIPCHAD 4K TEST", 60, h * 0.9);
    }); name = "Color bars.png";
  } else if (kind === "gradient") {
    url = canvasURL(1280, 720, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#7C3AED"); g.addColorStop(1, "#06B6D4");
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = "rgba(255,255,255,.92)"; x.font = "900 110px Inter,sans-serif"; x.textAlign = "center";
      x.fillText("CHAD CARD", w / 2, h / 2); x.font = "600 44px Inter,sans-serif"; x.fillText("edit • export 4k", w / 2, h / 2 + 70);
    }); name = "Gradient card.png";
  } else {
    url = canvasURL(1280, 720, (x, w, h) => {
      x.fillStyle = "#0B1020"; x.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i += 80) for (let j = 0; j < h; j += 80) { x.fillStyle = (i + j) % 160 ? "#16213E" : "#1E293B"; x.fillRect(i, j, 80, 80); }
      x.fillStyle = "#FDE047"; x.font = "900 90px Inter,sans-serif"; x.textAlign = "center"; x.fillText("🏁 CHAD 🏁", w / 2, h / 2);
    }); name = "Checker.png";
  }
  const m = addMediaObj({ id: uid(), kind: "image", name, url, duration: 4, w: 1280, h: 720 });
  const img = new Image(); img.src = url; elCache.set(m.id, img);
  addToTimeline(m.id, "video");
}
async function synthTone(kind) {
  const sr = 44100, dur = 6, ctx = new OfflineAudioContext(2, sr * dur, sr);
  const out = ctx.createGain(); out.gain.value = 0.5; out.connect(ctx.destination);
  if (kind === "beep") {
    [220, 277, 330, 440].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      const t = i * 1.5; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.6, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 1.5);
    });
  } else if (kind === "bass") {
    for (let i = 0; i < 12; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(70, i * 0.5); o.frequency.exponentialRampToValueAtTime(45, i * 0.5 + 0.4);
      g.gain.setValueAtTime(0.9, i * 0.5); g.gain.exponentialRampToValueAtTime(0.001, i * 0.5 + 0.45);
      o.connect(g); g.connect(out); o.start(i * 0.5); o.stop(i * 0.5 + 0.5);
    }
  } else {
    const b = ctx.createBuffer(1, sr * dur, sr), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.25;
    const src = ctx.createBufferSource(); src.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 600;
    src.connect(f); f.connect(out); src.start();
  }
  const buf = await ctx.startRendering();
  // wav encode
  const n = buf.length, ch = 2, bytes = 44 + n * ch * 2;
  const ab = new ArrayBuffer(bytes), v = new DataView(ab);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF"); v.setUint32(4, bytes - 8, true); wstr(8, "WAVEfmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  wstr(36, "data"); v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = clamp(buf.getChannelData(c % buf.numberOfChannels)[i], -1, 1);
    v.setInt16(o, s * 32767, true); o += 2;
  }
  const blob = new Blob([ab], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const m = addMediaObj({ id: uid(), kind: "audio", name: kind + "-loop.wav", url, duration: dur });
  const a = document.createElement("audio"); a.src = url; elCache.set(m.id, a);
  addToTimeline(m.id, "audio");
  toast("Music added to Audio track ♪");
}

/* ================= RENDER: media bin / timeline / props ================= */
function renderMedia() {
  const g = $("#mediaGrid"); g.innerHTML = "";
  if (!S.media.length) { g.innerHTML = `<p class="muted">Empty — import or record something.</p>`; return; }
  S.media.forEach((m) => {
    const d = document.createElement("div"); d.className = "mitem";
    let th = "";
    if (m.kind === "image") th = `<img src="${m.url}" />`;
    else if (m.kind === "video") th = `<video src="${m.url}" muted playsinline></video>`;
    else th = `<div style="height:64px;display:flex;align-items:center;justify-content:center;font-size:26px">🎵</div>`;
    d.innerHTML = `${th}<div class="n" title="${m.name}">${m.kind === "video" ? "🎬" : m.kind === "image" ? "🖼" : "🎵"} ${m.name}</div><div class="a"><button data-a="add">+ Timeline</button><button data-a="play">▶</button></div>`;
    d.querySelector('[data-a="add"]').onclick = () => addToTimeline(m.id);
    d.querySelector('[data-a="play"]').onclick = (e) => {
      e.stopPropagation();
      const el = mediaEl(m);
      if (m.kind === "image") { toast("Image — " + m.name); return; }
      el.currentTime = 0; el.play().catch(() => {});
      toast("Previewing " + m.name + " (pause in tab)");
      setTimeout(() => el.pause(), 6000);
    };
    d.draggable = true;
    d.ondragstart = (e) => e.dataTransfer.setData("text/media-id", m.id);
    g.appendChild(d);
  });
  $("#dropHint").style.display = S.clips.length ? "none" : "block";
}
function rulerStep() {
  const target = 90 / pxPerSec;
  const steps = [0.1, 0.5, 1, 2, 5, 10, 30, 60];
  return steps.find((s) => s >= target) || 60;
}
function renderTimeline() {
  const dur = projectDuration();
  $("#durLabel").textContent = fmt(dur);
  $("#timeLabel").textContent = `${fmt(S.currentTime)} / ${fmt(dur)}`;
  const r = $("#ruler"); r.innerHTML = "";
  const step = rulerStep();
  const w = Math.max(dur * pxPerSec, $("#timeline").clientWidth - 100);
  for (let t = 0; t <= dur + 0.01; t += step) {
    const s = document.createElement("span");
    s.style.left = 86 + t * pxPerSec + "px"; s.textContent = fmt(t);
    r.appendChild(s);
  }
  ["video", "overlay", "audio"].forEach((tr) => {
    const lane = $("#lane-" + tr);
    lane.innerHTML = ""; lane.style.width = w + "px";
    trackOf(tr).forEach((c) => {
      const d = document.createElement("div");
      d.className = `clip ${c.kind}${S.selected === c.id ? " sel" : ""}`;
      d.style.left = c.start * pxPerSec + "px";
      d.style.width = Math.max(14, c.duration * pxPerSec) + "px";
      d.title = `${c.name} — ${fmt(c.start)} → ${fmt(c.start + c.duration)}`;
      d.innerHTML = `<div class="h l"></div><span style="overflow:hidden;text-overflow:ellipsis">${c.kind === "text" ? "🔤 " : c.kind === "sticker" ? "" : c.kind === "audio" ? "🎵 " : "🎬 "}${(c.text || c.name || "").slice(0, 26)}</span><div class="h r"></div>`;
      d.onpointerdown = (e) => clipPointer(e, c, d);
      d.oncontextmenu = (e) => { e.preventDefault(); S.selected = c.id; renderAll(); showCtx(e.clientX, e.clientY, c); };
      lane.appendChild(d);
    });
    lane.onclick = (e) => {
      if (e.target !== lane) return;
      const rect = lane.getBoundingClientRect();
      seek((e.clientX - rect.left) / pxPerSec);
    };
  });
  const ph = $("#playhead");
  ph.style.left = 86 + S.currentTime * pxPerSec + "px";
  $("#scrub").value = Math.round((S.currentTime / dur) * 1000);
}
function renderProps() {
  const c = getClip(S.selected);
  $("#noSel").hidden = !!c;
  $("#propForm").hidden = !c;
  if (!c) return;
  const set = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
  set("#pName", c.name); set("#pStart", c.start.toFixed(2)); set("#pDur", c.duration.toFixed(2));
  set("#pVol", c.vol); set("#pSpeed", c.speed); set("#pFadeIn", c.fadeIn); set("#pFadeOut", c.fadeOut);
  set("#pScale", c.scale); set("#pOp", c.op); set("#pX", c.x); set("#pY", c.y); set("#pRot", c.rot);
  set("#pBri", c.bri); set("#pCon", c.con); set("#pSat", c.sat); set("#pBlur", c.blur);
  const isText = c.kind === "text" || c.kind === "sticker";
  $("#textRow").style.display = isText ? "block" : "none";
  $("#fontRow").style.display = isText ? "grid" : "none";
  if (isText) { set("#pText", c.text); set("#pFont", c.font); set("#pColor", c.color); }
  $("#volRow").style.display = (c.kind === "audio" || (c.kind === "video" && getMedia(c.mediaId)?.kind === "video")) ? "grid" : "none";
  $("#projBg").value = S.bg;
}
function renderCaps() {
  const l = $("#capList"); l.innerHTML = "";
  S.captions.sort((a, b) => a.start - b.start).forEach((c) => {
    const d = document.createElement("div"); d.className = "cap";
    d.innerHTML = `<b>${fmt(c.start)} → ${fmt(c.end)}</b><br/>${c.text}
      <div class="row"><button class="sm" data-a="seek">⏩</button><button class="sm danger" data-a="del">✕</button></div>`;
    d.querySelector('[data-a="seek"]').onclick = () => seek(c.start);
    d.querySelector('[data-a="del"]').onclick = () => { pushUndo(); S.captions = S.captions.filter((x) => x.id !== c.id); renderAll(); };
    l.appendChild(d);
  });
}
function renderAll() { renderMedia(); renderTimeline(); renderProps(); renderCaps(); }

/* clip drag / trim */
function clipPointer(e, c, el) {
  e.stopPropagation();
  S.selected = c.id; renderTimeline(); renderProps();
  const isL = e.target.classList?.contains("l"), isR = e.target.classList?.contains("r");
  const mode = isL ? "trimL" : isR ? "trimR" : "move";
  const startX = e.clientX, oStart = c.start, oDur = c.duration, oOff = c.offset || 0;
  pushUndo._tmp = snap();
  const move = (ev) => {
    const dt = (ev.clientX - startX) / pxPerSec;
    if (mode === "move") {
      let ns = Math.max(0, oStart + dt);
      ns = snapTime(ns, c);
      c.start = Math.round(ns * 100) / 100;
    } else if (mode === "trimR") {
      c.duration = clamp(Math.round((oDur + dt) * 100) / 100, 0.2, 120);
    } else {
      let ns = clamp(oStart + dt, 0, oStart + oDur - 0.2);
      const d = oStart - ns;
      c.start = Math.round(ns * 100) / 100;
      c.duration = Math.round((oDur + d) * 100) / 100;
      if (c.mediaId) c.offset = Math.max(0, Math.round((oOff + d) * 100) / 100);
    }
    renderTimeline(); renderProps();
  };
  const up = () => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
    undoStack.push(pushUndo._tmp); if (undoStack.length > 80) undoStack.shift(); redoStack = [];
    renderAll();
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
}
function snapTime(t, self) {
  const cands = [S.currentTime];
  S.clips.forEach((c) => { if (c.id !== self.id) { cands.push(c.start, c.start + c.duration); } });
  for (const x of cands) if (Math.abs(x - t) * pxPerSec < 7) return x;
  return t;
}
function showCtx(x, y, c) {
  const m = $("#ctxMenu");
  m.innerHTML = `<button data-a="split">✂ Split at playhead</button><button data-a="dup">⧉ Duplicate</button><button data-a="del">🗑 Delete</button>`;
  m.hidden = false; m.style.left = x + "px"; m.style.top = y + "px";
  m.querySelector('[data-a="split"]').onclick = () => { m.hidden = true; splitClip(c); };
  m.querySelector('[data-a="dup"]').onclick = () => { m.hidden = true; dupClip(c); };
  m.querySelector('[data-a="del"]').onclick = () => { m.hidden = true; delClip(c); };
  setTimeout(() => window.addEventListener("click", () => (m.hidden = true), { once: true }), 10);
}
function splitClip(c) {
  c = c || getClip(S.selected);
  if (!c) return toast("Select a clip first");
  const t = S.currentTime;
  if (t <= c.start + 0.05 || t >= c.start + c.duration - 0.05) return toast("Move playhead inside the clip to split");
  pushUndo();
  const cut = Math.round((t - c.start) * 100) / 100;
  const b = JSON.parse(JSON.stringify(c));
  b.id = uid(); b.start = Math.round(t * 100) / 100; b.duration = Math.round((c.duration - cut) * 100) / 100;
  if (b.mediaId) b.offset = Math.round(((c.offset || 0) + cut * (c.speed || 1)) * 100) / 100;
  c.duration = cut;
  S.clips.push(b);
  renderAll(); toast("Split ✂");
}
function dupClip(c) {
  c = c || getClip(S.selected); if (!c) return;
  pushUndo();
  const b = JSON.parse(JSON.stringify(c)); b.id = uid(); b.start = Math.round((c.start + c.duration + 0.1) * 100) / 100;
  S.clips.push(b); S.selected = b.id; renderAll();
}
function delClip(c) {
  c = c || getClip(S.selected); if (!c) return;
  pushUndo();
  S.clips = S.clips.filter((x) => x.id !== c.id);
  S.selected = null; renderAll();
}

/* ================= PREVIEW + PLAYBACK ================= */
const canvas = $("#preview"), ctx = canvas.getContext("2d");
function aspectWH() {
  const m = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5], "21:9": [21, 9] }[S.aspect];
  return m;
}
function sizePreview() {
  const [aw, ah] = aspectWH();
  const base = 960;
  canvas.width = base; canvas.height = Math.round((base * ah) / aw);
  const wrap = $("#previewWrap").getBoundingClientRect();
  const s = Math.min((wrap.width - 30) / canvas.width, (wrap.height - 30) / canvas.height, 1.4);
  canvas.style.width = canvas.width * s + "px"; canvas.style.height = canvas.height * s + "px";
}
window.addEventListener("resize", sizePreview);

function activeAt(track, t) {
  return trackOf(track).filter((c) => t >= c.start && t < c.start + c.duration);
}
function fadeGain(c, t) {
  const lt = t - c.start, rt = c.start + c.duration - t;
  let g = 1;
  if (c.fadeIn > 0) g *= clamp(lt / c.fadeIn, 0, 1);
  if (c.fadeOut > 0) g *= clamp(rt / c.fadeOut, 0, 1);
  return g;
}
function filterStr(c) { return `brightness(${c.bri}) contrast(${c.con}) saturate(${c.sat}) blur(${c.blur}px)`; }
function drawCoverContain(x, el, W, H, mode, iw, ih) {
  const cr = W / H, ir = iw / ih;
  let dw, dh;
  if ((mode === "fill") === (cr > ir)) { dw = W; dh = W / ir; } else { dh = H; dw = H * ir; }
  x.drawImage(el, (W - dw) / 2, (H - dh) / 2, dw, dh);
}
function drawClipMedia(x, c, el, W, H, t) {
  const lt = t - c.start;
  const g = fadeGain(c, t) * (c.op ?? 1);
  x.save();
  x.globalAlpha = clamp(g, 0, 1);
  x.filter = filterStr(c);
  const cx = W / 2 + c.x * W * 0.5, cy = H / 2 + c.y * H * 0.5;
  x.translate(cx, cy);
  if (c.rot) x.rotate((c.rot * Math.PI) / 180);
  if (c.flip) x.scale(-1, 1);
  // transition flair
  let sc = c.scale || 1;
  if (c.anim === "zoom" && c.fadeIn > 0 && lt < c.fadeIn) sc *= 1 + 0.25 * (1 - lt / c.fadeIn);
  x.scale(sc, sc);
  let iw = 0, ih = 0;
  if (el instanceof HTMLVideoElement) { iw = el.videoWidth || 1280; ih = el.videoHeight || 720; }
  else if (el instanceof HTMLImageElement) { iw = el.naturalWidth || 1280; ih = el.naturalHeight || 720; }
  if (!iw) { x.restore(); return; }
  const base = Math.min(W / iw, H / ih);
  const dw = iw * base, dh = ih * base;
  if (c.fit === "fill") { x.restore(); x.save(); x.globalAlpha = clamp(g, 0, 1); x.filter = filterStr(c); x.translate(cx, cy); if (c.rot) x.rotate((c.rot * Math.PI) / 180); if (c.flip) x.scale(-1, 1); x.scale(sc, sc); drawCoverContain(x, el, W * 4, H * 4, "fill", iw, ih); x.restore(); return; }
  // slide flair
  if (c.anim === "slide") { const k = c.fadeIn > 0 ? clamp(lt / c.fadeIn, 0, 1) : 1; x.translate(-W * 0.3 * (1 - k), 0); }
  try { x.drawImage(el, -dw / 2, -dh / 2, dw, dh); } catch {}
  x.restore();
}
function drawTextClip(x, c, W, H, t) {
  const lt = t - c.start;
  const g = fadeGain(c, t) * (c.op ?? 1);
  x.save();
  x.globalAlpha = clamp(g, 0, 1);
  const fs = ((c.font || 64) / 960) * W * (c.scale || 1);
  x.font = `800 ${fs}px Inter, Segoe UI, Arial, sans-serif`;
  x.textAlign = "center"; x.textBaseline = "middle";
  let txt = c.text || "";
  if (c.anim === "type") txt = txt.slice(0, Math.floor(lt * 18) + 1);
  let dx = W / 2 + c.x * W * 0.5, dy = H / 2 + c.y * H * 0.42;
  if (c.anim === "slide") { const k = c.fadeIn > 0 ? clamp(lt / c.fadeIn, 0, 1) : 1; dx = dx - W * 0.25 * (1 - k); }
  if (c.anim === "pop") { const k = clamp(lt / 0.3, 0, 1); const b = 1 + 0.35 * (1 - k) * Math.cos(k * Math.PI); x.translate(dx, dy); x.scale(b, b); dx = 0; dy = 0; }
  x.lineWidth = Math.max(2, fs / 14); x.strokeStyle = "rgba(0,0,0,.75)";
  const isLow = c.name === "Lower third";
  if (isLow) {
    x.fillStyle = S.brand.color; x.globalAlpha = clamp(g, 0, 1) * 0.95;
    const bw = Math.min(W * 0.8, x.measureText(txt).width + 60);
    x.fillRect(W * 0.08, H * 0.78, bw, fs * 1.5);
    x.globalAlpha = clamp(g, 0, 1);
    x.fillStyle = "#0B1020"; x.textAlign = "left"; x.fillText(txt, W * 0.08 + 24, H * 0.78 + fs * 0.78);
  } else {
    x.strokeText(txt, dx, dy); x.fillStyle = c.color || "#fff"; x.fillText(txt, dx, dy);
  }
  x.restore();
}
function drawStickerClip(x, c, W, H, t) {
  if (c.text === "⬛" || c.text === "⭕") {
    const g = fadeGain(c, t) * (c.op ?? 1);
    x.save(); x.globalAlpha = clamp(g, 0, 1);
    x.translate(W / 2 + c.x * W * 0.5, H / 2 + c.y * H * 0.42);
    x.rotate(((c.rot || 0) * Math.PI) / 180); x.scale(c.scale || 1, c.scale || 1);
    x.fillStyle = S.brand.color; x.strokeStyle = S.brand.color; x.lineWidth = 10;
    if (c.text === "⬛") x.fillRect(-70, -45, 140, 90);
    else { x.beginPath(); x.arc(0, 0, 60, 0, Math.PI * 2); x.stroke(); }
    x.restore(); return;
  }
  drawTextClip(x, { ...c, font: c.font || 120 }, W, H, t);
}
function drawFrame(x, W, H, t) {
  x.save();
  x.fillStyle = S.bg; x.fillRect(0, 0, W, H);
  x.filter = "none"; x.globalAlpha = 1;
  // base: latest-start video clip wins (topmost layering like Clipchamp)
  const vids = activeAt("video", t);
  const base = vids[vids.length - 1];
  if (base) {
    const m = getMedia(base.mediaId);
    const el = m ? mediaEl(m) : null;
    if (el && (el instanceof HTMLVideoElement || el instanceof HTMLImageElement)) {
      const ready = el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete && el.naturalWidth;
      if (ready) drawClipMedia(x, base, el, W, H, t);
      else { x.fillStyle = "#111936"; x.fillRect(0, 0, W, H); }
    }
  } else {
    // empty gap
    x.fillStyle = "rgba(148,163,184,.5)"; x.font = `${Math.round(H * 0.05)}px Inter,sans-serif`; x.textAlign = "center";
    if (!S.clips.length) { x.fillText("Import media to start your CHAD edit 💪", W / 2, H / 2); }
  }
  for (const c of activeAt("overlay", t)) {
    if (c.kind === "text") drawTextClip(x, c, W, H, t);
    else if (c.kind === "sticker") drawStickerClip(x, c, W, H, t);
    else if (c.mediaId) {
      const m = getMedia(c.mediaId), el = m ? mediaEl(m) : null;
      if (el) drawClipMedia(x, c, el, W, H, t);
    } else if (c.speak) { /* voiceover: no visual */ }
  }
  // captions burn-in
  const cap = S.captions.find((c) => t >= c.start && t < c.end);
  if (cap) {
    x.save();
    x.font = `700 ${Math.round(H * 0.05)}px Inter,sans-serif`; x.textAlign = "center";
    const tw = x.measureText(cap.text).width;
    x.fillStyle = "rgba(0,0,0,.72)";
    x.fillRect(W / 2 - tw / 2 - 16, H * 0.86 - H * 0.035, tw + 32, H * 0.07);
    x.fillStyle = "#fff"; x.textBaseline = "middle";
    x.fillText(cap.text, W / 2, H * 0.86);
    x.restore();
  }
  x.restore();
}

/* audio sync */
const spoken = new Set();
function syncAudio(t, playing) {
  const all = [...activeAt("audio", t), ...activeAt("video", t).filter((c) => getMedia(c.mediaId)?.kind === "video")];
  const activeIds = new Set(all.map((c) => c.id));
  for (const c of S.clips) {
    const m = c.mediaId ? getMedia(c.mediaId) : null;
    if (!m) continue;
    const el = mediaEl(m);
    if (!(el instanceof HTMLVideoElement || el instanceof HTMLAudioElement)) continue;
    const isActive = activeIds.has(c.id) && t >= c.start && t < c.start + c.duration;
    if (isActive && playing) {
      const target = (c.offset || 0) + (t - c.start) * (c.speed || 1);
      el.playbackRate = c.speed || 1;
      el.volume = clamp((c.vol ?? 1) * fadeGain(c, t), 0, 1);
      if (Math.abs((el.currentTime || 0) - target) > 0.35) { try { el.currentTime = target; } catch {} }
      el.play().catch(() => {});
    } else {
      // pause only if not needed by another active clip sharing same element
      const needed = S.clips.some((o) => o.mediaId === c.mediaId && activeIds.has(o.id) && o.id !== c.id);
      if (!needed) el.pause();
    }
  }
  // TTS voiceover clips
  for (const c of S.clips.filter((x) => x.speak)) {
    if (playing && t >= c.start && !spoken.has(c.id) && t < c.start + c.duration) {
      spoken.add(c.id);
      try {
        const u = new SpeechSynthesisUtterance(c.text);
        const v = speechSynthesis.getVoices().find((x) => x.name === c.voice);
        if (v) u.voice = v;
        speechSynthesis.speak(u);
      } catch {}
    }
    if (t < c.start - 0.2) spoken.delete(c.id);
  }
}
function pauseAll() {
  elCache.forEach((el) => { if (el.pause) try { el.pause(); } catch {} });
  try { speechSynthesis.cancel(); } catch {}
}
function seek(t) {
  S.currentTime = clamp(t, 0, projectDuration());
  spoken.clear();
  renderTimeline();
}

/* main loop */
let lastTs = 0;
function loop(ts) {
  const dt = Math.min(0.1, (ts - lastTs) / 1000 || 0);
  lastTs = ts;
  if (S.playing) {
    S.currentTime += dt;
    if (S.currentTime >= projectDuration()) { S.currentTime = projectDuration(); setPlaying(false); }
    renderTimeline();
  }
  syncAudio(S.currentTime, S.playing);
  drawFrame(ctx, canvas.width, canvas.height, S.currentTime);
  requestAnimationFrame(loop);
}
function setPlaying(p) {
  S.playing = p;
  $("#playBtn").textContent = p ? "⏸" : "▶";
  if (!p) pauseAll();
}

/* ================= EXPORT 4K ================= */
let expCancel = false;
function exportWH() {
  const [rw, rh] = $("#resSel").value.split("x").map(Number);
  const [aw, ah] = aspectWH();
  const base = Math.max(rw, rh);
  if (S.aspect === "16:9") return rw >= rh ? [rw, Math.round((rw * 9) / 16)] : [rh, Math.round((rh * 9) / 16)];
  if (S.aspect === "9:16") return [Math.round((base * 9) / 16), base];
  if (S.aspect === "1:1") return [Math.min(base, 2160), Math.min(base, 2160)];
  if (S.aspect === "4:5") return [Math.round((base * 4) / 5), base];
  return [base, Math.round((base * 9) / 21)]; // 21:9
}
async function doExport() {
  if (!S.clips.length && !S.captions.length) return toast("Timeline is empty — add something first");
  expCancel = false;
  $("#exportModal").hidden = false;
  $("#expPrev").hidden = true; $("#expDl").hidden = true;
  $("#expBar").style.width = "0%";
  const fps = +$("#fpsSel").value;
  const [W, H] = exportWH();
  const dur = projectDuration();
  $("#expInfo").textContent = `Rendering ${W}×${H} @ ${fps}fps — ${fmt(dur)} — no watermark…`;
  const wasPlaying = S.playing; setPlaying(false); pauseAll();
  await new Promise((r) => setTimeout(r, 300));
  try {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    const stream = c.captureStream(fps);
    // audio graph
    const AC = new (window.AudioContext || window.webkitAudioContext)();
    await AC.resume().catch(() => {});
    const dest = AC.createMediaStreamDestination();
    const srcMap = new Map();
    for (const clip of S.clips) {
      const m = clip.mediaId ? getMedia(clip.mediaId) : null;
      if (!m) continue;
      const el = mediaEl(m);
      if (!(el instanceof HTMLVideoElement || el instanceof HTMLAudioElement)) continue;
      if (!srcMap.has(m.id)) {
        try {
          const src = AC.createMediaElementSource(el);
          const g = AC.createGain(); src.connect(g); g.connect(dest);
          srcMap.set(m.id, g);
        } catch { /* already bound to another context */ }
      }
    }
    const tracks = [...stream.getVideoTracks(), ...dest.stream.getAudioTracks()];
    const mixed = new MediaStream(tracks);
    let mime = "";
    const cands = ["video/mp4;codecs=avc1.640034,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
    for (const cd of cands) { if (window.MediaRecorder?.isTypeSupported(cd)) { mime = cd; break; } }
    const is4K = Math.max(W, H) >= 3000;
    const br = is4K ? 40000000 : Math.max(W, H) >= 2000 ? 20000000 : Math.max(W, H) >= 1500 ? 12000000 : 8000000;
    const rec = new MediaRecorder(mixed, { mimeType: mime || undefined, videoBitsPerSecond: br, audioBitsPerSecond: 320000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => (rec.onstop = res));
    // restart all media heads
    S.currentTime = 0; spoken.clear();
    elCache.forEach((el) => { try { el.pause(); el.currentTime = 0; } catch {} });
    try { speechSynthesis.cancel(); } catch {}
    rec.start(250);
    const t0 = performance.now();
    await new Promise((resolve) => {
      function frame() {
        if (expCancel) return resolve();
        const t = (performance.now() - t0) / 1000;
        S.currentTime = Math.min(t, dur);
        drawFrame(x, W, H, S.currentTime);
        // live audio sync (muted locally? keep audible low — capture via graph)
        syncAudio(S.currentTime, true);
        $("#expBar").style.width = (S.currentTime / dur) * 100 + "%";
        $("#expInfo").textContent = `Rendering ${W}×${H} @ ${fps}fps — ${fmt(S.currentTime)} / ${fmt(dur)} (${mime.includes("mp4") ? "MP4 H.264" : "WebM"})`;
        renderTimeline();
        if (t < dur) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
    rec.stop(); pauseAll();
    try { AC.close(); } catch {}
    await done;
    if (expCancel) { $("#expInfo").textContent = "Cancelled."; return; }
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    const blob = new Blob(chunks, { type: mime.split(";")[0] });
    const url = URL.createObjectURL(blob);
    const prev = $("#expPrev"); prev.src = url; prev.hidden = false;
    const dl = $("#expDl");
    dl.href = url; dl.hidden = false;
    dl.download = ($("#projName").value || "clipchad").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") + `-${W}x${H}.${ext}`;
    dl.textContent = `Download ${W}×${H} ${ext.toUpperCase()} (${(blob.size / 1048576).toFixed(1)} MB)`;
    $("#expBar").style.width = "100%";
    $("#expInfo").textContent = `Done — ${W}×${H} ${ext.toUpperCase()} rendered with ClipChad. No watermark.`;
    toast("Export complete");
  } catch (err) {
    console.error(err);
    $("#expInfo").textContent = "Export failed: " + err.message + " — try 1080p or WebM.";
  } finally {
    if (wasPlaying) setPlaying(false);
    renderTimeline();
  }
}

/* ================= RECORD ================= */
let recStream = null, recMr = null, recChunks = [], recRAF = 0;
async function startRec(mode) {
  try {
    stopRecTracks();
    const mic = $("#recMic").checked ? await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null) : null;
    let stream;
    if (mode === "cam") stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: !mic });
    else if (mode === "screen") stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    else {
      const scr = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 270 }, audio: false });
      const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
      const x = c.getContext("2d");
      const sv = document.createElement("video"); sv.srcObject = scr; sv.muted = true; sv.play();
      const cv = document.createElement("video"); cv.srcObject = cam; cv.muted = true; cv.play();
      await new Promise((r) => setTimeout(r, 600));
      const draw = () => { try { x.drawImage(sv, 0, 0, 1280, 720); x.drawImage(cv, 1280 - 340, 720 - 220, 320, 180); } catch {} recRAF = requestAnimationFrame(draw); };
      draw();
      stream = c.captureStream(30);
      [scr, cam].forEach((s) => s.getTracks().forEach((t) => { if (t.kind === "audio") stream.addTrack(t); }));
      recStream = [...(scr ? [scr] : []), ...(cam ? [cam] : [])];
    }
    if (mic && mode !== "both") mic.getAudioTracks().forEach((t) => stream.addTrack(t));
    if (!recStream) recStream = stream; else if (mode !== "both") recStream = stream;
    const mime = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((m) => window.MediaRecorder?.isTypeSupported(m)) || "";
    recMr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recChunks = [];
    recMr.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    recMr.onstop = () => {
      cancelAnimationFrame(recRAF);
      const blob = new Blob(recChunks, { type: recMr.mimeType || "video/webm" });
      const url = URL.createObjectURL(blob);
      const m = addMediaObj({ id: uid(), kind: "video", name: `Recording ${new Date().toLocaleTimeString()}.webm`, url, duration: 5 });
      const v = document.createElement("video"); v.src = url;
      v.onloadedmetadata = () => { m.duration = v.duration || 5; renderMedia(); };
      elCache.set(m.id, v);
      addToTimeline(m.id, "video");
      $("#recStatus").textContent = "Saved ✓ — clip added to Media + timeline.";
      stopRecTracks();
    };
    recMr.start();
    $("#recStop").disabled = false;
    $("#recStatus").textContent = "● Recording " + mode + "… click Stop when done.";
  } catch (err) { toast("Record failed: " + err.message); }
}
function stopRecTracks() {
  try { recMr?.state === "recording" && recMr.stop(); } catch {}
  $("#recStop").disabled = true;
  const arr = Array.isArray(recStream) ? recStream : recStream ? [recStream] : [];
  arr.forEach((s) => { try { s.getTracks?.().forEach((t) => t.stop()); } catch {} });
  recStream = null;
}

/* ================= TEMPLATES ================= */
function clearTimeline() { pushUndo(); S.clips = []; S.captions = []; S.selected = null; S.currentTime = 0; pauseAll(); renderAll(); }
function applyTemplate(kind) {
  pushUndo();
  S.clips = []; S.captions = []; S.currentTime = 0;
  if (kind === "clear") { renderAll(); return; }
  if (kind === "intro") {
    S.aspect = "16:9"; $("#aspectSel").value = S.aspect;
    const g = addMediaObj({ id: uid(), kind: "image", name: "Intro BG.png", url: canvasURL(1280, 720, (x, w, h) => { const gr = x.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "#7C3AED"); gr.addColorStop(1, "#06B6D4"); x.fillStyle = gr; x.fillRect(0, 0, w, h); }), duration: 5 });
    elCache.set(g.id, Object.assign(new Image(), { src: g.url }));
    S.clips.push({ id: uid(), track: "video", kind: "image", mediaId: g.id, name: "Intro BG", start: 0, duration: 5, offset: 0, vol: 0, speed: 1, fadeIn: 0.4, fadeOut: 0.4, scale: 1, op: 1, x: 0, y: 0, rot: 0, flip: false, fit: "fit", bri: 1, con: 1, sat: 1.2, blur: 0, filter: "none", text: "", font: 64, color: "#fff", anim: "zoom" });
    S.clips.push({ id: uid(), track: "overlay", kind: "text", mediaId: null, name: "Title", start: 0.4, duration: 3.4, offset: 0, vol: 0, speed: 1, fadeIn: 0.3, fadeOut: 0.3, scale: 1, op: 1, x: 0, y: -0.1, rot: 0, flip: false, fit: "fit", bri: 1, con: 1, sat: 1, blur: 0, filter: "none", text: ($("#brandName").value || "CHAD TV") + " 💪", font: 92, color: "#ffffff", anim: "pop" });
    S.captions.push({ id: uid(), start: 0.5, end: 4.5, text: "Welcome back legends 🔥" });
  } else if (kind === "reels") {
    S.aspect = "9:16"; $("#aspectSel").value = S.aspect;
    const g = addMediaObj({ id: uid(), kind: "image", name: "Reels BG.png", url: canvasURL(720, 1280, (x, w, h) => { const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#F59E0B"); gr.addColorStop(0.5, "#EC4899"); gr.addColorStop(1, "#7C3AED"); x.fillStyle = gr; x.fillRect(0, 0, w, h); }), duration: 7 });
    elCache.set(g.id, Object.assign(new Image(), { src: g.url }));
    S.clips.push({ id: uid(), track: "video", kind: "image", mediaId: g.id, name: "Reels BG", start: 0, duration: 7, offset: 0, vol: 0, speed: 1, fadeIn: 0.3, fadeOut: 0.3, scale: 1, op: 1, x: 0, y: 0, rot: 0, flip: false, fit: "fit", bri: 1, con: 1.1, sat: 1.3, blur: 0, filter: "none", text: "", font: 64, color: "#fff", anim: "none" });
    S.clips.push({ id: uid(), track: "overlay", kind: "text", mediaId: null, name: "Hook", start: 0.3, duration: 2.5, offset: 0, vol: 0, speed: 1, fadeIn: 0.2, fadeOut: 0.2, scale: 1, op: 1, x: 0, y: -0.6, rot: 0, flip: false, fit: "fit", bri: 1, con: 1, sat: 1, blur: 0, filter: "none", text: "POV: 4K edit", font: 72, color: "#fff", anim: "pop" });
    S.clips.push({ id: uid(), track: "overlay", kind: "sticker", mediaId: null, name: "Sticker", start: 3, duration: 2.5, offset: 0, vol: 0, speed: 1, fadeIn: 0.2, fadeOut: 0.2, scale: 1, op: 1, x: 0, y: 0.2, rot: 0, flip: false, fit: "fit", bri: 1, con: 1, sat: 1, blur: 0, filter: "none", text: "🔥", font: 150, color: "#fff", anim: "pop" });
    S.captions.push({ id: uid(), start: 0.3, end: 2.8, text: "POV: 4K edit" }, { id: uid(), start: 3, end: 5.5, text: "ClipChad goes hard 🔥" });
  } else {
    for (let i = 0; i < 3; i++) {
      const cols = [["#0EA5E9", "#6366F1"], ["#22C55E", "#0EA5E9"], ["#F59E0B", "#EF4444"]][i];
      const g = addMediaObj({ id: uid(), kind: "image", name: `Slide ${i + 1}.png`, url: canvasURL(1280, 720, (x, w, h) => { const gr = x.createLinearGradient(0, 0, w, h); gr.addColorStop(0, cols[0]); gr.addColorStop(1, cols[1]); x.fillStyle = gr; x.fillRect(0, 0, w, h); x.fillStyle = "#fff"; x.font = "900 140px Inter,sans-serif"; x.textAlign = "center"; x.fillText(`${i + 1}`, w / 2, h / 2 + 50); }), duration: 3 });
      elCache.set(g.id, Object.assign(new Image(), { src: g.url }));
      S.clips.push({ id: uid(), track: "video", kind: "image", mediaId: g.id, name: `Slide ${i + 1}`, start: i * 3, duration: 3, offset: 0, vol: 0, speed: 1, fadeIn: 0.5, fadeOut: 0.5, scale: 1, op: 1, x: 0, y: 0, rot: 0, flip: false, fit: "fit", bri: 1, con: 1, sat: 1.1, blur: 0, filter: "none", text: "", font: 64, color: "#fff", anim: "none" });
    }
    synthTone("beep");
  }
  sizePreview(); renderAll(); toast("Template applied 📦");
}

/* ================= INIT / EVENTS ================= */
function init() {
  document.title = "ClipChad — 4K Browser Video Editor";
  // tabs
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]"); if (!b) return;
    $$("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
    $$(".panels section").forEach((s) => s.classList.toggle("on", s.dataset.panel === b.dataset.tab));
  });
  $("#importBtn").onclick = () => $("#fileInput").click();
  $("#fileInput").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
  ["dragover", "dragenter"].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const mid = e.dataTransfer.getData("text/media-id");
    if (mid) { addToTimeline(mid, e.target.closest('.track')?.dataset.track); return; }
    if (e.target.closest(".lane")) {
      const lane = e.target.closest(".lane");
      const tr = lane.id.replace("lane-", "");
      const rect = lane.getBoundingClientRect();
      const t = (e.clientX - rect.left) / pxPerSec;
      const files = [...e.dataTransfer.files];
      if (files.length) {
        const before = S.media.length;
        addFiles(files);
        setTimeout(() => { S.media.slice(before).forEach((m) => {
          pushUndo();
          S.clips.push({ id: uid(), track: tr === "video" ? (m.kind === "audio" ? "audio" : "video") : tr, kind: m.kind, mediaId: m.id, name: m.name, start: Math.max(t, trackEnd(tr)), duration: m.kind === "image" ? 4 : (m.duration || 5), offset: 0, vol: 1, speed: 1, fadeIn: 0, fadeOut: 0, scale: 1, op: 1, x: 0, y: 0, rot: 0, flip: false, fit: "fit", bri: 1, con: 1, sat: 1, blur: 0, filter: "none", text: "", font: 64, color: "#fff", anim: "none" });
        }); renderAll(); }, 800);
      }
      return;
    }
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  // transport
  $("#playBtn").onclick = () => setPlaying(!S.playing);
  $("#backBtn").onclick = () => seek(S.currentTime - 1);
  $("#fwdBtn").onclick = () => seek(S.currentTime + 1);
  $("#splitBtn").onclick = () => splitClip();
  $("#gapBtn").onclick = () => {
    pushUndo();
    const v = trackOf("video");
    let cursor = 0;
    v.forEach((c) => { const gap = c.start - cursor; if (gap > 0.05) c.start = cursor; cursor = c.start + c.duration; });
    renderAll(); toast("Gaps removed 🧹");
  };
  $("#scrub").oninput = (e) => { setPlaying(false); seek((e.target.value / 1000) * projectDuration()); };
  $("#zoom").oninput = (e) => { pxPerSec = +e.target.value; renderTimeline(); };
  $("#aspectSel").onchange = (e) => { S.aspect = e.target.value; sizePreview(); renderTimeline(); };
  $("#undoBtn").onclick = undo; $("#redoBtn").onclick = redo;
  $("#fitBtn").onclick = () => { const d = projectDuration(); pxPerSec = clamp(($("#timeline").clientWidth - 120) / d, 20, 220); $("#zoom").value = pxPerSec; renderTimeline(); };
  $("#fullBtn").onclick = () => $("#previewWrap").requestFullscreen?.();
  $("#bgColor").oninput = (e) => { S.bg = e.target.value; $("#projBg").value = e.target.value; };
  $("#projBg").oninput = (e) => { S.bg = e.target.value; $("#bgColor").value = e.target.value; };

  // floatbar
  $("#floatbar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const c = getClip(S.selected);
    if (!c) return toast("Select a clip first");
    pushUndo();
    const a = b.dataset.act;
    if (a === "rot") c.rot = ((c.rot || 0) + 90) % 360;
    if (a === "flip") c.flip = !c.flip;
    if (a === "fit") c.fit = "fit";
    if (a === "fill") c.fit = "fill";
    if (a === "bg") { S.bg = $("#bgColor").value; }
    if (a === "pip") { c.scale = 0.32; c.x = 0.62; c.y = 0.58; if (c.track === "video") c.track = "overlay"; }
    renderAll();
  });

  // sidebar actions
  $$("[data-stock]").forEach((b) => (b.onclick = () => (b.dataset.stock === "tone" ? synthTone("bass") : addStock(b.dataset.stock))));
  $$("[data-text]").forEach((b) => (b.onclick = () => addTextClip(b.dataset.text, $("#customText").value)));
  $("#addTextBtn").onclick = () => addTextClip("Title", $("#customText").value);
  $$("[data-sticker]").forEach((b) => (b.onclick = () => addSticker(b.dataset.sticker)));
  $$("[data-music]").forEach((b) => (b.onclick = () => synthTone(b.dataset.music)));
  $$("[data-tr]").forEach((b) => (b.onclick = () => {
    const c = getClip(S.selected);
    if (!c || c.track !== "video") return toast("Select a VIDEO clip first");
    pushUndo();
    const t = b.dataset.tr;
    if (t === "none") { c.fadeIn = 0; c.fadeOut = 0; c.anim = "none"; }
    else if (t === "fadeblack") { c.fadeIn = 0.6; c.fadeOut = 0.6; c.anim = "none"; }
    else if (t === "slide") { c.fadeIn = 0.5; c.fadeOut = 0.5; c.anim = "slide"; }
    else if (t === "zoom") { c.fadeIn = 0.5; c.fadeOut = 0.5; c.anim = "zoom"; }
    else { c.fadeIn = 0.5; c.fadeOut = 0.5; c.anim = "none"; }
    renderAll(); toast("Transition: " + t + " ✨");
  }));
  $$("[data-filter]").forEach((b) => (b.onclick = () => {
    const c = getClip(S.selected);
    if (!c) return toast("Select a clip first");
    pushUndo();
    const f = b.dataset.filter;
    c.filter = f;
    Object.assign(c, { bri: 1, con: 1, sat: 1, blur: 0 });
    if (f === "cinematic") Object.assign(c, { con: 1.25, sat: 0.85, bri: 0.95 });
    if (f === "vivid") Object.assign(c, { sat: 1.6, con: 1.15 });
    if (f === "bw") Object.assign(c, { sat: 0, con: 1.1 });
    if (f === "sepia") Object.assign(c, { sat: 0.6, con: 1.05, bri: 1.05 });
    if (f === "cold") Object.assign(c, { sat: 1.1, bri: 1.08 });
    if (f === "warm") Object.assign(c, { sat: 1.25, bri: 1.06 });
    renderAll();
  }));
  $$("[data-tmpl]").forEach((b) => (b.onclick = () => applyTemplate(b.dataset.tmpl)));

  // record
  $("#recCam").onclick = () => startRec("cam");
  $("#recScreen").onclick = () => startRec("screen");
  $("#recBoth").onclick = () => startRec("both");
  $("#recStop").onclick = () => { try { recMr?.stop(); } catch {} };

  // brand
  $("#logoInput").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    const m = addMediaObj({ id: uid(), kind: "image", name: f.name, url, duration: projectDuration() });
    const img = new Image(); img.src = url; elCache.set(m.id, img);
    S.brand.logoId = m.id; toast("Logo saved to Brand kit 💪");
  };
  $("#brandColor").oninput = (e) => (S.brand.color = e.target.value);
  $("#brandName").oninput = (e) => (S.brand.name = e.target.value);
  const watermark = () => {
    if (!S.brand.logoId) return toast("Upload a logo first");
    pushUndo();
    const d = projectDuration();
    S.clips.push({ id: uid(), track: "overlay", kind: "image", mediaId: S.brand.logoId, name: "Watermark", start: 0, duration: d, offset: 0, vol: 0, speed: 1, fadeIn: 0, fadeOut: 0, scale: 0.18, op: 0.9, x: 0.78, y: -0.72, rot: 0, flip: false, fit: "fit", bri: 1, con: 1, sat: 1, blur: 0, filter: "none", text: "", font: 64, color: "#fff", anim: "none" });
    renderAll();
  };
  $("#addWm").onclick = watermark;
  $("#brandApply").onclick = () => {
    S.brand.color = $("#brandColor").value; S.brand.name = $("#brandName").value;
    if (S.brand.logoId) watermark();
    addTextClip("Lower third", S.brand.name + " 💪");
  };

  // captions
  $("#capAdd").onclick = () => {
    pushUndo();
    S.captions.push({ id: uid(), start: S.currentTime, end: S.currentTime + 2, text: "New caption" });
    renderAll();
  };
  $("#capAuto").onclick = () => {
    pushUndo();
    S.captions = trackOf("overlay").filter((c) => c.kind === "text").map((c) => ({ id: uid(), start: c.start, end: c.start + c.duration, text: c.text }));
    renderAll(); toast("Captions from text track ✨");
  };
  $("#capVtt").onclick = () => {
    let vtt = "WEBVTT\n\n";
    S.captions.forEach((c, i) => {
      const ts = (t) => `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor((t / 60) % 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}.${String(Math.floor((t % 1) * 1000)).padStart(3, "0")}`;
      vtt += `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n\n`;
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    a.download = "clipchad-captions.vtt"; a.click();
  };

  // TTS
  const loadVoices = () => {
    const vs = speechSynthesis.getVoices();
    $("#ttsVoice").innerHTML = vs.map((v) => `<option>${v.name}</option>`).join("");
  };
  speechSynthesis.onvoiceschanged = loadVoices; loadVoices();
  $("#ttsSpeak").onclick = () => {
    const u = new SpeechSynthesisUtterance($("#ttsText").value);
    const v = speechSynthesis.getVoices().find((x) => x.name === $("#ttsVoice").value);
    if (v) u.voice = v;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  };
  $("#ttsAdd").onclick = () => {
    pushUndo();
    S.clips.push({ id: uid(), track: "audio", kind: "text", mediaId: null, speak: true, voice: $("#ttsVoice").value, name: "Voiceover", start: S.currentTime, duration: Math.max(3, $("#ttsText").value.length / 12), offset: 0, vol: 1, speed: 1, fadeIn: 0, fadeOut: 0, scale: 1, op: 1, x: 0, y: 0, rot: 0, flip: false, fit: "fit", bri: 1, con: 1, sat: 1, blur: 0, filter: "none", text: $("#ttsText").value, font: 40, color: "#fff", anim: "none" });
    renderAll(); toast("Voiceover added — speaks at playback 🔊");
  };

  // props binding
  const bind = (id, fn) => $(id).addEventListener("input", (e) => {
    const c = getClip(S.selected); if (!c) return;
    if (!bind._t) pushUndo();
    clearTimeout(bind._t); bind._t = setTimeout(() => (bind._t = null), 800);
    fn(c, e.target.value); renderTimeline();
  });
  bind("#pName", (c, v) => (c.name = v));
  bind("#pStart", (c, v) => (c.start = Math.max(0, +v || 0)));
  bind("#pDur", (c, v) => (c.duration = Math.max(0.2, +v || 1)));
  bind("#pVol", (c, v) => (c.vol = +v));
  bind("#pSpeed", (c, v) => (c.speed = clamp(+v || 1, 0.25, 4)));
  bind("#pFadeIn", (c, v) => (c.fadeIn = Math.max(0, +v || 0)));
  bind("#pFadeOut", (c, v) => (c.fadeOut = Math.max(0, +v || 0)));
  bind("#pScale", (c, v) => (c.scale = +v));
  bind("#pOp", (c, v) => (c.op = +v));
  bind("#pX", (c, v) => (c.x = +v));
  bind("#pY", (c, v) => (c.y = +v));
  bind("#pRot", (c, v) => (c.rot = +v));
  bind("#pBri", (c, v) => (c.bri = +v));
  bind("#pCon", (c, v) => (c.con = +v));
  bind("#pSat", (c, v) => (c.sat = +v));
  bind("#pBlur", (c, v) => (c.blur = +v));
  bind("#pText", (c, v) => (c.text = v));
  bind("#pFont", (c, v) => (c.font = +v || 64));
  bind("#pColor", (c, v) => (c.color = v));
  $("#dupBtn").onclick = () => dupClip();
  $("#delBtn").onclick = () => delClip();

  // save/load
  $("#saveBtn").onclick = () => {
    const data = JSON.stringify({ name: $("#projName").value, clips: S.clips, captions: S.captions, bg: S.bg, aspect: S.aspect, brand: S.brand }, null, 1);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    a.download = "clipchad-project.json"; a.click();
    try { localStorage.setItem("clipchad-autosave", data); } catch {}
    toast("Project saved 💾");
  };
  $("#loadBtn").onclick = () => $("#projInput").click();
  const projInput = document.createElement("input");
  projInput.type = "file"; projInput.accept = "application/json"; projInput.hidden = true;
  document.body.appendChild(projInput);
  projInput.onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const o = JSON.parse(r.result);
        pushUndo();
        S.clips = o.clips || []; S.captions = o.captions || []; S.bg = o.bg || "#000";
        S.aspect = o.aspect || "16:9"; $("#aspectSel").value = S.aspect;
        Object.assign(S.brand, o.brand || {});
        $("#projName").value = o.name || "My Chad Edit";
        // media refs may be missing after reload — keep clips but warn
        sizePreview(); renderAll(); toast("Project loaded 📂 (re-import media files if clips are blank)");
      } catch { toast("Bad project file"); }
    };
    r.readAsText(f);
  };

  // export
  $("#exportBtn").onclick = doExport;
  $("#expCancel").onclick = () => { expCancel = true; };
  $("#expClose").onclick = () => { expCancel = true; $("#exportModal").hidden = true; };

  // ruler seek
  $("#ruler").onclick = (e) => {
    const rect = $("#lane-video").getBoundingClientRect();
    seek((e.clientX - rect.left) / pxPerSec);
  };

  // keyboard
  window.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "");
    if (e.code === "Space" && !typing) { e.preventDefault(); setPlaying(!S.playing); }
    else if ((e.key === "Delete" || e.key === "Backspace") && !typing) delClip();
    else if ((e.key === "s" || e.key === "S") && !typing) splitClip();
    else if (e.key === "ArrowLeft" && !typing) seek(S.currentTime - 0.1);
    else if (e.key === "ArrowRight" && !typing) seek(S.currentTime + 0.1);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
  });

  // demo project so first paint isn't empty
  const demoURL = canvasURL(1280, 720, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#1E1B4B"); g.addColorStop(1, "#0E7490");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = "#fff"; x.font = "900 80px Inter,sans-serif"; x.textAlign = "center";
    x.fillText("CLIPCHAD", w / 2, h / 2); x.font = "600 34px Inter,sans-serif"; x.fillStyle = "#FDE047";
    x.fillText("import media to start", w / 2, h / 2 + 60);
  });
  const dm = { id: uid(), kind: "image", name: "Welcome.png", url: demoURL, duration: 6, w: 1280, h: 720 };
  S.media.push(dm);
  elCache.set(dm.id, Object.assign(new Image(), { src: demoURL }));
  S.clips.push({ id: uid(), track: "video", kind: "image", mediaId: dm.id, name: "Welcome", start: 0, duration: 6, offset: 0, vol: 0, speed: 1, fadeIn: 0.4, fadeOut: 0.4, scale: 1, op: 1, x: 0, y: 0, rot: 0, flip: false, fit: "fit", bri: 1, con: 1, sat: 1.1, blur: 0, filter: "none", text: "", font: 64, color: "#fff", anim: "zoom" });
  S.captions.push({ id: uid(), start: 0.5, end: 5.5, text: "Welcome to ClipChad — import media to begin" });

  sizePreview();
  renderAll();
  setTimeout(sizePreview, 300);
  requestAnimationFrame((t) => { lastTs = t; requestAnimationFrame(loop); });
}
document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
