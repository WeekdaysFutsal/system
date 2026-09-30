// ─────────────────────────────────────────────────────────────
// WD_FUTSAL 설정 파일
// Firebase 프로젝트: wd-futsal
// ─────────────────────────────────────────────────────────────
window.WF_CONFIG = {
  // Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성 에서 복사한 값을 붙여넣으세요.
  firebase: {
    apiKey: "AIzaSyCvO0DUvGG0i8gRJ74Ppn1aqUZ3QiG5pFs",
    authDomain: "wd-futsal.firebaseapp.com",
    projectId: "wd-futsal",
    storageBucket: "wd-futsal.firebasestorage.app",
    messagingSenderId: "663428055388",
    appId: "1:663428055388:web:92aaceb1b0c5088176c199"
  },

  // 운영진 모드 비밀번호 (운영진, 기록 담당자에게만 알려 주세요)
  // 주차 추첨 인원
  parkingSlots: 2,

  adminPin: "0000",

  club: { name: "WEEKDAYS FUTSAL CLUB", short: "WF" },

  // 조끼 색 (팀이 완성되면 각 팀 주장이 이 중에서 골라요)
  colors: [
    { name: "BLUE",   color: "#1E46C8" },
    { name: "BLACK",  color: "#16181C" },
    { name: "RED",    color: "#D7263D" },
    { name: "WHITE",  color: "#F2F3F5" },
    { name: "YELLOW", color: "#F5C518" },
    { name: "GREEN",  color: "#1E9E57" }
  ],

  // 새 경기일 기본값
  defaults: {
    time: "21:00",
    venue: "용산 아이파크몰 The Base 7구장",
    capacity: 18,
    // 신청 오픈: 경기 6일 전 13:00, 신청 마감: 경기 2일 전 20:00
    openDays: 6, openTime: "13:00",
    closeDays: 2, closeTime: "20:00",
    notice: "팀 구별에 혼동을 줄 수 있는 색상의 운동복은 {금지!!}"
  },

  // 경기 시간(초): 전반, GK 교체, 후반, 쉬는 시간
  timing: { h1: 360, gk: 3, h2: 360, rest: 180 }
};
