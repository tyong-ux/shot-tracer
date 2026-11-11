/* 샷 트레이서 앱 화면
 * ① 실시간 촬영: 카메라 화면에서 공을 탭 → 칠 때마다 자동으로 궤적·볼스피드 표시(+녹화 저장)
 * ② 영상 업로드: 공을 탭 → 분석 → 트레이서 입혀 재생/저장. 키·거리·클럽·비거리 입력 시 더 정확
 */
'use strict';
const C = window.TracerCore;
const $ = id => document.getElementById(id);
const view = $('view'), vctx = view.getContext('2d');
const proc = document.createElement('canvas'), pctx = proc.getContext('2d', { willReadFrequently: true });
const video = document.createElement('video'); video.playsInline = true; video.muted = true; video.setAttribute('playsinline', '');
const TEAL = '#00c2b8', NAVY = '#0b1f4b', HOLD = 0.8, FADE = 0.7;

// ───────── 설정(기기 저장) ─────────
const DEF = { unit: 'mph', club: '', height: '', dist: '', shape: 'auto', fmm: '', pitch: '', slow: '', res: '720' };
let S = Object.assign({}, DEF);
try { Object.assign(S, JSON.parse(localStorage.getItem('st.settings') || '{}')); } catch (e) {}
function saveS() { try { localStorage.setItem('st.settings', JSON.stringify(S)); } catch (e) {} }
function bindSettings() {
  for (const k of ['club', 'height', 'dist', 'shape', 'fmm', 'pitch', 'slow']) { const el = $(k); el.value = S[k]; el.onchange = () => { S[k] = el.value; saveS(); onSettingsChanged(); }; }
  for (const [segId, key] of [['unitSeg', 'unit'], ['resSeg', 'res']]) {
    const seg = $(segId); const paint = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === S[key]));
    seg.querySelectorAll('button').forEach(b => b.onclick = () => { S[key] = b.dataset.v; saveS(); paint(); onSettingsChanged(key); }); paint();
  }
}
const num = v => { const x = parseFloat(v); return isFinite(x) && x > 0 ? x : null; };
function solveOpts(extra) {   // 입력값 → 계산 옵션 (빈 칸은 무시)
  const h = num(S.height);
  return Object.assign({
    f: C.focalPx(proc.width, proc.height, num(S.fmm) || 26), club: S.club || null,
    heightM: h ? (h > 3 ? h / 100 : h) : null, distM: num(S.dist), shape: S.shape,
  }, extra || {});
}
function slowK() { return num(S.slow) || 1; }

// ───────── 공통: 화면/분석 해상도, 프레임 꺼내기 ─────────
function sizeFor(vw, vh) {
  const k = Math.min(1, 1080 / Math.min(vw, vh)); view.width = Math.round(vw * k); view.height = Math.round(vh * k);
  const pk = Math.min(1, (+S.res || 720) / Math.min(vw, vh)); proc.width = Math.round(vw * pk); proc.height = Math.round(vh * pk);
}
function grab(src, i, withRGBA) {
  pctx.drawImage(src, 0, 0, proc.width, proc.height);
  const img = pctx.getImageData(0, 0, proc.width, proc.height), d = img.data, n = proc.width * proc.height, y = new Uint8Array(n);
  for (let q = 0, p = 0; q < n; q++, p += 4) y[q] = (77 * d[p] + 150 * d[p + 1] + 29 * d[p + 2]) >> 8;   // 밝기
  return { y, rgba: withRGBA ? d : null, w: proc.width, h: proc.height, i };
}
function status(msg, kind) { const el = $('status'); el.textContent = msg; el.className = kind || ''; el.style.display = msg ? 'block' : 'none'; }
function empty(html) { const el = $('empty'); el.innerHTML = html || ''; el.style.display = html ? 'flex' : 'none'; }
function busy(on, txt, p) { $('busy').style.display = on ? 'flex' : 'none'; if (txt) $('busyTxt').textContent = txt; $('busyBar').firstChild.style.width = ((p || 0) * 100).toFixed(0) + '%'; }
function tapToProc(ev) {
  const r = view.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width * proc.width, y = (ev.clientY - r.top) / r.height * proc.height; return { u: x, v: y };
}

