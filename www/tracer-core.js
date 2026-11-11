/* ShotTracer 핵심 계산부 (브라우저·Node 공용)
 * - 공 비행 물리(항력·양력·사이드스핀), 핀홀 카메라, 최소제곱(LM) 맞춤
 * - 프레임 분석: 공 지름 측정, 임팩트 감지, 공 추적, (선택) 골퍼 키 측정
 * - 결과: 볼스피드·발사각·출발방향·스핀축·캐리·체공 + 화면에 그릴 궤적
 * 프레임 형식: {y: Uint8Array(밝기), w, h}  (밝기만 써서 빠르고 메모리 적게)
 */
(function (root) {
'use strict';
// ───────── 물리 상수 ─────────
const G = 9.81, MASS = 0.04593, RB = 0.02135, AREA = Math.PI * RB * RB, RHO = 1.2, MPH = 0.44704;
const KL = 0.5 * RHO * AREA / MASS;
// 클럽표: 길이(m), 투어 평균 볼스피드(mph)·발사각(도), 투어 캐리·최고점에 맞춘 항력/양력 계수
const CLUBS = {
  Driver: { v: 167, la: 10.9, cd: 0.21484, cl: 0.15518 },
  '3W':   { v: 158, la: 9.2,  cd: 0.26625, cl: 0.21816 },
  '5i':   { v: 132, la: 12.1, cd: 0.33073, cl: 0.34113 },
  '7i':   { v: 120, la: 16.3, cd: 0.34201, cl: 0.33594 },
  '9i':   { v: 109, la: 20.4, cd: 0.37049, cl: 0.33992 },
  PW:     { v: 102, la: 24.2, cd: 0.36685, cl: 0.30762 },
  SW:     { v: 92,  la: 29.0, cd: 0.31998, cl: 0.21282 },
};

// ───────── 3D 비행 (RK4). 좌표: x 오른쪽, y 위, z 앞(타깃 쪽) ─────────
function simulate(v0, th, ph, cl, side, cd, tmax, dt, stopGround) {
  let vx = v0 * Math.cos(th) * Math.sin(ph), vy = v0 * Math.sin(th), vz = v0 * Math.cos(th) * Math.cos(ph);
  const kd = 0.5 * RHO * cd * AREA / MASS;
  let x = 0, y = 0, z = 0, t = 0;
  const n = Math.ceil(tmax / dt) + 2;
  const T = new Float64Array(n), X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
  let k = 1;
  function acc(vx, vy, vz, o) {
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1e-9;
    let ax = -kd * sp * vx, ay = -G - kd * sp * vy, az = -kd * sp * vz;
    const ux = vx / sp, uy = vy / sp, uz = vz / sp;
    let lx = -uy * ux, ly = 1 - uy * uy, lz = -uy * uz;          // 백스핀 양력: 위쪽(속도에 수직)
    const nl = Math.sqrt(lx * lx + ly * ly + lz * lz); if (nl > 1e-9) { lx /= nl; ly /= nl; lz /= nl; }
    let sx = uz, sz = -ux; const ns = Math.hypot(sx, sz); if (ns > 1e-9) { sx /= ns; sz /= ns; }   // 사이드 양력(휨)
    const kk = KL * cl * sp * sp;
    o[0] = ax + kk * (lx + side * sx); o[1] = ay + kk * ly; o[2] = az + kk * (lz + side * sz);
  }
  const a1 = [0, 0, 0], a2 = [0, 0, 0], a3 = [0, 0, 0], a4 = [0, 0, 0];
  while (t < tmax && k < n) {
    acc(vx, vy, vz, a1);
    const v2x = vx + .5 * dt * a1[0], v2y = vy + .5 * dt * a1[1], v2z = vz + .5 * dt * a1[2]; acc(v2x, v2y, v2z, a2);
    const v3x = vx + .5 * dt * a2[0], v3y = vy + .5 * dt * a2[1], v3z = vz + .5 * dt * a2[2]; acc(v3x, v3y, v3z, a3);
    const v4x = vx + dt * a3[0], v4y = vy + dt * a3[1], v4z = vz + dt * a3[2]; acc(v4x, v4y, v4z, a4);
    const nx = x + dt / 6 * (vx + 2 * v2x + 2 * v3x + v4x), ny = y + dt / 6 * (vy + 2 * v2y + 2 * v3y + v4y), nz = z + dt / 6 * (vz + 2 * v2z + 2 * v3z + v4z);
    vx += dt / 6 * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]); vy += dt / 6 * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]); vz += dt / 6 * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2]);
    t += dt;
    if (stopGround && ny < 0 && t > 0.2) {            // 땅에 닿은 지점(선형 보간)
      const fr = Y[k - 1] / (Y[k - 1] - ny);
      T[k] = T[k - 1] + dt * fr; X[k] = X[k - 1] + (nx - X[k - 1]) * fr; Y[k] = 0; Z[k] = Z[k - 1] + (nz - Z[k - 1]) * fr; k++;
      break;
    }
    x = nx; y = ny; z = nz; T[k] = t; X[k] = x; Y[k] = y; Z[k] = z; k++;
  }
  return { t: T.subarray(0, k), x: X.subarray(0, k), y: Y.subarray(0, k), z: Z.subarray(0, k), dt };
}
function at(tr, tau) {   // 시간 tau의 위치(등간격 보간)
  const n = tr.t.length; if (tau <= 0) return [tr.x[0], tr.y[0], tr.z[0]];
  let i = Math.floor(tau / tr.dt); if (i >= n - 1) return [tr.x[n - 1], tr.y[n - 1], tr.z[n - 1]];
  const f = (tau - tr.t[i]) / ((tr.t[i + 1] - tr.t[i]) || 1);
  return [tr.x[i] + (tr.x[i + 1] - tr.x[i]) * f, tr.y[i] + (tr.y[i + 1] - tr.y[i]) * f, tr.z[i] + (tr.z[i + 1] - tr.z[i]) * f];
}

