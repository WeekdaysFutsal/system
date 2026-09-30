// ─────────────────────────────────────────────────────────────
// WF 풋살 앱 설정 파일
// Firebase 설정값을 채우기 전에는 "체험 모드"로 동작해요.
// (체험 모드: 이 기기 브라우저에만 저장, 다른 폰과 공유되지 않음)
// ─────────────────────────────────────────────────────────────
window.WF_CONFIG = {
  // Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성 에서 복사한 값을 붙여넣으세요.
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  },

  // 운영진 모드 비밀번호 (운영진, 기록 담당자에게만 알려 주세요)
  adminPin: "0000",

  club: { name: "WEEKDAYS FUTSAL CLUB", short: "WF" },

  // 팀 이름과 조끼 색
  teams: {
    A: { name: "BLUE",  color: "#1E46C8" },
    B: { name: "BLACK", color: "#16181C" },
    C: { name: "WHITE", color: "#F2F3F5" }
  },

  // 새 경기일 기본값
  defaults: {
    time: "21:00",
    venue: "용산 7구장",
    notice: "팀 구별에 혼동을 줄 수 있는 색상의 운동복은 {금지!!}"
  },

  // 경기 시간(초): 전반, GK 교체, 후반, 쉬는 시간
  timing: { h1: 300, gk: 5, h2: 300, rest: 180 }
};