// ───────── 그리기: 트레이서·비거리 라벨·HUD ─────────
function speedText(mph) {
  if (S.unit === 'ms') return [(mph * 0.44704).toFixed(1), 'M/S'];
  if (S.unit === 'kmh') return [String(Math.round(mph * 1.609344)), 'KM/H'];
  return [String(Math.round(mph)), 'MPH'];
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawShot(ctx, shot, tau, alpha) {
  const k = view.width / proc.width, s = view.width / 1080, P = shot.res.path; if (!P.length || alpha <= 0) return;
  let n = 0; while (n < P.length - 1 && P[n + 1].t <= tau) n++;
  ctx.save(); ctx.globalAlpha = alpha; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const last = P[P.length - 1].t, steps = 10;
  for (const pass of [0, 1]) {   // 0: 번짐(글로우), 1: 선
    ctx.shadowColor = pass ? 'transparent' : TEAL; ctx.shadowBlur = pass ? 0 : 22 * s; ctx.strokeStyle = TEAL;
    for (let c = 0; c < steps; c++) {   // 굵기 24→6 으로 가늘어지게 구간별로
      const a = Math.floor(n * c / steps), b = Math.floor(n * (c + 1) / steps); if (b <= a) continue;
      ctx.lineWidth = (24 - 18 * (P[a].t / last)) * s * (pass ? 1 : 1.15);
      ctx.beginPath(); ctx.moveTo(P[a].u * k, P[a].v * k); for (let j = a + 1; j <= b; j++) ctx.lineTo(P[j].u * k, P[j].v * k); ctx.stroke();
    }
  }
  const h = P[n], hx = h.u * k, hy = h.v * k;
  if (tau <= last + HOLD) { ctx.lineWidth = 4 * s; ctx.beginPath(); ctx.arc(hx, hy, 20 * s, 0, 7); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, 7 * s, 0, 7); ctx.fill(); }
  // 공을 따라다니는 비거리(m)
  const txt = Math.round(h.d) + ' M'; ctx.font = `800 ${46 * s}px -apple-system,Roboto,sans-serif`;
  const tw = ctx.measureText(txt).width + 36 * s, th = 66 * s; let lx = hx + 34 * s, ly = hy - th - 26 * s;
  if (lx + tw > view.width - 30 * s) lx = hx - 34 * s - tw;
  lx = Math.min(Math.max(lx, 20 * s), view.width - 20 * s - tw); ly = Math.min(Math.max(ly, 0.095 * view.height + 10 * s), view.height - th - 20 * s);
  roundRect(ctx, lx, ly, tw, th, 10 * s); ctx.fillStyle = 'rgba(11,31,75,.92)'; ctx.fill(); ctx.lineWidth = 3 * s; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, lx + tw / 2, ly + th / 2 + 2 * s);
  ctx.restore();
}
function drawHUD(ctx, res, appear, alpha) {   // 왼쪽 위: 스윙패스/출발/발사각/구질 + BALL SPEED
  const s = view.width / 1080, Wg = Math.round(0.36 * view.width), e = 1 - Math.pow(1 - Math.min(1, Math.max(0, appear)), 3);
  const x0 = 40 * s - (Wg + 60 * s) * (1 - e), y0 = 0.105 * view.height; if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.textBaseline = 'middle';
  const lr = v => (v > 0.05 ? 'R ' : v < -0.05 ? 'L ' : '') + Math.abs(v).toFixed(1) + '°';
  const pathTxt = Math.abs(res.swingPath).toFixed(1) + '° ' + (res.swingPath > 0.05 ? 'IN-OUT' : res.swingPath < -0.05 ? 'OUT-IN' : '');
  const rows = [['PATH', pathTxt.trim()], ['START', lr(res.start)], ['LAUNCH', res.launch.toFixed(1) + '°'], ['SHAPE', res.shape]];
  const rh = Wg * 0.125; let y = y0;
  for (const [k, v] of rows) {
    ctx.fillStyle = 'rgba(11,31,75,.85)'; ctx.fillRect(x0, y, Wg, rh); ctx.fillStyle = TEAL; ctx.fillRect(x0, y, Math.max(4, Wg * 0.018), rh);
    ctx.font = `700 ${rh * 0.36}px -apple-system,Roboto,sans-serif`; ctx.fillStyle = '#bfcde6'; ctx.textAlign = 'left'; ctx.fillText(k, x0 + Wg * 0.06, y + rh / 2);
    ctx.font = `800 ${rh * 0.46}px -apple-system,Roboto,sans-serif`; ctx.fillStyle = k === 'SHAPE' ? '#78e6dc' : '#fff'; ctx.textAlign = 'right'; ctx.fillText(v, x0 + Wg * 0.96, y + rh / 2);
    y += rh + 3 * s;
  }
  y += 7 * s; const h1 = Wg * 0.115, h2 = Wg * 0.2;
  ctx.fillStyle = '#fff'; ctx.fillRect(x0, y, Wg, h1); ctx.fillStyle = NAVY; ctx.textAlign = 'center'; ctx.font = `800 ${h1 * 0.58}px -apple-system,Roboto,sans-serif`; ctx.fillText('BALL SPEED', x0 + Wg / 2, y + h1 / 2);
  ctx.fillRect(x0, y + h1, Wg, h2);
  const [nm, un] = speedText(res.mph); ctx.font = `800 ${h2 * 0.66}px -apple-system,Roboto,sans-serif`; const wn = ctx.measureText(nm).width;
  ctx.font = `800 ${h2 * 0.34}px -apple-system,Roboto,sans-serif`; const wu = ctx.measureText(' ' + un).width; const xs = x0 + (Wg - wn - wu) / 2;
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = `800 ${h2 * 0.66}px -apple-system,Roboto,sans-serif`; ctx.fillText(nm, xs, y + h1 + h2 * 0.52);
  ctx.font = `800 ${h2 * 0.34}px -apple-system,Roboto,sans-serif`; ctx.fillText(' ' + un, xs + wn, y + h1 + h2 * 0.64);
  ctx.restore();
}
/** 영상 시각 t(초)에 맞춰 모든 샷 그리기. 끝났으면 false */
function drawOverlays(ctx, shots, tVid, keepHud) {
  let active = false, hudShot = null;
  for (const sh of shots) {
    if (!sh.res) continue;
    const tau = (tVid - sh.impactVid) / sh.slow; if (tau < 0) continue;
    const end = sh.res.hang + HOLD, al = tau <= end ? 1 : Math.max(0, 1 - (tau - end) / FADE);
    if (al > 0) { drawShot(ctx, sh, tau, al); active = true; }
    if (al > 0 || keepHud) hudShot = { sh, tau, al: keepHud ? 1 : al };
  }
  if (hudShot) drawHUD(ctx, hudShot.sh.res, (hudShot.tau - 0.12) / 0.45, hudShot.al);
  return active;
}