// ───────── 카메라(핀홀, pitch=위로 든 각도) ─────────
function Cam(f, pitch, W, H) { this.f = f; this.a = pitch; this.cx = W / 2; this.cy = H / 2; this.ca = Math.cos(pitch); this.sa = Math.sin(pitch); }
Cam.prototype.project = function (x, y, z) {
  const yc = y * this.ca - z * this.sa; let zc = z * this.ca + y * this.sa; if (zc < 1e-3) zc = 1e-3;
  return [this.cx + this.f * x / zc, this.cy - this.f * yc / zc, zc];
};
Cam.prototype.ray = function (u, v, zc) {   // 픽셀 (u,v)에서 카메라 깊이 zc 인 점
  const xc = (u - this.cx) / this.f * zc, yc = -(v - this.cy) / this.f * zc;
  return [xc, yc * this.ca + zc * this.sa, zc * this.ca - yc * this.sa];
};

// ───────── 최소제곱(Levenberg–Marquardt, 경계 + soft-L1) ─────────
function solveLin(A, b) {   // 가우스 소거
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]]; const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / d; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}
function invert(A) { const n = A.length; return A.map((_, j) => solveLin(A, A.map((__, i) => (i === j ? 1 : 0)))).map((col, j, cols) => cols.map(c => c[j])); }
function lm(resFn, x0, lo, hi, opt) {
  opt = opt || {}; const sc = opt.scale || x0.map(() => 1), fs = opt.fscale || 2, iters = opt.iters || 50;
  const clip = x => x.map((v, i) => Math.min(hi[i] - 1e-9, Math.max(lo[i] + 1e-9, v)));
  const tf = r => r.map(v => Math.sign(v) * fs * Math.sqrt(2 * (Math.sqrt(1 + (v / fs) * (v / fs)) - 1)));   // soft-L1
  let x = clip(x0.slice()), r = tf(resFn(x)), cost = r.reduce((s, v) => s + v * v, 0), lam = 1e-2, J = null;
  const n = x.length;
  for (let it = 0; it < iters; it++) {
    J = r.map(() => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const h = 1e-4 * sc[j], xp = x.slice(); xp[j] = Math.min(hi[j] - 1e-9, x[j] + h); const hh = xp[j] - x[j] || -h; if (hh < 0) xp[j] = x[j] - h;
      const rp = tf(resFn(xp)); for (let i = 0; i < r.length; i++) J[i][j] = (rp[i] - r[i]) / (xp[j] - x[j]);
    }
    const A = [...Array(n)].map((_, a) => [...Array(n)].map((__, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const g = [...Array(n)].map((_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 8; tries++) {
      const Al = A.map((row, a) => row.map((v, b) => v + (a === b ? lam * (A[a][a] + 1e-9) : 0)));
      const d = solveLin(Al, g.map(v => -v)); const xn = clip(x.map((v, i) => v + d[i]));
      const rn = tf(resFn(xn)), cn = rn.reduce((s, v) => s + v * v, 0);
      if (cn < cost) { x = xn; r = rn; const rel = (cost - cn) / (cost + 1e-12); cost = cn; lam = Math.max(lam / 3, 1e-7); improved = true; if (rel < 1e-7) it = iters; break; }
      lam *= 10;
    }
    if (!improved) break;
  }
  return { x, cost, jac: J, r };
}

// ───────── 영상 측정 ─────────
const median = a => { const s = Float64Array.from(a).sort(); return s.length ? s[s.length >> 1] : 0; };

/** 공 지름(서브픽셀) + 중심 보정 + 공이 배경보다 밝은지(+1)/어두운지(-1) */
function measureBall(fr, u, v, rGuess) {
  const R = Math.max(12, Math.round((rGuess || 10) * 2.6)), W = fr.w, H = fr.h;
  const x0 = Math.round(u) - R, y0 = Math.round(v) - R, S = 2 * R + 1;
  const P = new Float32Array(S * S); const ring = [];
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const xx = Math.min(W - 1, Math.max(0, x0 + i)), yy = Math.min(H - 1, Math.max(0, y0 + j)), val = fr.y[yy * W + xx];
    P[j * S + i] = val; if (i === 0 || j === 0 || i === S - 1 || j === S - 1) ring.push(val);
  }
  const bg = median(ring);
  // 탭한 점 주변 3x3에서 배경과 가장 다른 쪽으로 부호 결정
  let cen = 0; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) cen += P[(R + dj) * S + R + di]; cen /= 25;
  const sign = cen >= bg ? 1 : -1;
  let pk = bg; for (let k = 0; k < P.length; k++) if (sign * (P[k] - pk) > 0) pk = P[k];
  if (Math.abs(pk - bg) < 20) return null;
  // 1차: 절반 이상 덮인 픽셀(코어) → 공 밝기는 코어 중앙값
  const lab = new Uint8Array(S * S); const core = [];
  // 탭 근처에서 시작하는 코어 영역만(다른 물체 제외)
  let seed = -1, best = 1e9;
  for (let k = 0; k < P.length; k++) { const c = sign * (P[k] - bg) / Math.abs(pk - bg); if (c > 0.5) { const d = Math.hypot(k % S - R, (k / S | 0) - R); if (d < best) { best = d; seed = k; } } }
  if (seed < 0 || best > R * 0.8) return null;
  const st = [seed]; lab[seed] = 1;
  while (st.length) {
    const k = st.pop(); core.push(k); const i = k % S, j = k / S | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= S || jj >= S) continue; const kk = jj * S + ii;
      if (!lab[kk] && sign * (P[kk] - bg) / Math.abs(pk - bg) > 0.5) { lab[kk] = 1; st.push(kk); }
    }
  }
  if (core.length > S * S * 0.5) return null;
  const pkc = core.length >= 5 ? median(core.map(k => P[k])) : pk;
  let cx = 0, cy = 0; core.forEach(k => { cx += k % S; cy += k / S | 0; }); cx /= core.length; cy /= core.length;
  const rEst = Math.sqrt(core.length / Math.PI);
  let area = 0;
  for (let k = 0; k < P.length; k++) {
    const i = k % S, j = k / S | 0; if (Math.hypot(i - cx, j - cy) > rEst + 3.5) continue;
    area += Math.min(1.3, Math.max(0, sign * (P[k] - bg) / Math.max(8, Math.abs(pkc - bg))));
  }
  return { u: x0 + cx, v: y0 + cy, d: 2 * Math.sqrt(area / Math.PI), area, sign, bg, pk: pkc };
}

