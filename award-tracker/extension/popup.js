const $ = (id) => document.getElementById(id);
const fmtBytes = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);
const say = (t) => { $("msg").textContent = t; };

async function refresh() {
  const s = await chrome.runtime.sendMessage({ type: "status" });
  const on = !!(s && s.rec && s.rec.on);
  $("pill").textContent = on ? "● 기록 중" : "멈춤";
  $("pill").className = "pill" + (on ? " on" : "");
  $("toggle").textContent = on ? "기록 멈춤" : "기록 시작";
  $("toggle").className = "btn" + (on ? " rec" : "");
  $("toggle").disabled = false;
  $("count").textContent = s.count ? `기록 ${s.count.toLocaleString("ko-KR")}건 · ${fmtBytes(s.bytes)}` : "아직 기록이 없어요";
  if (!on && s.rec && s.rec.stop_reason) say(s.rec.stop_reason);
  return on;
}

$("toggle").onclick = async () => {
  $("toggle").disabled = true;
  const on = $("toggle").textContent === "기록 멈춤";
  if (on) {
    await chrome.runtime.sendMessage({ type: "stop" });
    say("기록을 멈췄어요. ‘기록 파일 저장 · 관리’에서 파일로 저장하세요.");
  } else {
    const r = await chrome.runtime.sendMessage({ type: "start" });
    say(r && r.tabs
      ? `열려 있는 에어프랑스 탭 ${r.tabs}개에 연결했어요. 지금부터 검색하는 결과가 기록돼요.`
      : "기록을 켰어요. 에어프랑스 사이트를 열고 검색하면 기록돼요.");
  }
  await refresh();
};

$("snap").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: "snap" });
    say(r && r.ok ? "지금 화면의 글자를 저장했어요." : (r && r.reason) || "저장하지 못했어요.");
  } catch {
    say("에어프랑스 탭을 보고 있을 때 눌러 주세요.");
  }
  setTimeout(refresh, 400);
};

$("manage").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("manage.html") });

chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && (ch.count || ch.rec)) refresh(); });
refresh();