// ───────── 결과 목록(샷마다 비거리·구질 입력해 다시 계산) ─────────
let SHOTS = [];
function renderResults() {
  const box = $('results'); box.innerHTML = '';
  if (!SHOTS.length) { box.innerHTML = '<p class="help">아직 결과가 없어요.</p>'; return; }
  SHOTS.forEach((sh, k) => {
    const d = document.createElement('div'); d.className = 'shot';
    if (sh.error) { d.innerHTML = `<b>샷 ${k + 1}</b> — ${sh.error}`; box.appendChild(d); return; }
    const r = sh.res, [nm, un] = speedText(r.mph), [lo] = speedText(r.range[0]), [hi] = speedText(r.range[1]);
    d.innerHTML = `<div style="display:flex;justify-content:space-between"><b>샷 ${k + 1}</b><span style="color:var(--sub);font-size:12px">신뢰도 ${r.confidence} · 추적 ${r.nObs}점</span></div>
      <div class="big">${nm} <small style="font-size:14px">${un}</small> <small style="font-size:13px;color:var(--sub)">(${lo}~${hi})</small></div>
      <div class="grid"><div><span>발사각</span>${r.launch.toFixed(1)}°</div><div><span>출발방향</span>${r.start > 0 ? 'R' : 'L'} ${Math.abs(r.start).toFixed(1)}°</div><div><span>구질</span>${r.shape}</div>
      <div><span>캐리</span>${r.carry.toFixed(0)} m</div><div><span>최고 높이</span>${r.apex.toFixed(0)} m</div><div><span>체공</span>${r.hang.toFixed(1)} s</div>
      <div><span>스윙패스(추정)</span>${r.swingPath.toFixed(1)}°</div><div><span>공까지 거리</span>${r.distM.toFixed(1)} m</div><div><span>클럽</span>${sh.opts.club || '모름'}</div></div>
      <div class="redo"><input type="number" inputmode="decimal" placeholder="실제 비거리 m" value="${sh.opts.carryM || ''}"><select><option value="auto">구질 자동</option><option value="draw">드로우</option><option value="fade">페이드</option><option value="straight">스트레이트</option></select><button class="btn" style="flex:0 0 auto;min-width:0;padding:7px 12px">다시 계산</button></div>
      <div class="note">거리 계산: ${r.scaleFrom.join(' + ')}. 스윙패스는 출발방향과 휨으로 거꾸로 추정한 값이에요.</div>`;
    const [inp, sel, btn] = d.querySelectorAll('.redo > *'); sel.value = sh.opts.shape || 'auto';
    btn.onclick = () => { sh.opts = Object.assign({}, sh.opts, { carryM: num(inp.value), shape: sel.value }); sh.res = C.solveShot(sh.meas, sh.opts); renderResults(); if (mode === 'upload') drawStill(); };
    box.appendChild(d);
  });
}
function addShot(meas, impactVid, slow, extra) {
  const opts = solveOpts(extra); let sh;
  try { sh = { meas, opts, res: C.solveShot(meas, opts), impactVid, slow }; } catch (e) { sh = { error: '계산 실패: ' + e.message }; }
  SHOTS.push(sh); renderResults(); return sh;
}