/** 이진 마스크 연결요소(4-이웃) → [{n,sx,sy,sw,minx,maxx,miny,maxy}] */
function components(mask, W, x0, y0, x1, y1, weight) {
  const lab = new Int32Array(mask.length).fill(0), out = []; let id = 0; const st = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const k = y * W + x; if (!mask[k] || lab[k]) continue;
    id++; let c = { n: 0, sw: 0, sx: 0, sy: 0, minx: x, maxx: x, miny: y, maxy: y }; lab[k] = id; st.push(k);
    while (st.length) {
      const q = st.pop(), qx = q % W, qy = (q / W) | 0, w = weight ? weight[q] : 1;
      c.n++; c.sw += w; c.sx += w * qx; c.sy += w * qy;
      if (qx < c.minx) c.minx = qx; if (qx > c.maxx) c.maxx = qx; if (qy < c.miny) c.miny = qy; if (qy > c.maxy) c.maxy = qy;
      const nb = [q - 1, q + 1, q - W, q + W];
      for (let t = 0; t < 4; t++) {
        const p = nb[t], px = p % W, py = (p / W) | 0;
        if (p < 0 || p >= mask.length || px < x0 || px >= x1 || py < y0 || py >= y1) continue;
        if (Math.abs(px - qx) > 1) continue;
        if (mask[p] && !lab[p]) { lab[p] = id; st.push(p); }
      }
    }
    out.push(c);
  }
  return out;
}

/** 원근 예측: u(t),v(t)=(a+bt)/(1+ct) (3D 등속 직선의 화면 투영) */
function perspPred(P, iNext) {
  const t0 = P[P.length - 1].i, out = [];
  for (const key of ['u', 'v']) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
    for (const p of P) { const t = p.i - t0, y = p[key], row = [1, t, -t * y]; for (let a = 0; a < 3; a++) { b[a] += row[a] * y; for (let c = 0; c < 3; c++) A[a][c] += row[a] * row[c]; } }
    for (let a = 0; a < 3; a++) A[a][a] += 1e-6;
    const [aa, bb, cc] = solveLin(A, b), tn = iNext - t0; out.push((aa + bb * tn) / (1 + cc * tn));
  }
  return { u: out[0], v: out[1] };
}

/** 임팩트 직후 프레임들에서 공 궤적 점 찾기
 * frames: [{y,w,h,i}] (i=프레임 번호), ref1=임팩트 직전, ref2=백스윙 중(클럽이 공 근처에 없을 때) */
