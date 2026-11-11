// 합성 뒤촬영 영상(bsim)으로 JS 코어 검증: ffmpeg로 밝기(Y) 프레임을 받아 실시간처럼 한 장씩 넣음
// 사용: node test/node_test.js [배율 0.5=540x960 | 1=1080x1920] [영상번호...]
const { spawn } = require('child_process'); const fs = require('fs'); const C = require('../www/tracer-core.js');
const scale = parseFloat(process.argv[2] || '0.5'); const ids = process.argv.slice(3).map(Number); const list = ids.length ? ids : [...Array(20)].map((_, i) => i + 1);
function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const gauss = r => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
async function run(k) {
  const g = JSON.parse(fs.readFileSync(`/home/claude/work/bsim/bsim_${k}.json`));
  const W = Math.round(1080 * scale), H = Math.round(1920 * scale), fps = g.fps;
  const an = new C.ShotAnalyzer({ fps, needHead: true }); const R = rng(k * 7 + 3);
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-i', `/home/claude/work/bsim/bsim_${k}.mp4`, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  let acc = Buffer.alloc(0), i = 0, meas = null, set = false; const fsz = W * H * 4;
  for await (const chunk of ff.stdout) {
    acc = Buffer.concat([acc, chunk]);
    while (acc.length >= fsz) {
      const rgba = new Uint8Array(acc.subarray(0, fsz)), y = new Uint8Array(W * H); for (let q = 0, p = 0; q < W * H; q++, p += 4) y[q] = (77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2]) >> 8;
      const fr = { y, rgba, w: W, h: H, i: i++ }; acc = acc.subarray(fsz);
      if (!set) { set = an.setBall(fr, g.tee_px[0] * scale + 1.5 * gauss(R), g.tee_px[1] * scale + 1.5 * gauss(R)); if (!set) return console.log(k, '공 지정 실패'); continue; }   // 사용자가 공을 탭(±1.5px 오차)
      const out = an.push(fr); if (out && out.measurement) meas = out.measurement; if (out && out.error) console.log(k, out.error);
    }
  }
  if (!meas) return console.log(k, '샷 미검출, 상태', an.state, 'pts', an.pts && an.pts.length);
  const f = g.f * scale * (1 + 0.01 * gauss(R)), pitch = g.pitch + gauss(R);          // 앱: 폰 화각(±1%), 기울기 센서(±1°)
  const out = {};
  for (const [name, o] of Object.entries({ A: { club: g.club }, B: { club: g.club, heightM: g.H }, N: {}, D: { club: g.club, distM: Math.hypot(g.d, g.xo) * (1 + 0.05 * gauss(R)) }, P: { club: g.club, pitchDeg: null }, Z: { club: g.club, pitchDeg: 0 } })) {
    const r = C.solveShot(meas, Object.assign({ f, pitchDeg: pitch }, o)); out[name] = r; if (name === 'P') r._pe = r.pitch - g.pitch;
  }
  const e = n => (out[n].mph - g.mph) / g.mph * 100, A = out.A, inr = A.range[0] <= g.mph && g.mph <= A.range[1];
  console.log(`${String(k).padStart(2)} ${g.club.padEnd(6)} 키${g.H} 거리${g.d}m ${fps}fps 공${meas.ball.d.toFixed(1)}px(${(g.ball_diam_px * scale).toFixed(1)}) 점${meas.pts.length} 머리${meas.head ? 'O' : 'X'} | 진짜 ${g.mph} A ${A.mph.toFixed(1)}(${e('A') >= 0 ? '+' : ''}${e('A').toFixed(1)}%)${inr ? '✓' : '✗'} 키입력 ${e('B').toFixed(1)}% 클럽모름 ${e('N').toFixed(1)}% 거리입력 ${e('D').toFixed(1)}% 기울기추정 ${e('P').toFixed(1)}%(발사${out.P.launch.toFixed(1)},기울기오차${out.P._pe.toFixed(1)}°) 기울기0 ${e('Z').toFixed(1)}% | 발사 ${g.launch.toFixed(1)}/${A.launch.toFixed(1)} 출발 ${g.start.toFixed(1)}/${A.start.toFixed(1)} | 캐리 ${g.carry_m.toFixed(0)}/${A.carry.toFixed(0)} [${A.scaleFrom.join('+')}]`);
  return { la2: Math.abs(g.launch - out.P.launch), e: ['A', 'B', 'N', 'D', 'P', 'Z'].map(e), inr, la: Math.abs(g.launch - A.launch), st: Math.abs(g.start - A.start) };
}
(async () => {
  const rows = []; const t0 = Date.now();
  for (const k of list) { const r = await run(k); if (r) rows.push(r); }
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  ['A 기본(클럽 입력)', 'B +키 입력', 'N 아무 입력 없음', 'D +촬영거리 입력', 'P 기울기 모름→추정', 'Z 기울기 모름→0 가정'].forEach((n, j) => { const v = rows.map(r => Math.abs(r.e[j])); console.log(`${n}: 평균 ${mean(v).toFixed(1)}% 최대 ${Math.max(...v).toFixed(1)}%`); });
  console.log(`기울기 추정 시 발사각 오차 평균 ${mean(rows.map(r => r.la2)).toFixed(1)}°`); console.log(`범위 안 정답 ${rows.filter(r => r.inr).length}/${rows.length}, 발사각 오차 평균 ${mean(rows.map(r => r.la)).toFixed(1)}° 출발 ${mean(rows.map(r => r.st)).toFixed(1)}°, ${((Date.now() - t0) / 1000).toFixed(0)}초`);
})();