// ───────── ① 실시간 촬영 ─────────
let gyroOK = false, mode = 'live', stream = null, an = null, liveFps = 30, liveT0 = null, lastT = null, dts = [], frameNo = 0, pitchNow = 0, rec = null, recChunks = [], lastFrame = null, liveTimer = null;
window.addEventListener('deviceorientation', e => {   // 폰 기울기(카메라가 아래를 보면 −)
  if (e.beta == null) return; gyroOK = true; const land = window.innerWidth > window.innerHeight;
  pitchNow = land ? Math.abs(e.gamma) - 90 : e.beta - 90;
});
async function askMotion() { try { if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); } catch (e) {} }
async function startLive() {
  stopAll(); mode = 'live'; SHOTS = []; renderResults(); paintTabs();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } } });
  } catch (e) { empty('카메라를 열 수 없어요.<br><small>' + e.message + '</small><br><br>권한을 허용하거나 “영상 업로드”를 써 주세요.'); footLive(false); return; }
  video.srcObject = stream; await video.play();
  sizeFor(video.videoWidth, video.videoHeight); empty(''); an = new C.ShotAnalyzer({ fps: liveFps, needHead: !!num(S.height) });
  liveT0 = null; lastT = null; dts = []; frameNo = 0; footLive(true);
  status('화면에서 공을 탭하세요', 'warn'); loopLive();
}
function loopLive() {
  if (mode !== 'live' || !stream) return;
  const cb = (now, md) => { onLiveFrame(md && md.mediaTime != null ? md.mediaTime : now / 1000); loopLive(); };
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(cb); else liveTimer = requestAnimationFrame(t => cb(t, null));
}
function onLiveFrame(t) {
  if (liveT0 == null) liveT0 = t; t -= liveT0;
  if (lastT != null && t - lastT > 0.002) { dts.push(t - lastT); if (dts.length > 40) dts.shift(); }
  lastT = t;
  if (dts.length >= 10 && an.state === 'NEED_BALL') { liveFps = Math.round(1 / C.median(dts)); an.o.fps = liveFps; }
  const i = Math.round(t * liveFps);
  vctx.drawImage(video, 0, 0, view.width, view.height);
  const fr = grab(video, i, an.state === 'FINISH' && an.o.needHead); lastFrame = fr;
  if (an.state !== 'NEED_BALL') {
    const before = an.state, out = an.push(fr);
    if (before === 'READY' && an.state === 'FLIGHT') { status('추적 중…'); an.pitchAtShot = gyroOK ? pitchNow : null; }   // 센서 없으면 영상에서 추정
    if (out && out.measurement) {
      const sh = addShot(out.measurement, 0, 1, { pitchDeg: an.pitchAtShot });
      if (sh.res) { sh.impactVid = sh.res.impactT; const [nm, un] = speedText(sh.res.mph); status(`${nm} ${un} · ${sh.res.carry.toFixed(0)} m — 다음 공을 같은 자리에`, 'ok'); }
      else status(sh.error, 'warn');
    }
    if (out && out.error) { SHOTS.push({ error: out.error }); renderResults(); status(out.error + ' — 다음 공을 같은 자리에', 'warn'); }
  }
  drawOverlays(vctx, SHOTS, t, true);
  if (an.state === 'READY' && an.tee) {   // 공 위치 표시(작은 원)
    const k = view.width / proc.width; vctx.strokeStyle = 'rgba(0,194,184,.9)'; vctx.lineWidth = 3 * view.width / 1080;
    vctx.beginPath(); vctx.arc(an.tee.u * k, an.tee.v * k, (an.ball.d * 0.5 + 8) * k, 0, 7); vctx.stroke();
  }
  if (an.state === 'REARM' && SHOTS.length && !SHOTS[SHOTS.length - 1].res) status('같은 자리에 공을 올려 주세요', 'warn');
}
function liveTap(ev) {
  if (!lastFrame || !an) return; const p = tapToProc(ev);
  askMotion();
  if (an.setBall(lastFrame, p.u, p.v)) { an.o.needHead = !!num(S.height); status(`준비 완료 (공 ${an.ball.d.toFixed(1)}px) — 치세요!`, 'ok'); }
  else status('공을 못 찾았어요. 공 한가운데를 다시 탭', 'warn');
}
function toggleRec() {
  if (rec) { rec.stop(); return; }
  const mime = pickMime(); recChunks = [];
  rec = new MediaRecorder(view.captureStream(liveFps || 30), mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : undefined);
  rec.ondataavailable = e => e.data.size && recChunks.push(e.data);
  rec.onstop = () => { const b = new Blob(recChunks, { type: rec.mimeType || 'video/webm' }); rec = null; footLive(true); saveBlob(b, fileName(b)); };
  rec.start(500); footLive(true);
}
function footLive(ok) {
  const f = $('foot'); f.innerHTML = '';
  const b1 = mk('btn ' + (rec ? 'rec' : 'main'), rec ? '■ 녹화 정지' : '● 녹화', toggleRec); b1.disabled = !ok;
  const b2 = mk('btn', '공 다시 지정', () => { if (an) { an.state = 'NEED_BALL'; status('화면에서 공을 탭하세요', 'warn'); } }); b2.disabled = !ok;
  f.append(b1, b2);
}