function trackBall(frames, ref1, ref2, tee, ball) {
  const W = ref1.w, H = ref1.h, sign = ball.sign, r0 = ball.d / 2, n = W * H;
  const ref = new Uint8Array(n);
  for (let k = 0; k < n; k++) ref[k] = sign > 0 ? Math.max(ref1.y[k], ref2.y[k]) : Math.min(ref1.y[k], ref2.y[k]);   // 클럽이 비켜서 바뀐 곳 제외
  const pts = []; let miss = 0; const thr = 10;   // 번진 꼬리는 흐려서 문턱을 낮게
  const mask = new Uint8Array(n), wt = new Float32Array(n), ymax = Math.min(H, Math.round(tee.v + 3 * r0 + 6));
  for (const fr of frames) {
    mask.fill(0);
    for (let y = 0; y < ymax; y++) for (let x = 0; x < W; x++) { const k = y * W + x, d = sign * (fr.y[k] - ref[k]); if (d > thr) { mask[k] = 1; wt[k] = d - 0.5 * thr; } }
    let cand = components(mask, W, 0, 0, W, ymax, wt).filter(c => c.n <= 60 * (2 * r0 + 2) ** 2 && c.sw > 0).map(c => ({ u: c.sx / c.sw, v: c.sy / c.sw, w: c.sw, n: c.n }));
    if (!cand.length) { miss++; if (miss >= 2 && pts.length) break; continue; }
    let c = null;
    if (!pts.length) {
      // 첫 점: 티 위쪽 좁은 원뿔 + 공 꼬리 크기(너무 큰 덩어리=팔·몸 제외), 티 바로 위에 가까울수록 우선
      cand = cand.filter(c => c.v < tee.v - 2.5 * r0 && Math.abs(c.u - tee.u) < 0.4 * (tee.v - c.v) + 4 * r0 && c.w > 8 * r0 && c.n <= 15 * (2 * r0 + 2) ** 2);
      if (!cand.length) { if (fr.i - frames[0].i > 3) break; continue; }
      const sc = c => c.w / (1 + ((c.u - tee.u) / (6 * r0 + 8)) ** 2) / (1 + ((tee.v - c.v) / (60 * r0)) ** 2);
      c = cand.reduce((a, b) => (sc(b) > sc(a) ? b : a));
    } else if (pts.length === 1) {
      const p0 = pts[0]; cand = cand.filter(c => c.v < p0.v - 3 && Math.abs(c.u - p0.u) < 0.4 * (p0.v - c.v) + 4 * r0 && c.n <= 15 * (2 * r0 + 2) ** 2);
      if (!cand.length) { miss++; if (miss >= 3) break; continue; }
      c = cand.reduce((a, b) => (b.w > a.w ? b : a));
    } else {
      const pr = pts.length >= 3 ? perspPred(pts.slice(-4), fr.i) : (() => { const a = pts[pts.length - 2], b = pts[pts.length - 1], k = (fr.i - b.i) * 0.7 / (b.i - a.i); return { u: b.u + (b.u - a.u) * k, v: b.v + (b.v - a.v) * k }; })();
      const up = cand.filter(c => c.v < pts[pts.length - 1].v + 2); if (up.length) cand = up;
      c = cand.reduce((a, b) => (Math.hypot(b.u - pr.u, b.v - pr.v) < Math.hypot(a.u - pr.u, a.v - pr.v) ? b : a));
      const a = pts[pts.length - 2], b = pts[pts.length - 1], step = Math.hypot(b.u - a.u, b.v - a.v) / (b.i - a.i);
      if (Math.hypot(c.u - pr.u, c.v - pr.v) > Math.max(5 * W / 1080, 0.5 * step * (fr.i - b.i))) { miss++; if (miss >= 2) break; continue; }
    }
    miss = 0; pts.push({ i: fr.i, u: c.u, v: c.v });
  }
  return pts;
}

