/*
 * 합격엿 교문 — site configuration
 * 1) Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹)에서 firebaseConfig 값을 복사해 아래에 붙여 넣으세요.
 * 2) databaseURL은 Realtime Database를 만든 뒤 콘솔 상단에 나오는 주소입니다.
 *    Realtime Database에는 서울 리전이 없어 asia-southeast1(싱가포르)을 권장하며, 이때 주소는
 *    https://프로젝트ID-default-rtdb.asia-southeast1.firebasedatabase.app 형태가 됩니다.
 * 3) shareUrl은 실제 게임 주소(https://...)로 바꾸면 결과 카드에 '공유하기'·'링크 복사'가 생깁니다.
 * 값이 REPLACE_ME인 동안에는 집계 없이 이 기기에서만 동작하는 테스트 모드로 실행됩니다.
 */
window.YEOT_CONFIG = {
  firebase: {
    apiKey: "AIzaSyDRfXd_ZsTdLkR04OmNogBl8QyreW0uwrU",
    authDomain: "hapgyeok-yeot.firebaseapp.com",
    projectId: "hapgyeok-yeot",
    storageBucket: "hapgyeok-yeot.firebasestorage.app",
    messagingSenderId: "988565333852",
    appId: "1:988565333852:web:0330dbca01144209efc399",
    databaseURL: "https://hapgyeok-yeot-default-rtdb.asia-southeast1.firebasedatabase.app"
  },
  shareUrl: "https://h-jun-h.github.io/hapgyeok-yeot/",            // 예: "https://yeot.tasteq.co.kr"
  sdkVersion: "10.12.2",   // Firebase JS SDK 버전
  wallLimit: 60,           // 서버별로 실시간으로 불러올 최근 플레이어 수 (교문에 보이는 엿 수)
  statsIntervalSec: 20,    // 전체 엿 개수·참여자 수를 다시 세는 간격(초)
  debug: false             // true면 콘솔에 내 uid 등 디버그 로그 출력 (관리자 지정할 때 사용)
};