// ───────── ② 영상 업로드 ─────────
let upFps = 30, upAn = null, upReady = false, analyzed = false, upURL = null;
function startUpload() {
  stopAll(); mode = 'upload'; paintTabs(); SHOTS = []; renderResults(); status('');
  empty('📂 영상을 선택하세요<br><small>공 뒤에서 찍은 세로 영상이 가장 정확해요</small>'); footUpload();
}
function footUpload() {
  const f = $('foot'); f.innerHTML = '';
  const row = document.createElement('div'); row.id = 'scrubRow'; row.style.display = video.src && mode === 'upload' ? 'flex' : 'none';
  row.innerHTML = '<span>프레임</span><input type="range" id="scrub" min="0" max="1000" value="0"><span id="scrubT">0.0s</span>';
  f.append(row);
  f.append(mk('btn', '영상 선택', () => $('file').click()));
  const a = mk('btn main', '분석', analyze); a.disabled = !upReady; f.append(a);
  const p = mk('btn', '▶ 재생', () => playOut(false)); p.disabled = !analyzed; f.append(p);
  const s = mk('btn', '저장', () => playOut(true)); s.disabled = !analyzed; f.append(s);
  const sc = $('scrub'); if (sc) sc.oninput = () => { if (video.duration) { video.currentTime = sc.value / 1000 * video.duration; $('scrubT').textContent = video.currentTime.toFixed(1) + 's'; } };
}
$('file').onchange = async () => {
  const f = $('file').files[0]; if (!f) return; stopAll(); mode = 'upload';
  if (upURL) URL.revokeObjectURL(upURL); upURL = URL.createObjectURL(f);
  video.srcObject = null; video.src = upURL; video.load(); SHOTS = []; renderResults(); upReady = false; analyzed = false;
  await new Promise(r => video.onloadedmetadata = r);
  sizeFor(video.videoWidth, video.videoHeight); empty('');
  upFps = await measureFps(); video.currentTime = 0; await seeked(); drawStill();
  status(`${upFps}fps — 공(티 위)을 탭하세요. 필요하면 아래 막대로 프레임 이동`, 'warn'); footUpload();
};
function seeked() { return new Promise(r => { const h = () => { video.removeEventListener('seeked', h); r(); }; video.addEventListener('seeked', h); setTimeout(r, 1500); }); }
async function measureFps() {   // 잠깐 재생하며 프레임 간격 측정
  if (!video.requestVideoFrameCallback) return 30;
  const ts = []; video.playbackRate = 1; await video.play().catch(() => {});
  await new Promise(res => { const cb = (n, md) => { ts.push(md.mediaTime); if (ts.length < 14) video.requestVideoFrameCallback(cb); else res(); }; video.requestVideoFrameCallback(cb); setTimeout(res, 2500); });
  video.pause(); const d = []; for (let k = 1; k < ts.length; k++) if (ts[k] - ts[k - 1] > 1e-4) d.push(ts[k] - ts[k - 1]);
  if (!d.length) return 30; const raw = 1 / Math.min(...d); const c = [24, 25, 30, 48, 50, 60, 90, 120, 240];
  return c.reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
}
function drawStill() { vctx.drawImage(video, 0, 0, view.width, view.height); if (analyzed) drawOverlays(vctx, SHOTS, video.currentTime, false); if (upAn && upAn.tee && !analyzed) { const k = view.width / proc.width; vctx.strokeStyle = TEAL; vctx.lineWidth = 3; vctx.beginPath(); vctx.arc(upAn.tee.u * k, upAn.tee.v * k, (upAn.ball.d / 2 + 8) * k, 0, 7); vctx.stroke(); } }
function upTap(ev) {
  if (!video.src || analyzed) return; const p = tapToProc(ev), fr = grab(video, 0, false);
  upAn = new C.ShotAnalyzer({ fps: upFps * slowK(), needHead: !!num(S.height) });
  if (upAn.setBall(fr, p.u, p.v)) { upReady = true; status(`공 지정 완료 (${upAn.ball.d.toFixed(1)}px) — 분석을 누르세요`, 'ok'); }
  else { upReady = false; status('공을 못 찾았어요. 공 한가운데를 다시 탭', 'warn'); }
  drawStill(); footUpload();
}
/** 2단계 분석: ① 빠르게 재생하며 티 자리만 보고 '공이 사라진 순간'들을 찾고
 *              ② 그 주변 1~2초만 한 프레임씩 정확히 넘기며 추적(프레임 누락 없음) */