/** 피니시 자세에서 머리 꼭대기(골퍼 키로 거리 추정용). 실패하면 null */
function medU8(arr, start, n, step) {   // 0~255 값의 중앙값(계수 정렬, 빠름)
  const h = new Uint32Array(256); for (let k = 0; k < n; k++) h[arr[start + k * step]]++;
  let c = 0; for (let v = 0; v < 256; v++) { c += h[v]; if (c > n / 2) return v; } return 255;
}
function headTop(fr, tee, mPerPx) {
  const W = fr.w, H = fr.h, m = new Uint8Array(W * H), C = fr.rgba ? 4 : 0;
  for (let y = 0; y < H; y++) {   // 행 중앙값과 크게 다른 픽셀 = 사람(배경은 행마다 비슷). 색 정보가 있으면 R,G,B 각각 비교
    if (C) {
      const base = y * W * 4, md = [0, 1, 2].map(c => medU8(fr.rgba, base + c, W, 4));
      for (let x = 0; x < W; x++) { const q = base + x * 4; m[y * W + x] = (Math.abs(fr.rgba[q] - md[0]) > 30 || Math.abs(fr.rgba[q + 1] - md[1]) > 30 || Math.abs(fr.rgba[q + 2] - md[2]) > 30) ? 1 : 0; }
    } else {
      const md = medU8(fr.y, y * W, W, 1);
      for (let x = 0; x < W; x++) m[y * W + x] = Math.abs(fr.y[y * W + x] - md) > 22 ? 1 : 0;
    }
  }
  const k = Math.max(3, Math.round(0.06 / mPerPx)) | 1, h2 = k >> 1;   // 얇은 클럽 제거(열림 연산)
  const er = new Uint8Array(W * H), tmp = new Uint8Array(W * H);
  const pass = (src, dst, horiz, isMin) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = isMin ? 1 : 0;
      for (let d = -h2; d <= h2; d++) { const xx = horiz ? x + d : x, yy = horiz ? y : y + d; const s = (xx < 0 || yy < 0 || xx >= W || yy >= H) ? 0 : src[yy * W + xx]; if (isMin) { if (!s) { v = 0; break; } } else if (s) { v = 1; break; } }
      dst[y * W + x] = v;
    }
  };
  pass(m, tmp, true, true); pass(tmp, er, false, true); pass(er, tmp, true, false); pass(tmp, m, false, false);
  const comps = components(m, W, 0, 0, W, H, null);
  let best = null;
  for (const c of comps) {
    const h = c.maxy - c.miny; if (h < 0.3 / mPerPx || c.minx > tee.u + 0.2 / mPerPx) continue;
    if (Math.abs(c.maxy - tee.v) > 0.35 / mPerPx) continue;
    const pad = Math.round(0.1 / mPerPx), xa = Math.max(0, c.minx - pad), xb = Math.min(W, c.maxx + pad), gap = Math.round(0.15 / mPerPx);
    let yy = c.miny, g = 0, r = c.miny;
    while (r > 0 && g <= gap) { r--; let cnt = 0; for (let x = xa; x < xb; x++) cnt += m[r * W + x]; if (cnt >= 3) { yy = r; g = 0; } else g++; }
    let sx = 0, n = 0; for (let x = xa; x < xb; x++) if (m[yy * W + x]) { sx += x; n++; }
    if (n && (!best || yy < best.v)) best = { u: sx / n, v: yy };
  }
  return best;
}

// ───────── 3D 비행 맞춤 ─────────
function fitFlight(cam, T, pts, fps, iDep, club, opts) {
  opts = opts || {};
  const c = CLUBS[club] || CLUBS['7i'], cd = c.cd, cl0 = c.cl, la0 = c.la * Math.PI / 180;
  const vPrior = Math.log((opts.vPriorMph || c.v * 0.85) * MPH), laSig = club ? 0.12 : 0.25, vSig = club ? 0.4 : 0.6;
  const tb = [(iDep - 2) / fps, iDep / fps];
  let keep = pts.map((_, k) => k), best = null;
  const lo = [Math.log(15), 2 * Math.PI / 180, -25 * Math.PI / 180, tb[0], -0.5, -0.4], hi = [Math.log(95), 45 * Math.PI / 180, 25 * Math.PI / 180, tb[1], 0.5, 0.4];
  const PF = !!opts.pitchFree, D2R = Math.PI / 180;   // 기울기 모름 → 7번째 변수로 같이 추정(사전값: 폰을 약간 숙임)
  if (PF) { lo.push(-35 * D2R); hi.push(15 * D2R); }
  const camOf = p => (PF ? new Cam(cam.f, p[6], 2 * cam.cx, 2 * cam.cy) : cam);
  const Tof = (p, cm) => (PF ? cm.ray(opts.tee.u, opts.tee.v, opts.zc) : T);
  let resid;
  for (let it = 0; it < 3; it++) {
    const P = keep.map(k => pts[k]), tob = P.map(p => p.i / fps), tmax = Math.max(...tob);
    resid = (p, full) => {
      const v0 = Math.exp(p[0]), tr = simulate(v0, p[1], p[2], cl0 * Math.exp(p[5]), p[4], cd, tmax - p[3] + 0.03, 0.004, false);
      const r = [], cm = camOf(p), TT = Tof(p, cm), pv = [];
      for (let k = 0; k < P.length; k++) { const q = at(tr, Math.max(0, tob[k] - p[3])), pr = cm.project(q[0] + TT[0], q[1] + TT[1], q[2] + TT[2]); r.push(pr[0] - P[k].u); pv.push(pr[1] - P[k].v); }
      r.push(...pv);
      if (full) return r;
      const pri = [(p[1] - la0) / laSig, (p[0] - vPrior) / vSig, p[4] / 0.3, p[5] / 0.12];
      if (PF) pri.push((p[6] - (opts.pitchMu || -6) * D2R) / ((opts.pitchSig || 6) * D2R));
      return r.concat(pri);
    };
    const inits = best ? [best.x] : [];
    if (!best) for (const dv of [0.7, 0.9]) for (const dth of [-4, 0, 4]) { const x0 = [Math.log(c.v * MPH * dv), la0 + dth * Math.PI / 180, 0, (tb[0] + tb[1]) / 2, 0, 0]; if (PF) x0.push((opts.pitchMu || -6) * D2R); inits.push(x0); }
    best = null;
    const scl = [0.2, 0.1, 0.1, 0.005, 0.1, 0.1]; if (PF) scl.push(0.1);
    for (const x0 of inits) { const r = lm(resid, x0, lo, hi, { scale: scl, fscale: 2 }); if (!best || r.cost < best.cost) best = r; }
    const rr = resid(best.x, true), n = P.length, e = [...Array(n)].map((_, k) => Math.hypot(rr[k], rr[n + k]));
    const md = median(e), bad = keep.filter((_, k) => e[k] > Math.max(3 * cam.f / 1380, 4 * md));
    if (!bad.length || n - bad.length < 3) break;
    keep = keep.filter(k => !bad.includes(k));
  }
  const rr = resid(best.x, true), rms = Math.sqrt(rr.reduce((s, v) => s + v * v, 0) / rr.length);
  let sig = 0.05;
  try { const J = best.jac, n = best.x.length, A = [...Array(n)].map((_, a) => [...Array(n)].map((__, b) => J.reduce((s, row) => s + row[a] * row[b], 0) + (a === b ? 1e-9 : 0))); sig = Math.sqrt(Math.max(0, invert(A)[0][0]) * Math.max(1, rms * rms)); } catch (e) {}
  const camF = camOf(best.x);
  return { x: best.x, rms, sigLnV: sig, used: keep.length, cam: camF, T: Tof(best.x, camF), pitch: PF ? best.x[6] / D2R : cam.a / D2R };
}

