// 네이티브 프로젝트에 카메라·센서 권한 추가 (npx cap add 다음에 한 번 실행)
const fs = require('fs');
const man = 'android/app/src/main/AndroidManifest.xml';
if (fs.existsSync(man)) {
  let s = fs.readFileSync(man, 'utf8');
  const add = ['<uses-permission android:name="android.permission.CAMERA" />',
               '<uses-feature android:name="android.hardware.camera" android:required="false" />'];
  for (const l of add) if (!s.includes(l)) s = s.replace('</manifest>', '    ' + l + '\n</manifest>');
  fs.writeFileSync(man, s); console.log('안드로이드 권한 추가 완료');
}
const plist = 'ios/App/App/Info.plist';
if (fs.existsSync(plist)) {
  let s = fs.readFileSync(plist, 'utf8');
  const keys = { NSCameraUsageDescription: '스윙을 촬영해 공 궤적을 그리기 위해 카메라를 사용합니다.',
                 NSMotionUsageDescription: '폰 기울기로 발사각을 정확히 계산하기 위해 사용합니다.',
                 NSPhotoLibraryAddUsageDescription: '트레이서 영상을 사진 앱에 저장하기 위해 사용합니다.' };
  for (const [k, v] of Object.entries(keys)) if (!s.includes(k)) s = s.replace('<dict>', `<dict>\n\t<key>${k}</key>\n\t<string>${v}</string>`);
  fs.writeFileSync(plist, s); console.log('iOS 권한 문구 추가 완료');
}