const crop = document.createElement('canvas'), cctx = crop.getContext('2d', { willReadFrequently: true });
function grabCrop(tee, R) {   // 티 주변 작은 영역만(빠름)
  const kx = video.videoWidth / proc.width, x0 = Math.max(0, Math.round(tee.u - R)), y0 = Math.max(0, Math.round(tee.v - R)), w = Math.min(proc.width - x0, 2 * R), h = Math.min(proc.height - y0, 2 * R);
  crop.width = w; crop.height = h; cctx.drawImage(video, x0 * kx, y0 * kx, w * kx, h * kx, 0, 0, w, h);
  const d = cctx.getImageData(0, 0, w, h).data, y = new Uint8Array(w * h); for (let q = 0, p = 0; q < w * h; q++, p += 4) y[q] = (77 * d[p] + 150 * d[p + 1] + 29 * d[p + 2]) >> 8;
  return { fr: { y, w, h }, x0, y0 };
}
async function scanImpacts(tee0, ball0, start) {
  const ev = []; let tee = Object.assign({}, tee0), ball = Object.assign({}, ball0), present = true, absent = 0, back = 0, tFirstAbsent = 0;
  const R = Math.max(30, Math.round(ball.d * 4));
  video.currentTime = start; await seeked(); video.playbackRate = 1;
  await new Promise(async res => {
    const cb = (now, md) => {
      const t = md ? md.mediaTime : video.currentTime, c = grabCrop(tee, R), b = C.measureBall(c.fr, tee.u - c.x0, tee.v - c.y0, ball.d / 2);
      const near = b && b.sign === ball.sign && Math.abs(b.d / ball.d - 1) < 0.35;
      if (present) {
        const here = near && Math.hypot(b.u + c.x0 - tee.u, b.v + c.y0 - tee.v) < ball.d * 0.6 && b.area > 0.45 * ball.area;
        if (here) absent = 0; else { if (!absent) tFirstAbsent = t; if (++absent >= 2) { ev.push({ t: tFirstAbsent, tee: Object.assign({}, tee), ball: Object.assign({}, ball) }); present = false; back = 0; } }
      } else if (near && b.area > 0.5 * ball.area) {   // 새 공이 놓임(0.5초 유지) → 위치 갱신
        if (++back >= Math.max(3, Math.round(0.5 * upFps))) { present = true; absent = 0; tee = { u: b.u + c.x0, v: b.v + c.y0 }; ball = Object.assign(ball, { d: b.d, area: b.area, bg: b.bg, pk: b.pk }); }
      } else back = 0;
      busy(true, null, 0.5 * t / video.duration);
      if (!video.ended && !video.paused) video.requestVideoFrameCallback(cb); else res();
    };
    video.onended = () => res();
    video.requestVideoFrameCallback(cb); await video.play();
  });
  video.pause(); video.onended = null; return ev;
}
async function frameAt(i, rgba) { video.currentTime = (i + 0.5) / upFps; await seeked(); return grab(video, i, rgba); }
async function analyze() {
  if (!upReady) return; SHOTS = []; analyzed = false;
  const start = video.currentTime, needHead = !!num(S.height), fpsP = upFps * slowK();
  busy(true, '① 샷 찾는 중…', 0);
  let evs = [];
  if (video.requestVideoFrameCallback) evs = await scanImpacts(upAn.tee, upAn.ball, start);
  else { // 예전 브라우저: 0.1초 간격 탐색으로 대충 찾기
    for (let t = start; t < video.duration; t += 0.1) { video.currentTime = t; await seeked(); const c = grabCrop(upAn.tee, Math.max(30, upAn.ball.d * 4)), b = C.measureBall(c.fr, upAn.tee.u - c.x0, upAn.tee.v - c.y0, upAn.ball.d / 2); if (!b || b.area < 0.45 * upAn.ball.area) { evs.push({ t, tee: upAn.tee, ball: upAn.ball }); break; } }
  }
  const meas = [];
  for (let k = 0; k < evs.length; k++) {   // ② 샷 주변만 한 장씩
    const e = evs[k], a = new C.ShotAnalyzer({ fps: fpsP, needHead });
    a.tee = e.tee; a.ball = Object.assign({}, e.ball); a.base = e.ball.area; a.dHist = [e.ball.d]; a.state = 'READY';
    const iS = Math.max(0, Math.round((e.t - 0.75 * slowK()) * upFps)), iE = Math.round((e.t + (needHead ? 1.2 : 0.62) * slowK()) * upFps);
    let got = null;
    for (let i = iS; i <= iE && !got; i++) {
      busy(true, `② 샷 ${k + 1}/${evs.length} 추적 중…`, 0.5 + 0.5 * (k + (i - iS) / (iE - iS + 1)) / evs.length);
      const out = a.push(await frameAt(i, a.state === 'FINISH' && needHead));
      if (out && (out.measurement || out.error)) got = out;
    }
    if (got) meas.push(got.measurement || { error: got.error });
  }
  busy(true, '궤적 계산 중…', 1); await new Promise(r => setTimeout(r, 30));
  for (const m of meas) {
    if (m.error) { SHOTS.push({ error: m.error }); continue; }
    const sh = addShot(m, 0, slowK(), { pitchDeg: S.pitch === '' || S.pitch == null ? null : parseFloat(S.pitch) });   // 비우면 영상에서 추정
    if (sh.res) sh.impactVid = sh.res.impactT * slowK();
  }
  busy(false); analyzed = true; renderResults();
  const ok = SHOTS.filter(s => s.res).length;
  status(ok ? `샷 ${ok}개 찾음 — ▶ 재생 / 저장` : '샷을 찾지 못했어요. 공을 다시 탭하거나 다른 영상으로', ok ? 'ok' : 'warn');
  video.currentTime = start; await seeked(); drawStill(); footUpload(); if (ok) $('resSheet').style.display = 'block';
}
/** 트레이서를 입혀 재생(저장=true면 녹화해서 파일로). 영상이 끝나도 궤적이 남았으면 마지막 화면을 멈춰 이어 그림 */
async function playOut(save) {
  if (!analyzed) return; status('');
  const first = Math.min(...SHOTS.filter(s => s.res).map(s => s.impactVid));
  const endT = Math.max(...SHOTS.filter(s => s.res).map(s => s.impactVid + (s.res.hang + HOLD + FADE) * s.slow));
  video.currentTime = save ? 0 : Math.max(0, first - 2); await seeked();
  let recorder = null, chunks = [];
  if (save) {
    const mime = pickMime(), st = view.captureStream(upFps);
    try { const vs = video.captureStream ? video.captureStream() : null; if (vs) vs.getAudioTracks().forEach(t => st.addTrack(t)); } catch (e) {}
    recorder = new MediaRecorder(st, mime ? { mimeType: mime, videoBitsPerSecond: 12e6 } : undefined);
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data); recorder.start(500); video.muted = false;
    busy(true, '영상 만드는 중…', 0);
  }
  video.playbackRate = 1;
  await new Promise(async res => {
    const draw = t => { vctx.drawImage(video, 0, 0, view.width, view.height); drawOverlays(vctx, SHOTS, t, false); if (save) busy(true, null, t / Math.max(endT, video.duration)); };
    const cb = (now, md) => { draw(md ? md.mediaTime : video.currentTime); if (!video.ended) video.requestVideoFrameCallback(cb); };
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(cb); else { const raf = () => { draw(video.currentTime); if (!video.ended) requestAnimationFrame(raf); }; requestAnimationFrame(raf); }
    video.onended = () => {   // 영상 뒤 멈춤 화면 연장
      const t0 = performance.now(), base = video.duration;
      const tick = () => { const t = base + (performance.now() - t0) / 1000; draw(t); if (t < endT) requestAnimationFrame(tick); else res(); };
      if (endT > base) requestAnimationFrame(tick); else res();
    };
    await video.play();
  });
  video.onended = null; video.muted = true;
  if (recorder) { await new Promise(r => { recorder.onstop = r; recorder.stop(); }); busy(false); const b = new Blob(chunks, { type: recorder.mimeType || 'video/webm' }); saveBlob(b, fileName(b)); }
}