function carryOf(x, club, side) {
  const c = CLUBS[club] || CLUBS['7i'];
  const tr = simulate(Math.exp(x[0]), x[1], x[2], c.cl * Math.exp(x[5]), side !== undefined ? side : x[4], c.cd, 14, 0.01, true), n = tr.t.length;
  return { carry: Math.hypot(tr.x[n - 1], tr.z[n - 1]), lat: tr.x[n - 1], apex: Math.max(...tr.y), hang: tr.t[n - 1], tr };
}

/** 구질 지정 시 사이드스핀: 반대쪽으로 출발했으면 타깃 라인(정면)으로 돌아오게, 아니면 스핀축 7° */
function sideForShape(x, club, shape) {
  if (!shape || shape === 'auto') return x[4];
  if (shape === 'straight') return 0;
  const sgn = shape === 'draw' ? -1 : 1, start = x[2] * 180 / Math.PI;
  if (sgn * start >= -0.5) return sgn * Math.tan(7 * Math.PI / 180);
  const land = sd => carryOf(x, club, sd).lat;
  let lo = 0, hi = sgn * Math.tan(18 * Math.PI / 180);
  if (land(hi) * land(lo) > 0) return hi;
  for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (land(m) * land(lo) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** 측정값 + 입력값 → 결과
 * m: {W,H,fps,tee:{u,v},ball:{d,...},iDep,pts,head}
 * o: {f(px), pitchDeg, club, heightM, distM, carryM, shape} (모두 선택) */
function solveShot(m, o) {
  o = o || {};
  const club = o.club && CLUBS[o.club] ? o.club : null, clubK = club || '7i';
  const cam = new Cam(o.f, (o.pitchDeg || 0) * Math.PI / 180, m.W, m.H);
  const zcBall = o.f * 2 * RB / m.ball.d, sB = Math.hypot(0.6 / m.ball.d, 0.015);
  const src = [{ name: '공 크기', z: zcBall, s: sB }];
  if (m.head && o.heightM) {   // 키를 입력했을 때만 사용(모르면 1.70 가정은 오히려 오차를 키움 → 검증 결과)
    const Hf = o.heightM * 0.98, B = cam.ray(m.tee.u, m.tee.v, zcBall), d = cam.ray(m.head.u, m.head.v, 1), sc = B[2] / d[2];
    const hgt = d[1] * sc - (B[1] - RB); if (hgt > 0.3) src.push({ name: '키', z: zcBall * Hf / hgt, s: 0.02 });
  }
  if (o.distM) { const B = cam.ray(m.tee.u, m.tee.v, 1); src.push({ name: '촬영 거리', z: o.distM / Math.hypot(B[0], B[2]), s: 0.08 }); }   // 수평거리 → 깊이
  // 신뢰도 가중평균(공 크기와 3σ 이상 어긋나는 값은 제외)
  let wsum = 0, lsum = 0; const used = [];
  for (const s of src) { if (s !== src[0] && Math.abs(Math.log(s.z / zcBall)) > 3 * Math.hypot(s.s, sB)) continue; wsum += 1 / s.s ** 2; lsum += Math.log(s.z) / s.s ** 2; used.push(s.name); }
  let zc = Math.exp(lsum / wsum), sigZ = 1 / Math.sqrt(wsum);
  const pitchFree = o.pitchDeg === null || o.pitchDeg === undefined || o.pitchDeg === '';
  const fitAt = z => { const T = cam.ray(m.tee.u, m.tee.v, z); return fitFlight(cam, T, m.pts, m.fps, m.iDep, club, { pitchFree, zc: z, tee: m.tee }); };
  let F = fitAt(zc);
  let side = sideForShape(F.x, clubK, o.shape);
  if (o.carryM) {   // 실제 비거리를 알면: 거리 배율을 맞춰 캐리를 일치시킴
    let a = 0.5, b = 2.5;
    const cAt = k => { const G_ = fitAt(zc * k); return carryOf(G_.x, clubK, sideForShape(G_.x, clubK, o.shape)).carry - o.carryM; };
    let fa = cAt(a), fb = cAt(b);
    if (fa * fb < 0) { for (let k = 0; k < 14; k++) { const mm = (a + b) / 2, fm = cAt(mm); if (fm * fa > 0) { a = mm; fa = fm; } else { b = mm; fb = fm; } } zc *= (a + b) / 2; F = fitAt(zc); side = sideForShape(F.x, clubK, o.shape); used.push('입력 비거리'); sigZ = 0.03; }
  }
  const x = F.x, mph = Math.exp(x[0]) / MPH;
  const rel = Math.sqrt(sigZ * sigZ + F.sigLnV * F.sigLnV + 0.03 * 0.03);     // 거리·맞춤·화각(±3%)
  const fl = carryOf(x, clubK, side), axis = Math.atan(side) * 180 / Math.PI, start = x[2] * 180 / Math.PI;
  // 화면에 그릴 궤적: 1/240초 간격 투영 + 실측점 잔차를 0.25초 동안 서서히 0으로
  const tr = fl.tr, path = [], t0 = x[3];
  const resU = [], resV = [], tObs = [];
  const camF = F.cam;
  for (const p of m.pts) { const q = at(tr, p.i / m.fps - t0), pr = camF.project(q[0] + F.T[0], q[1] + F.T[1], q[2] + F.T[2]); if (Math.hypot(pr[0] - p.u, pr[1] - p.v) < 12 * m.W / 1080) { tObs.push(p.i / m.fps - t0); resU.push(p.u - pr[0]); resV.push(p.v - pr[1]); } }
  const interp = (t, xs, ys) => { if (!xs.length) return 0; if (t <= xs[0]) return ys[0] * Math.min(1, t / Math.max(xs[0], 1e-3)); for (let k = 1; k < xs.length; k++) if (t <= xs[k]) return ys[k - 1] + (ys[k] - ys[k - 1]) * (t - xs[k - 1]) / (xs[k] - xs[k - 1]); return ys[ys.length - 1] * Math.exp(-(t - xs[xs.length - 1]) / 0.25); };
  for (let t = 0; t <= fl.hang + 1e-9; t += 1 / 240) {
    const q = at(tr, t), pr = camF.project(q[0] + F.T[0], q[1] + F.T[1], q[2] + F.T[2]);
    let u = pr[0] + interp(t, tObs, resU), v = pr[1] + interp(t, tObs, resV);
    const w0 = Math.min(1, t / 0.04); u = m.tee.u + (u - m.tee.u) * w0; v = m.tee.v + (v - m.tee.v) * w0;
    path.push({ t, u, v, d: Math.hypot(q[0], q[2]) });
  }
  const shapeName = a => a < -20 ? 'HOOK' : a < -2 ? 'DRAW' : a > 20 ? 'SLICE' : a > 2 ? 'FADE' : 'STRAIGHT';
  // 스윙패스(추정, D-plane 근사): 출발 ≈ w·페이스+(1-w)·패스, 스핀축 ≈ k·(페이스-패스)
  const wood = clubK === 'Driver' || clubK === '3W', w = wood ? 0.85 : 0.75, kk = wood ? 2.2 : 1.5, f2p = axis / kk, pathDeg = start - w * f2p;
  return {
    mph, range: [mph * Math.exp(-rel), mph * Math.exp(rel)], launch: x[1] * 180 / Math.PI, start, axis, shape: shapeName(axis),
    swingPath: pathDeg, face: pathDeg + f2p, carry: fl.carry, apex: fl.apex, hang: fl.hang, lateral: fl.lat,
    impactT: t0, pitch: F.pitch, pitchEstimated: pitchFree, nObs: m.pts.length, rms: F.rms, distM: zc, scaleFrom: used, confidence: m.pts.length >= 8 && F.rms < 3 ? '높음' : m.pts.length >= 4 ? '보통' : '낮음',
    path,
  };
}

// ───────── 분석기(프레임을 하나씩 넣는 상태 머신: 실시간/업로드 공용) ─────────
function ShotAnalyzer(opts) {
  this.o = Object.assign({ fps: 30, bufferSec: 2.0 }, opts || {});
  this.buf = []; this.state = 'NEED_BALL'; this.tee = null; this.ball = null; this.base = 0; this.low = 0; this.shots = []; this.cool = 0;
}
ShotAnalyzer.prototype.setBall = function (fr, u, v) {   // 사용자가 공을 탭 → 지름 측정
  let best = null;
  for (const r of [6, 10, 16, 24].map(x => x * fr.w / 1080)) { const b = measureBall(fr, u, v, r); if (b && b.d > 2 && (!best || Math.abs(b.d / 2 - r) < Math.abs(best.d / 2 - best.r))) best = Object.assign(b, { r }); }
  if (!best) return false;
  this.tee = { u: best.u, v: best.v }; this.ball = best; this.base = best.area; this.dHist = [best.d]; this.state = 'READY'; this.low = 0; return true;
};
ShotAnalyzer.prototype.push = function (fr) {   // fr: {y,w,h,i}
  const o = this.o; this.buf.push(fr); const maxN = Math.round(o.bufferSec * o.fps) + 4; if (this.buf.length > maxN) this.buf.shift();
  if (this.state === 'READY') {
    const b = measureBall(fr, this.tee.u, this.tee.v, this.ball.d / 2);
    const present = b && Math.hypot(b.u - this.tee.u, b.v - this.tee.v) < this.ball.d * 0.6 && b.sign === this.ball.sign && b.area > 0.45 * this.base;
    if (present) { this.low = 0; if (this.dHist.length < 15) { this.dHist.push(b.d); this.ball.d = median(this.dHist); } }
    else { if (!this.low) this.iDep = fr.i; this.low++; if (this.low >= 3) { this.state = 'FLIGHT'; this.waitUntil = this.iDep + Math.round(0.47 * o.fps); } }
    return null;
  }
  if (this.state === 'FLIGHT' && fr.i >= this.waitUntil) {
    const byI = i => this.buf.find(b => b.i === i);
    const r1 = byI(this.iDep - 3) || this.buf[0], r2 = byI(this.iDep - Math.round(0.6 * o.fps)) || this.buf[0];
    const frames = this.buf.filter(b => b.i >= this.iDep && b.i < this.iDep + Math.round(0.45 * o.fps));
    this.pts = trackBall(frames, r1, r2, this.tee, this.ball);
    this.state = 'FINISH'; this.headUntil = this.iDep + Math.round((o.needHead ? 1.05 : 0.47) * o.fps); this.heads = [];   // 키 입력 없으면 바로 결과
    if (this.pts.length < 2) { this.state = 'REARM'; return this.pts.length ? { error: '공을 충분히 추적하지 못했어요(' + this.pts.length + '점)', iDep: this.iDep } : { rearm: true }; }
    return null;
  }
  if (this.state === 'FINISH') {   // 피니시 자세에서 머리 위치(키 보정용) 몇 번 측정
    if (o.needHead && fr.i >= this.iDep + Math.round(0.75 * o.fps) && fr.i % 2 === 0) { const h = headTop(fr, this.tee, 2 * RB / this.ball.d); if (h) this.heads.push(h); }
    if (fr.i >= this.headUntil) {
      const head = this.heads.length ? this.heads.reduce((a, b) => (b.v < a.v ? b : a)) : null;
      const meas = { W: fr.w, H: fr.h, fps: o.fps, tee: this.tee, ball: this.ball, iDep: this.iDep, pts: this.pts, head };
      this.state = 'REARM'; this.shots.push(meas); return { measurement: meas };
    }
    return null;
  }
  if (this.state === 'REARM') {   // 같은 자리에 새 공이 놓이면 다시 준비
    const b = measureBall(fr, this.tee.u, this.tee.v, this.ball.d / 2);
    if (b && b.sign === this.ball.sign && Math.hypot(b.u - this.tee.u, b.v - this.tee.v) < this.ball.d * 3 && Math.abs(b.d / this.ball.d - 1) < 0.35 && b.area > 0.5 * this.base) {
      this.cool = (this.cool || 0) + 1;
      if (this.cool >= Math.round(0.5 * o.fps)) { this.tee = { u: b.u, v: b.v }; this.ball = Object.assign(this.ball, { d: b.d, bg: b.bg, pk: b.pk }); this.base = b.area; this.dHist = [b.d]; this.state = 'READY'; this.low = 0; this.cool = 0; }
    } else this.cool = 0;
  }
  return null;
};

/** 화각(35mm 환산 mm) → 픽셀 초점거리. 세로영상이면 긴 변 기준 */
function focalPx(W, H, mm) { return Math.max(W, H) * (mm || 26) / 36; }

const api = { MPH, RB, CLUBS, simulate, at, Cam, lm, measureBall, trackBall, headTop, fitFlight, solveShot, carryOf, ShotAnalyzer, focalPx, median };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TracerCore = api;
})(typeof self !== 'undefined' ? self : this);
