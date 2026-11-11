# 헤드리스 크롬으로 업로드 모드 전체 흐름 확인: 영상 선택 → 공 탭 → 분석 → 결과 → 저장(다운로드)
import json, sys, time, subprocess, os
from playwright.sync_api import sync_playwright
k = int(sys.argv[1]) if len(sys.argv) > 1 else 7
g = json.load(open(f'/home/claude/work/bsim/bsim_{k}.json'))
srv = subprocess.Popen(['python3', '-m', 'http.server', '8765', '-d', '/home/claude/work/app/www'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        pg = b.new_page(viewport={'width': 430, 'height': 900}, accept_downloads=True)
        logs = []; pg.on('console', lambda m: logs.append(m.text)); pg.on('pageerror', lambda e: logs.append('ERR ' + str(e)))
        pg.goto('http://localhost:8765/index.html')
        pg.evaluate("localStorage.setItem('st.settings', JSON.stringify({unit:'ms', club:%s, res:'1080'}))" % json.dumps(g['club'])); pg.reload()
        pg.click('#tabUp'); pg.set_input_files('#file', f'/home/claude/work/bsim/bsim_{k}.mp4')
        pg.wait_for_function("document.getElementById('status').textContent.includes('탭')", timeout=20000)
        r = pg.evaluate("(()=>{const r=document.getElementById('view').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
        x = r[0] + g['tee_px'][0] / 1080 * r[2]; y = r[1] + g['tee_px'][1] / 1920 * r[3]
        pg.mouse.click(x, y); time.sleep(0.3); print('탭 후:', pg.text_content('#status'))
        pg.click('footer >> button:has-text("분석")'); pg.wait_for_function("document.getElementById('busy').style.display==='none' && document.getElementById('status').textContent.includes('샷')", timeout=120000)
        print('분석 후:', pg.text_content('#status'))
        res = pg.evaluate("SHOTS.map(s=>s.res?{mph:s.res.mph,launch:s.res.launch,start:s.res.start,carry:s.res.carry,n:s.res.nObs,from:s.res.scaleFrom}:s)")
        print('정답 %d mph, 발사 %.1f, 출발 %.1f, 캐리 %.0f' % (g['mph'], g['launch'], g['start'], g['carry_m'])); print('앱  ', json.dumps(res, ensure_ascii=False))
        pg.click('#resClose'); pg.screenshot(path='/home/claude/real/app_res.png')
        with pg.expect_download(timeout=120000) as dl:
            pg.click('footer >> button:has-text("저장")')
        d = dl.value; out = '/home/claude/real/app_' + d.suggested_filename; d.save_as(out); print('저장 파일:', out, os.path.getsize(out))
        print('\n'.join([l for l in logs if 'ERR' in l][:5]))
        b.close()
finally: srv.terminate()