// ───────── 저장(앱이면 공유 창, 브라우저면 다운로드) ─────────
function pickMime() { const c = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']; return c.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || ''; }
function fileName(b) {
  const r = SHOTS.filter(s => s.res).slice(-1)[0], ext = (b.type || '').includes('mp4') ? 'mp4' : 'webm';
  const sp = r ? speedText(r.res.mph).join('').toLowerCase().replace('/', '') : '';
  return `shot_tracer_${Date.now() % 100000}_${(r && r.opts.club) || 'club'}_${sp}_shorts.${ext}`;
}
async function saveBlob(blob, name) {
  const cap = window.Capacitor;
  if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.Plugins && cap.Plugins.Filesystem) {
    try {
      const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
      const w = await cap.Plugins.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' });
      if (cap.Plugins.Share) await cap.Plugins.Share.share({ title: name, url: w.uri, dialogTitle: '영상 저장/공유' });
      status('저장 완료: ' + name, 'ok'); return;
    } catch (e) { status('저장 실패: ' + e.message, 'warn'); }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  status('다운로드: ' + name, 'ok');
}

// ───────── 탭·버튼 ─────────
function mk(cls, txt, fn) { const b = document.createElement('button'); b.className = cls; b.textContent = txt; b.onclick = fn; return b; }
function paintTabs() { $('tabLive').classList.toggle('on', mode === 'live'); $('tabUp').classList.toggle('on', mode === 'upload'); }
function stopAll() {
  if (rec) { try { rec.stop(); } catch (e) {} }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (liveTimer) cancelAnimationFrame(liveTimer); video.pause();
}
function onSettingsChanged(key) {
  if (key === 'res') { if (mode === 'live') startLive(); else if (video.src) { sizeFor(video.videoWidth, video.videoHeight); upReady = false; analyzed = false; status('해상도 변경 — 공을 다시 탭하세요', 'warn'); drawStill(); footUpload(); } return; }
  if (an) an.o.needHead = !!num(S.height);
  if (analyzed) { SHOTS.forEach(sh => { if (sh.meas) { sh.opts = Object.assign(solveOpts({ pitchDeg: mode === 'upload' ? (S.pitch === '' ? null : parseFloat(S.pitch)) : sh.opts.pitchDeg }), { carryM: sh.opts.carryM, shape: sh.opts.shape !== 'auto' ? sh.opts.shape : S.shape }); sh.res = C.solveShot(sh.meas, sh.opts); if (sh.res) sh.impactVid = sh.res.impactT * sh.slow; } }); renderResults(); drawStill(); }
}
$('tabLive').onclick = startLive; $('tabUp').onclick = startUpload;
$('btnSet').onclick = () => $('setSheet').style.display = 'block'; $('setClose').onclick = () => $('setSheet').style.display = 'none';
$('btnRes').onclick = () => { renderResults(); $('resSheet').style.display = 'block'; }; $('resClose').onclick = () => $('resSheet').style.display = 'none';
['setSheet', 'resSheet'].forEach(id => $(id).addEventListener('click', e => { if (e.target.id === id) $(id).style.display = 'none'; }));
view.addEventListener('click', ev => (mode === 'live' ? liveTap(ev) : upTap(ev)));
video.addEventListener('seeked', () => { if (mode === 'upload' && video.paused) drawStill(); });
bindSettings();
// 첫 화면: 카메라 버튼(브라우저는 사용자 동작 후 카메라 허용)
empty('🎥 <b>실시간 촬영</b><br>공 뒤 2.5~4m에서 세로로 비추고<br>화면의 공을 탭하면 칠 때마다 궤적이 나와요');
footLive(false); $('foot').prepend(mk('btn main', '카메라 시작', startLive));

// 웹/PC에서 '앱 설치'(홈 화면·바탕화면 아이콘)와 오프라인 사용 지원. 네이티브 앱 안에서는 끔
if ('serviceWorker' in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
