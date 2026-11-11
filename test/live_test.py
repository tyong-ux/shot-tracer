# 가짜 카메라(합성영상 y4m)로 실시간 모드 확인: 카메라 시작 → 공 탭 → 샷 자동 검출
import json, sys, time, subprocess
from playwright.sync_api import sync_playwright
k = int(sys.argv[1]) if len(sys.argv) > 1 else 2
g = json.load(open(f'/home/claude/work/bsim/bsim_{k}.json'))
srv = subprocess.Popen(['python3', '-m', 'http.server', '8766', '-d', '/home/claude/work/app/www'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=/tmp/cam.y4m'])
        ctx = b.new_context(viewport={'width': 430, 'height': 900}, permissions=['camera'])
        ctx.add_init_script("const _g=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia=c=>_g({video:{width:720,height:1280,frameRate:30}});")
        pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://localhost:8766/index.html')
        pg.evaluate("localStorage.setItem('st.settings', JSON.stringify({unit:'mph', club:%s, res:'720'}))" % json.dumps(g['club'])); pg.reload()
        pg.click('footer >> button:has-text("카메라 시작")'); time.sleep(1.2)
        info = pg.evaluate("({vw:video.videoWidth,vh:video.videoHeight,fps:liveFps,st:document.getElementById('status').textContent})"); print('카메라:', info)
        r = pg.evaluate("(()=>{const r=document.getElementById('view').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
        # 공이 티 위에 있는 시점(영상 앞부분)에 탭: 루프 재생이라 타이밍 맞춰 여러 번 시도
        for tr in range(40):
            ph = pg.evaluate("an&&an.state"); t = pg.evaluate("lastT")
            if ph == 'NEED_BALL' and (t % 2.6) < 0.8:
                pg.mouse.click(r[0] + g['tee_px'][0] / 1080 * r[2], r[1] + g['tee_px'][1] / 1920 * r[3])
                time.sleep(0.2); print('탭:', pg.text_content('#status'))
                if pg.evaluate("an.state") == 'READY': break
            time.sleep(0.1)
        t0 = time.time()
        while time.time() - t0 < 12 and not pg.evaluate("SHOTS.length"): time.sleep(0.2)
        res = pg.evaluate("SHOTS.map(s=>s.res?{mph:s.res.mph,launch:s.res.launch,start:s.res.start,carry:s.res.carry,n:s.res.nObs,fps:liveFps,pitch:s.res.pitch}:s)")
        print('정답 %d mph 발사 %.1f 출발 %.1f 캐리 %.0f (fps %d)' % (g['mph'], g['launch'], g['start'], g['carry_m'], g['fps'])); print('실시간:', json.dumps(res, ensure_ascii=False)); print('상태:', pg.text_content('#status'))
        time.sleep(1.0); pg.screenshot(path='/home/claude/real/live_shot.png'); print('errors', errs[:3])
        b.close()
finally: srv.terminate()
