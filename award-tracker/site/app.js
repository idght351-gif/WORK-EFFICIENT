"use strict";

const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Number(n).toLocaleString("ko-KR");
const MAX_MONTHS = 8; // 노선 한 방향 기간은 최대 8개월 (tools/award.py 와 같은 값)
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const CABIN = { economy: "이코노미", business: "비즈니스" };
const CABIN_ORDER = ["economy"]; // 비즈니스는 2026-11-24 부터 조회 · 표시하지 않음

// ------------------------------------------------------------ 한일 노선 목록
// 서울 SEL(인천·김포) · 도쿄 TYO(나리타·하네다) · 오사카 OSA(간사이·이타미·고베)는 도시 코드로 공항을 한꺼번에 검색해요.
// 대한항공, 그리고 12/17부터 대한항공 편명으로 바뀌는 (구)아시아나 기준이에요. 시즌·감편으로 바뀔 수 있어요.
const AIRPORT = {
  SEL: "서울", TYO: "도쿄", OSA: "오사카·고베",
  ICN: "인천", GMP: "김포", PUS: "부산",
  NRT: "도쿄 나리타", HND: "도쿄 하네다", KIX: "오사카 간사이", ITM: "오사카 이타미", UKB: "고베", NGO: "나고야", FUK: "후쿠오카",
  CTS: "삿포로", OKA: "오키나와", KOJ: "가고시마", KMJ: "구마모토", NGS: "나가사키", OIT: "오이타",
  KMQ: "고마쓰", KIJ: "니가타", SDJ: "센다이", OKJ: "오카야마", AOJ: "아오모리", HIJ: "히로시마",
};
const CATALOG = {
  SEL: ["TYO", "OSA", "NGO", "FUK", "CTS", "OKA", "KOJ", "KMJ", "NGS", "OIT", "KMQ", "KIJ", "SDJ", "OKJ", "AOJ", "HIJ"],
  PUS: ["TYO", "OSA", "FUK", "CTS"],
};
const SEASONAL = new Set(["SEL-NGS", "SEL-OIT", "SEL-KIJ", "SEL-OKJ", "SEL-AOJ", "SEL-HIJ", "PUS-OSA", "PUS-FUK", "PUS-CTS"]);
const cityName = (code) => AIRPORT[code] || code;
const routeTitle = (from, to) => `${cityName(from)} → ${cityName(to)}`;
const inCatalog = (k, j) => !!(CATALOG[k] && CATALOG[k].includes(j));

// ------------------------------------------------------------ 날짜 · 숫자
function parseDate(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function isoOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
const mdDow = (iso) => { const d = parseDate(iso); return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`; };
const kst = (ts) => new Date(new Date(ts).toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
function stamp(ts) {
  if (!ts) return "-";
  const d = kst(ts);
  return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]}) ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function kstToday() { return isoOf(kst(Date.now())); }
function addDays(iso, n) { const d = parseDate(iso); d.setDate(d.getDate() + n); return isoOf(d); }
// 한국 공휴일 (대체공휴일 · 선거일 포함). 추천 일정의 평일 계산에서 빼요. 2028년 이후는 발표되면 덧붙여요.
// 2026년부터 노동절(5/1) · 제헌절(7/17)도 공휴일이고 대체공휴일 대상이에요.
const KR_HOLIDAYS = new Set([
  "2026-12-25",
  // 2027 (우주항공청 2027년 월력요항 기준)
  "2027-01-01", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-03-01", "2027-05-01", "2027-05-03",
  "2027-05-05", "2027-05-13", "2027-06-06", "2027-07-17", "2027-07-19", "2027-08-15", "2027-08-16",
  "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-03", "2027-10-04", "2027-10-09", "2027-10-11",
  "2027-12-25", "2027-12-27",
  // 2028 (아직 월력요항 발표 전, 음력 · 선거일 기준 예상)
  "2028-01-01", "2028-01-26", "2028-01-27", "2028-01-28", "2028-03-01", "2028-04-12", "2028-05-01", "2028-05-02",
  "2028-05-05", "2028-06-06", "2028-07-17", "2028-08-15", "2028-10-02", "2028-10-03", "2028-10-04", "2028-10-05",
  "2028-10-09", "2028-12-25",
]);
const isOffDay = (iso) => { const w = parseDate(iso).getDay(); return w === 0 || w === 6 || KR_HOLIDAYS.has(iso); };
const periodText = (a, b) => `${mdDow(a)} ~ ${mdDow(b)}`;
function monthsBetween(a, b) {
  const out = [];
  if (!a || !b || b < a) return out;
  const s = parseDate(a), e = parseDate(b);
  for (let y = s.getFullYear(), m = s.getMonth(); y < e.getFullYear() || (y === e.getFullYear() && m <= e.getMonth()); m === 11 ? (m = 0, y++) : m++) out.push([y, m]);
  return out;
}
function kMiles(n) {
  if (n == null) return "";
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (Number.isInteger(k) ? String(k) : k.toFixed(1).replace(/\.0$/, "")) + "k";
}
function money(t) {
  if (!t || t.amount == null) return null;
  return !t.currency || t.currency === "KRW" ? `${num(t.amount)}원` : `${num(t.amount)} ${esc(t.currency)}`;
}

// 날짜 칸 상태: unk 조회 전 · none 좌석 없음 · avail 좌석 있음 · hit 목표 이하
function dayState(e, target) {
  if (e === undefined) return "unk";
  if (!e || e.miles == null) return "none";
  return target && e.miles <= target ? "hit" : "avail";
}
// 목표가 없을 때 초록: 기간 최저 + LOW_PCT% 이내 (추천 일정 · 상세 확인 범위와 같은 값)
const LOW_PCT = 20;
// 상세 확인 단계: done 세금까지 확인 · part 편 목록만 보고 세금은 못 읽음(하다 만 것) · null 캘린더 값만
function detailState(e) {
  if (!e || e.miles == null) return null;
  if (e.tax) return "done";
  return e.source === "detail" || e.detail_checked_at || (e.flights && e.flights.length) ? "part" : null;
}
const FRESH_MS = 48 * 3600 * 1000;
function isFresh(e, ref) {
  return !!(e && e.miles != null && e.first_seen && new Date(ref || Date.now()) - new Date(e.first_seen) <= FRESH_MS);
}

function setTopRight(html) { document.getElementById("topright").innerHTML = html; }

async function getJSON(url) {
  const r = await fetch(url + "?t=" + Date.now());
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

const SAMPLE_NOTICE = `<div class="notice"><b>샘플 데이터예요.</b> 화면을 확인하기 위한 예시 숫자예요. 집 PC 조회가 시작되면 실제 결과로 바뀌어요.</div>`;

// ------------------------------------------------------------ 메인: 월 달력
// 보던 노선 · 방향 · 좌석 등급 · 달은 이 기기에만 기억해요 (없어도 잘 동작).
const VIEW_KEY = "award-view";
function loadView() { try { return JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; } catch { return {}; } }
function saveView(v) { try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); } catch {} }

// 탭 이름: "SEL ↔ OSA"처럼 도시 코드로 짧게 (가는 편 · 오는 편을 다 보니 양쪽 화살표). 같은 구간이 둘 이상이면 시작 날짜를 붙여 구분해요.
// 한글 이름은 탭의 title(길게 누르기) · 화면 읽기로 나와요. 중지된 노선은 글자만 흐리게 (표시 없음).
function tabLabel(r, all) {
  const base = `${r.from} ↔ ${r.to}`;
  const dup = all.filter((x) => x.from === r.from && x.to === r.to).length > 1;
  return dup ? `${base} ${mdDow(r.start).replace(/\(.\)/, "")}~` : base;
}

const STOPPED = { running: "조회 중", login_required: "로그인 필요로 멈춤", challenge: "보안 확인으로 멈춤", error: "조회 실패로 멈춤" };

function monthHTML(days, cabin, y, m, a, b, target, selected, ref, min) {
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0).getDate();
  let cells = DOW.map((d, i) => `<div class="cal-dow${i === 0 ? " sun" : ""}" aria-hidden="true">${d}</div>`).join("");
  cells += `<div aria-hidden="true"></div>`.repeat(first.getDay());
  for (let d = 1; d <= last; d++) {
    const iso = isoOf(new Date(y, m, d));
    // 일요일 · 공휴일은 날짜 숫자를 빨간색으로 (토요일은 그대로)
    const red = new Date(y, m, d).getDay() === 0 || KR_HOLIDAYS.has(iso) ? " red" : "";
    if (iso < a || iso > b) { cells += `<div class="day out${red}" aria-hidden="true"><span class="d">${d}</span></div>`; continue; }
    const e = days[iso] ? days[iso][cabin] : undefined;
    let st = dayState(e, target);
    // 목표가 없으면 기간 최저 + LOW_PCT% 이내 = 초록 ("최저" 글자는 진짜 최저에만)
    if (!target && st === "avail" && min != null && e.miles <= min * (100 + LOW_PCT) / 100) st = "hit";
    const label = st === "unk" ? "" : st === "none" ? "–" : kMiles(e.miles);
    const ds = detailState(e);
    const dsText = ds === "done" ? ", 상세 확인" : ds === "part" ? ", 상세 일부 확인" : "";
    const aria = `${m + 1}월 ${d}일${KR_HOLIDAYS.has(iso) ? " 공휴일" : ""} ${st === "unk" ? "조회 전" : st === "none" ? "좌석 없음" : `${num(e.miles)}마일${dsText}`}`;
    const isMin = (st === "hit" || st === "avail") && e.miles === min;
    cells += `<button type="button" class="day ${st}${isMin ? " min" : ""}${red}" data-date="${iso}" aria-pressed="${iso === selected}" aria-label="${aria}"><span class="d">${d}</span><span class="m">${label}</span>${ds ? `<i class="ds ${ds}" aria-hidden="true"></i>` : ""}${isFresh(e, ref) ? `<i class="dot"></i>` : ""}</button>`;
  }
  return `<div class="cal-grid">${cells}</div>`;
}

function stopsText(f) {
  if (f.stops == null) return "";
  return f.stops === 0 ? "직항" : `${f.stops}회 경유${f.via ? ` (${esc(f.via)})` : ""}`;
}

function flightsHTML(fs) {
  if (!fs || !fs.length) return "";
  return `
    <table class="flights">
      <thead><tr><th>편명</th><th>출발–도착</th><th class="r">마일 · 세금</th></tr></thead>
      <tbody>${fs.map((f) => `
        <tr>
          <td><b>${esc(f.no)}</b>${f.operated_by ? `<div class="sub">${esc(f.operated_by)} 운항</div>` : ""}</td>
          <td class="num">${esc(f.dep || "")}–${esc(f.arr || "")}<div class="sub">${[f.from && f.to ? `${esc(f.from)}→${esc(f.to)}` : "", stopsText(f)].filter(Boolean).join(" · ")}</div></td>
          <td class="r num">${f.miles != null ? num(f.miles) : "-"}${money(f.tax) ? `<div class="sub">${money(f.tax)}</div>` : ""}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

// ------------------------------------------------------------ 직접 확인 표시 (좌석 없어짐)
// 사용자가 에어프랑스 사이트에서 직접 보고 "좌석 없어짐" 을 누르면 award-tracker/marks.json 에 한 줄 더해요 (GitHub API).
// 그 push 로 배포 작업이 돌면서 award.py apply-marks 가 앱 데이터에 반영해요 (1~2분). 그동안은 이 기기에서 먼저 보여줘요.
// 토큰은 이 기기(localStorage)에만 저장해요: 이 저장소만, Contents 읽기·쓰기 권한의 fine-grained 토큰.
const GH_KEY = "award-gh-token";
const PENDING_KEY = "award-marks-pending";
const MARKS_PATH = "award-tracker/marks.json";
const ghToken = () => { try { return localStorage.getItem(GH_KEY) || ""; } catch { return ""; } };
function setGhToken(v) { try { v ? localStorage.setItem(GH_KEY, v) : localStorage.removeItem(GH_KEY); } catch {} }
function loadPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; } catch { return []; } }
function savePending(v) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(v)); } catch {} }
function kstStamp(d = new Date()) {   // award.py 의 시각 형식과 같게 (2026-11-25T10:00:00+09:00)
  const k = new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19);
  return `${k}+09:00`;
}
const b64encode = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

async function gh(path, opts = {}) {
  const info = repoInfo() || { owner: "idght351-gif", repo: "flight-tracker" };
  const res = await fetch(`https://api.github.com/repos/${info.owner}/${info.repo}${path}`, {
    ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${ghToken()}`, ...(opts.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) throw new Error("GitHub 토큰이 맞지 않거나 권한(Contents 쓰기)이 없어요");
  return res;
}
async function readMarks() {
  const res = await gh(`/contents/${MARKS_PATH}?ref=main&t=${Date.now()}`);
  if (res.status === 404) return { data: { marks: [] }, sha: null };
  if (!res.ok) throw new Error(`GitHub 읽기 실패 (${res.status})`);
  const j = await res.json();
  return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
}
// change(marks) → 새 marks. 다른 기기와 동시에 쓰면(sha 충돌) 한 번 더 읽어서 다시 써요.
async function writeMarks(change, message) {
  for (let i = 0; i < 3; i++) {
    const { data, sha } = await readMarks();
    const body = { message, branch: "main", content: b64encode(JSON.stringify({ ...data, marks: change(data.marks || []) }, null, 1) + "\n") };
    if (sha) body.sha = sha;
    const res = await gh(`/contents/${MARKS_PATH}`, { method: "PUT", body: JSON.stringify(body) });
    if (res.ok) return;
    if (res.status !== 409 && res.status !== 422) throw new Error(`GitHub 저장 실패 (${res.status})`);
  }
  throw new Error("다른 저장과 겹쳤어요. 잠시 뒤 다시 눌러 주세요");
}
const sameMark = (a, b) => a.route_id === b.route_id && a.direction === b.direction && a.date === b.date && (a.cabin || "economy") === (b.cabin || "economy");

// 아직 앱 데이터에 반영 전인 표시를 이 기기에서 먼저 보여줘요. 반영됐거나 1시간 지난 것은 지워요.
function overlayPending(p, days) {
  const cur = (days[p.date] || {})[p.cabin];
  if (p.action === "gone") {
    const before = cur ? (cur.source === "manual" ? cur.manual_before : cur) : null;
    (days[p.date] = days[p.date] || {})[p.cabin] = { miles: null, checked_at: p.at, source: "manual", pending: true, ...(before ? { manual_before: before } : {}) };
  } else if (cur && cur.source === "manual") {
    if (cur.manual_before) days[p.date][p.cabin] = { ...cur.manual_before, pending: true };
    else delete days[p.date][p.cabin];
  }
}
function applyPending(rid, dirs) {
  const now = Date.now();
  const keep = loadPending().filter((p) => {
    if (now - new Date(p.at).getTime() > 3600 * 1000) return false;
    const days = p.route_id === rid && (dirs[p.direction] || {}).days;
    if (!days) return true;   // 다른 노선 표시는 그대로 둠
    const cur = (days[p.date] || {})[p.cabin];
    const reflected = p.action === "gone"
      ? !!cur && ((cur.source === "manual" && cur.checked_at === p.at) || (cur.source !== "manual" && (cur.checked_at || "") >= p.at))
      : !cur || cur.source !== "manual" || cur.checked_at > p.at;
    if (reflected) return false;
    overlayPending(p, days);
    return true;
  });
  savePending(keep);
}

// 이 날짜 다시 조회: 요청 문장을 만들어 복사해요. 사용자가 Claude 대화창(집 PC 세션)에 보내면
// PC 의 Claude 가 refresh 명령으로 그 날짜만 다시 조회해요 (PLAYBOOK 7장). 앱이 PC 를 직접 부르지는 않아요.
const DIR_NAME = { out: "가는 편", back: "오는 편" };
function refreshText(rid, dir, iso, from, to) {
  return `마일 좌석 다시 조회: ${routeTitle(from, to)} ${DIR_NAME[dir]} ${mdDow(iso)}\n`
    + `python award-tracker/tools/award.py refresh ${rid} ${dir} ${iso}`;
}

function dayHTML(iso, cabin, e, target, from, to, ref, rid, dir) {
  const d = parseDate(iso);
  const title = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]}) · ${CABIN[cabin]}`;
  let body;
  if (e === undefined) {
    body = `<p class="muted dd-empty">아직 조회하지 않은 날짜예요.</p>`;
  } else if (e.miles == null && e.source === "manual") {
    const before = e.manual_before;
    body = `<p class="dd-empty"><b>좌석 없음</b> <span class="badge">직접 확인</span>${e.pending ? ` <span class="muted small">앱에 반영 중…</span>` : ""}</p>
      <p class="muted small" style="margin:2px 0 0">${stamp(e.checked_at)} 사이트에서 직접 확인${before && before.miles != null ? ` · 그전 조회 ${num(before.miles)}마일 (${stamp(before.checked_at)})` : ""}</p>`;
  } else if (e.miles == null) {
    body = `<p class="dd-empty"><b>좌석 없음</b></p><p class="muted small" style="margin:2px 0 0">${stamp(e.checked_at)} 확인</p>`;
  } else {
    const tax = money(e.tax);
    let change = "";
    if (e.prev_miles != null && e.prev_miles !== e.miles) {
      const down = e.miles < e.prev_miles;
      change = `<span class="${down ? "down" : "up"}">${num(e.prev_miles)} → ${num(e.miles)} ${down ? "▼" : "▲"}${num(Math.abs(e.miles - e.prev_miles))}</span>`;
    }
    body = `
      <div class="dd-miles"><b class="num">${num(e.miles)}</b><span>마일</span>
        ${target && e.miles <= target ? `<span class="badge good">목표 이하</span>` : ""}
        ${isFresh(e, ref) ? `<span class="badge info">새로 열림</span>` : ""}</div>
      <div class="info-row"><span>추가 비용 (세금·유류할증료)</span><span>${tax ? `<b>${tax}</b>` : `<span class="muted">상세 확인 전</span>`}</span></div>
      ${e.seats != null ? `<div class="info-row"><span>남은 좌석</span><span>${typeof e.seats === "string" ? e.seats : num(e.seats)}석</span></div>` : ""}
      ${change ? `<div class="info-row"><span>지난 조회 대비</span><span>${change}</span></div>` : ""}
      ${e.first_seen ? `<div class="info-row"><span>처음 본 때</span><span>${stamp(e.first_seen)}</span></div>` : ""}
      <div class="info-row"><span>확인</span><span>${detailState(e) === "done" ? "편 상세까지 확인"
        : detailState(e) === "part" ? `상세 일부만 확인 · 세금은 아직 못 읽었어요${e.detail_checked_at ? ` (${stamp(e.detail_checked_at)})` : ""}`
        : e.detail_checked_at ? `캘린더 값 · 세금은 ${stamp(e.detail_checked_at)} 상세 확인 때 값` : "캘린더 값 · 세금은 상세 확인 때"}<br><span class="muted small">${stamp(e.checked_at)}</span></span></div>
      ${flightsHTML(e.flights)}`;
  }
  return `
    <section class="card" id="day-card">
      <div class="dd-head"><h3 class="section-title">${title}</h3><span class="muted small">${esc(from)} → ${esc(to)}</span></div>
      ${body}
      ${rid && iso >= kstToday() ? `<div class="refresh">
        <button class="btn line" id="refresh-btn" type="button" data-text="${esc(refreshText(rid, dir, iso, from, to))}">↻ 이 날짜 다시 조회</button>
        <div id="refresh-out" hidden></div>
        ${e && e.source === "manual"
          ? `<button class="btn line" id="mark-btn" type="button" data-action="undo">↩ 직접 확인 표시 되돌리기</button>`
          : e && e.miles != null ? `<button class="btn line warn" id="mark-btn" type="button" data-action="gone">✕ 사이트에서 좌석 없어진 것 확인</button>` : ""}
        <div id="mark-out" class="muted small" hidden></div></div>` : ""}
    </section>`;
}

// ------------------------------------------------------------ 추천 일정 (왕복 노선)
// 조회된 날짜만 써요. 방향마다 기간 최저 마일 + TRIP_PCT% 이내인 날끼리 n박으로 짝지어요.
// 가는 편 · 오는 편 모두 상세(편 목록)까지 확인한 날만 추천해요. 기준 최저 마일은 캘린더 값까지 포함해요.
// 여행 기간(출발일~귀국일)에 든 평일(주말 · 공휴일 제외)이 TRIP_WEEKDAYS 일 이하인 일정만 추천해요
// (2박 1일 · 3박 2일 · 4박 3일 · 5박 4일). 그 안에서 쉬는 날에 얼마나 가까운지로 순서를 정해요.
//   거리: 출발일부터 첫 쉬는 날 전까지의 평일 수 (토 0 · 금 1 · 목 2 …),
//         마지막 쉬는 날 다음부터 귀국일까지의 평일 수 (일 0 · 월 1 · 화 2 …). TRIP_NEAR 일 이내면 "가깝다".
//   예) 2/26(금)~3/1(월) 은 3/1 이 공휴일이라 평일 1일 · 귀국 쪽 거리 0 이에요.
//   1) 출발 · 귀국 둘 다 가까운 일정 → 하나만 가까운 일정 (둘 다 멀면 빼요)
//   2) 더 가까운 쪽의 거리  3) 같으면 출발 쪽이 가까운 일정 먼저  4) 다른 쪽도 가까운 순  5) 마일 적은 순.
//   최대 TRIP_MAX 개만 보여줘요.
const TRIP_PCT = LOW_PCT;
const TRIP_NIGHTS = [2, 3, 4, 5]; // 6박 이상은 평일 상한(4일)을 늘 넘어서 빼요
const TRIP_MAX = 8;
const TRIP_NEAR = 2;
const TRIP_WEEKDAYS = (nights) => Math.min(nights - 1, 4);
function tripRank(go, nights) {
  const days = Array.from({ length: nights + 1 }, (_, i) => addDays(go, i));
  const off = days.map(isOffDay);
  if (off.filter((x) => !x).length > TRIP_WEEKDAYS(nights)) return null;  // 평일이 상한보다 많으면 제외
  const g = off.indexOf(true);                 // 출발 쪽: 첫 쉬는 날 전까지의 평일 수
  const r = nights - off.lastIndexOf(true);    // 귀국 쪽: 마지막 쉬는 날 뒤의 평일 수
  const far = (g > TRIP_NEAR ? 1 : 0) + (r > TRIP_NEAR ? 1 : 0);
  if (far === 2) return null;
  return { far, gap: Math.min(g, r), side: g <= r ? 0 : 1, other: Math.max(g, r) };
}
function tripPlans(dirs, r, cabin, nights) {
  const pick = (key, a, b) => {
    const days = (dirs[key] && dirs[key].days) || {};
    const got = {};
    for (const [iso, d] of Object.entries(days)) {
      const e = d && d[cabin];
      if (iso >= a && iso <= b && e && e.miles != null) got[iso] = e;
    }
    const vals = Object.values(got).map((e) => e.miles);
    const low = vals.length ? Math.min(...vals) : null;
    return { got, low, limit: low == null ? null : low * (100 + TRIP_PCT) / 100 };
  };
  const out = pick("out", r.start, r.end);
  const back = pick("back", r.return_start, r.return_end);
  const plans = [];
  if (out.low == null || back.low == null) return { plans, out, back };
  for (const [iso, eo] of Object.entries(out.got)) {
    if (eo.miles > out.limit || !detailState(eo)) continue;
    const ret = addDays(iso, nights);
    const eb = back.got[ret];
    if (!eb || eb.miles > back.limit || !detailState(eb)) continue;
    const rank = tripRank(iso, nights);
    if (!rank) continue;
    plans.push({ go: iso, ret, eo, eb, rank, total: eo.miles + eb.miles });
  }
  const k = (p) => [p.rank.far, p.rank.gap, p.rank.side, p.rank.other, p.total];
  plans.sort((x, y) => k(x).map((v, i) => v - k(y)[i]).find((d) => d) || (x.go < y.go ? -1 : 1));
  return { plans, out, back };
}

// 그날 최저 마일 편들의 실제 공항 (예: "GMP→KIX · ICN→UKB"). 상세를 안 본 날은 도시 코드만 흐리게.
function legAirports(e, from, to) {
  const fs = (e.flights || []).filter((f) => f.from && f.to && f.miles === e.miles);
  const pairs = [...new Set(fs.map((f) => `${f.from}→${f.to}`))];
  if (!pairs.length) return `<span class="ap">${esc(from)}→${esc(to)}</span>`;
  return pairs.map((x) => `<span class="ap">${esc(x)}</span>`).join("");
}

function tripHTML(dirs, r, cabin, nights) {
  const { plans, out, back } = tripPlans(dirs, r, cabin, nights);
  const opts = TRIP_NIGHTS.map((n) => `<option value="${n}"${n === nights ? " selected" : ""}>${n}박 ${n + 1}일</option>`).join("");
  let body;
  if (out.low == null || back.low == null) {
    body = `<p class="muted small">가는 편 · 오는 편이 모두 조회돼야 추천할 수 있어요.</p>`;
  } else if (!plans.length) {
    body = `<p class="muted small">추천 일정이 없습니다.</p>`;
  } else {
    // 가는 편은 왼쪽, 오는 편은 오른쪽. 마일 · 설명 글은 넣지 않아요 (모두 최저 마일 근처 일정이라).
    const cell = (iso, e, a, b) => `<div class="trip-cell"><b>${mdDow(iso)}</b><div class="aps">${legAirports(e, a, b)}</div></div>`;
    body = `<div class="trip-head"><span>가는 편</span><span>오는 편</span></div>
      <ul class="trips">${plans.slice(0, TRIP_MAX).map((p) => `<li class="trip">${cell(p.go, p.eo, r.from, r.to)}${cell(p.ret, p.eb, r.to, r.from)}</li>`).join("")}</ul>`;
  }
  return `
    <section class="card" id="trip-card">
      <div class="dd-head"><h3 class="section-title">추천 일정</h3>
        <label class="trip-pick">여행 일자 <select id="nights">${opts}</select></label></div>
      ${body}
    </section>`;
}

async function renderMain(want) {
  setTopRight("");
  let index;
  try { index = await getJSON("data/index.json"); } catch { index = { routes: [] }; }
  const routes = index.routes || [];
  if (!routes.length) {
    $app.innerHTML = `
      <div class="card empty">
        <p>아직 추적 중인 노선이 없어요.</p>
        <p class="muted small">한일 노선을 골라 routes.json 에 넣으면, 집 PC에서 조회한 뒤 여기 달력에 보여요.</p>
      </div>
      <a href="#add" class="btn">+ 노선 추가하기</a>`;
    return;
  }

  const saved = loadView();
  const pickable = (id) => id && routes.some((r) => r.id === id);
  const rid = pickable(want) ? want : pickable(saved.route) ? saved.route : (routes.find((r) => r.active !== false) || routes[0]).id;
  let doc;
  try { doc = await getJSON(`data/routes/${encodeURIComponent(rid)}.json`); }
  catch { doc = { route: routes.find((r) => r.id === rid), directions: {} }; }
  const r = doc.route;
  const dirs = doc.directions || {};
  applyPending(rid, dirs);
  const round = !!(r.return_start && dirs.back);
  const cabins = CABIN_ORDER.filter((c) => (r.cabins || []).includes(c));
  const same = saved.route === rid;
  const st = {
    dir: same && saved.dir === "back" && round ? "back" : "out",
    cabin: same && cabins.includes(saved.cabin) ? saved.cabin : cabins[0] || "economy",
    month: same ? saved.month : null,
    day: null,
    nights: TRIP_NIGHTS.includes(saved.nights) ? saved.nights : 2,
  };
  const span = () => (st.dir === "back" ? [r.return_start, r.return_end] : [r.start, r.end]);
  const monthList = () => monthsBetween(...span()).map(([y, m]) => `${y}-${String(m + 1).padStart(2, "0")}`);
  const fitMonth = () => {
    const list = monthList();
    if (!list.includes(st.month)) {
      const now = kstToday().slice(0, 7);
      st.month = list.find((x) => x >= now) || list[0];
    }
  };
  fitMonth();

  const runner = index.runner || {};
  const stopped = STOPPED[runner.status] ? ` · ${STOPPED[runner.status]}` : "";
  const target = () => (r.target_miles || {})[st.cabin];

  $app.innerHTML = `
    ${index.sample ? SAMPLE_NOTICE : ""}
    <div class="route-tabs" role="tablist" aria-label="노선" id="routes">
      ${routes.map((x) => `
        <button type="button" role="tab" class="route-tab${x.active === false ? " paused" : ""}" data-route="${esc(x.id)}"
          aria-selected="${x.id === rid}" title="${esc(x.name || routeTitle(x.from, x.to))}"
          aria-label="${esc((x.name || routeTitle(x.from, x.to)) + (x.active === false ? " (중지)" : ""))}">${esc(tabLabel(x, routes))}</button>`).join("")}
      <a class="route-tab add" href="#add" aria-label="노선 추가">+ 노선</a>
    </div>
    ${round ? `
      <div class="seg" role="group" aria-label="방향" id="dirs">
        <button type="button" data-dir="out">가는 편<span class="sub">${esc(r.from)} → ${esc(r.to)}</span></button>
        <button type="button" data-dir="back">오는 편<span class="sub">${esc(r.to)} → ${esc(r.from)}</span></button>
      </div>` : ""}
    ${cabins.length > 1 ? `<div class="chips" id="cabins" role="group" aria-label="좌석 등급">${cabins.map((c) => `<button type="button" class="chip" data-cabin="${c}">${CABIN[c]}</button>`).join("")}</div>` : ""}
    <section class="card cal-card">
      <div class="cal-nav">
        <button type="button" class="nav-btn" id="prev" aria-label="이전 달">‹</button>
        <div class="cal-head"><div class="cal-month-title" id="mtitle"></div><div class="muted small" id="period"></div></div>
        <button type="button" class="nav-btn" id="next" aria-label="다음 달">›</button>
      </div>
      <div id="cal"></div>
      <div class="legend" id="legend"></div>
      <div class="last-check">마지막 조회 <b>${stamp(doc.updated_at || runner.last_run_at)}</b>${esc(stopped)}</div>
    </section>
    <div id="daybox"></div>
    <div id="tripbox"></div>
    <p class="foot-links"><a href="#edit/${esc(encodeURIComponent(rid))}">이 노선 조건 바꾸기</a></p>`;

  const draw = () => {
    saveView({ route: rid, dir: st.dir, cabin: st.cabin, month: st.month, nights: st.nights });
    document.querySelectorAll("#dirs [data-dir]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.dir === st.dir)));
    document.querySelectorAll("#cabins [data-cabin]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cabin === st.cabin)));
    const back = st.dir === "back";
    const days = (dirs[st.dir] && dirs[st.dir].days) || {};
    const [a, b] = span();
    const t = target();
    let min = null;
    for (const [iso, d] of Object.entries(days)) {
      const e = d && d[st.cabin];
      if (iso >= a && iso <= b && e && e.miles != null && (min == null || e.miles < min)) min = e.miles;
    }
    const list = monthList();
    const i = list.indexOf(st.month);
    const [y, m] = st.month.split("-").map(Number);
    document.getElementById("mtitle").textContent = `${y}년 ${m}월`;
    document.getElementById("period").textContent = `${round ? (back ? "오는 편 " : "가는 편 ") : ""}${periodText(a, b)}`;
    document.getElementById("prev").disabled = i <= 0;
    document.getElementById("next").disabled = i >= list.length - 1;
    document.getElementById("cal").innerHTML = monthHTML(days, st.cabin, y, m - 1, a, b, t, st.day, doc.updated_at, min);
    document.getElementById("legend").innerHTML =
      (t ? `<span><i class="hit"></i>${num(t)} 이하</span><span><i class="avail"></i>${num(t)} 초과</span>` : `<span><i class="hit"></i>최저 +${LOW_PCT}% 이내</span><span><i class="avail"></i>좌석 있음</span>`)
      + `<span>– 좌석 없음</span><span><i class="unk"></i>조회 전</span><span><i class="dot"></i> 새로 열림</span>`
      + `<span><i class="ds done"></i>상세 확인</span><span><i class="ds part"></i>상세 일부</span>`;
    document.getElementById("daybox").innerHTML = st.day
      ? dayHTML(st.day, st.cabin, days[st.day] ? days[st.day][st.cabin] : undefined, t, back ? r.to : r.from, back ? r.from : r.to, doc.updated_at, r.id, back ? "back" : "out")
      : "";
    document.getElementById("tripbox").innerHTML = round ? tripHTML(dirs, r, st.cabin, st.nights) : "";
  };

  const tabs = document.getElementById("routes");
  tabs.onclick = (ev) => {
    const b = ev.target.closest("[data-route]");
    if (b && b.dataset.route !== rid) location.hash = "#r/" + encodeURIComponent(b.dataset.route);
  };
  const on = tabs.querySelector('[aria-selected="true"]');
  if (on) tabs.scrollLeft = Math.max(0, on.offsetLeft - tabs.clientWidth / 2 + on.offsetWidth / 2);
  const dirsEl = document.getElementById("dirs");
  if (dirsEl) dirsEl.onclick = (ev) => {
    const b = ev.target.closest("[data-dir]");
    if (b && b.dataset.dir !== st.dir) { st.dir = b.dataset.dir; st.day = null; st.month = null; fitMonth(); draw(); }
  };
  const cabinsEl = document.getElementById("cabins");
  if (cabinsEl) cabinsEl.onclick = (ev) => { const b = ev.target.closest("[data-cabin]"); if (b) { st.cabin = b.dataset.cabin; draw(); } };
  const step = (k) => { const list = monthList(); const i = list.indexOf(st.month) + k; if (i >= 0 && i < list.length) { st.month = list[i]; st.day = null; draw(); } };
  document.getElementById("tripbox").onchange = (ev) => {
    if (ev.target.id === "nights") { st.nights = Number(ev.target.value); draw(); }
  };
  document.getElementById("daybox").onclick = async (ev) => {
    const mb = ev.target.closest("#mark-btn");
    if (mb) {
      const out = document.getElementById("mark-out");
      out.hidden = false;
      if (!ghToken()) { out.innerHTML = `먼저 GitHub 연결이 필요해요 (한 번만). <a href="#github">연결하기 →</a>`; return; }
      const back = st.dir === "back";
      const mark = { route_id: r.id, direction: st.dir, date: st.day, cabin: st.cabin, status: "gone", marked_at: kstStamp() };
      const gone = mb.dataset.action === "gone";
      const label = `${back ? r.to : r.from}→${back ? r.from : r.to} ${mdDow(st.day)}`;
      mb.disabled = true;
      out.textContent = "GitHub 에 저장하는 중…";
      try {
        await writeMarks((ms) => gone ? [...ms.filter((m) => !sameMark(m, mark)), mark] : ms.filter((m) => !sameMark(m, mark)),
          `마일 좌석 직접 확인: ${label} ${gone ? "좌석 없어짐" : "표시 되돌림"}`);
        const p = { route_id: r.id, direction: st.dir, date: st.day, cabin: st.cabin, action: gone ? "gone" : "undo", at: mark.marked_at };
        savePending([...loadPending().filter((x) => !sameMark(x, p)), p]);
        overlayPending(p, dirs[st.dir].days);
        draw();
      } catch (err) {
        mb.disabled = false;
        out.textContent = `저장하지 못했어요: ${err.message}`;
      }
      return;
    }
    const b = ev.target.closest("#refresh-btn");
    if (!b) return;
    const text = b.dataset.text;
    const out = document.getElementById("refresh-out");
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch {}
    out.innerHTML = `<pre class="snippet">${esc(text)}</pre>
      <p class="muted small refresh-note">${copied ? "<b>복사했어요.</b> " : "위 글자를 길게 눌러 복사해 주세요. "}휴대폰의 Claude 대화창(집 PC에 연결된 대화)에 붙여 넣어 보내면, PC가 이 날짜만 다시 조회해요. 천천히 클릭하느라 5~10분쯤 걸리고, 끝나면 앱에 반영돼요.</p>`;
    out.hidden = false;
    b.textContent = copied ? "복사됨 ✓ 대화창에 붙여 넣어 주세요" : "↻ 이 날짜 다시 조회";
  };
  document.getElementById("prev").onclick = () => step(-1);
  document.getElementById("next").onclick = () => step(1);
  document.getElementById("cal").onclick = (ev) => {
    const b = ev.target.closest("button.day");
    if (!b) return;
    st.day = st.day === b.dataset.date ? null : b.dataset.date;
    draw();
    const card = document.getElementById("day-card");
    if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  draw();
}

// ------------------------------------------------------------ 노선 추가 · 조건 바꾸기
function repoInfo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!m) return null;
  const repo = location.pathname.split("/").filter(Boolean)[0];
  return repo ? { owner: m[1], repo } : null;
}

function pairOptions(sel) {
  const groups = { SEL: "서울(인천·김포) 출발 · 도착", PUS: "부산 출발 · 도착" };
  return Object.entries(CATALOG).map(([k, list]) => `
    <optgroup label="${groups[k]}">${list.map((j) => {
      const v = `${k}-${j}`;
      return `<option value="${v}"${v === sel ? " selected" : ""}>${cityName(k)} ↔ ${cityName(j)}${SEASONAL.has(v) ? " (운항 확인 필요)" : ""}</option>`;
    }).join("")}</optgroup>`).join("") + `<option value="custom"${sel === "custom" ? " selected" : ""}>직접 입력</option>`;
}

async function renderEdit(id) {
  let doc;
  try { doc = await getJSON(`data/routes/${encodeURIComponent(id)}.json`); }
  catch { $app.innerHTML = `<a class="back" href="#">‹ 달력</a><div class="card empty">노선을 찾을 수 없어요.</div>`; return; }
  renderAdd(doc.route);
}

async function renderAdd(edit) {
  let settings = {};
  try { settings = (await getJSON("data/index.json")).settings || {}; } catch {}
  const runLimit = settings.max_searches_per_run || settings.daily_search_limit || 40;
  const detailMax = settings.max_details_per_route || 4;
  const waits = settings.wait_seconds || { click: [8, 15], search: [20, 35], between: [40, 80] };
  const avg = (k) => (waits[k][0] + waits[k][1]) / 2;
  const perCalendarMin = (6 * avg("click") + avg("search") + avg("between") + 60) / 60;
  const perDetailMin = (3 * avg("click") + avg("search") + 40) / 60;
  const info = repoInfo();
  const editUrl = info ? `https://github.com/${info.owner}/${info.repo}/edit/main/award-tracker/routes.json` : null;
  const e = edit || {};

  let pair = "SEL-TYO", dir = "kr";
  if (e.from) {
    if (inCatalog(e.from, e.to)) pair = `${e.from}-${e.to}`;
    else if (inCatalog(e.to, e.from)) { pair = `${e.to}-${e.from}`; dir = "jp"; }
    else pair = "custom";
  }
  const cabins = e.cabins || ["economy"];
  const t = e.target_miles || {};

  $app.innerHTML = `
    <a class="back" href="${edit ? `#r/${esc(encodeURIComponent(edit.id))}` : "#"}">‹ 달력</a>
    <section class="card">
      <h3 class="section-title">${edit ? "추적 조건 바꾸기" : "노선 추가하기"}</h3>
      <p class="muted small" style="margin-top:-6px">입력하면 아래에 routes.json 에 넣을 내용이 만들어져요. 서울 · 도쿄 · 오사카는 도시 코드(SEL · TYO · OSA)로 모든 공항을 함께 검색하고, 1인 기준이에요.</p>
      <form id="f" class="form" onsubmit="return false">
        <label class="full">노선<select name="pair">${pairOptions(pair)}</select></label>
        <div class="full seg" id="dirseg" role="group" aria-label="방향">
          <button type="button" data-dir="kr">한국 → 일본</button>
          <button type="button" data-dir="jp">일본 → 한국</button>
        </div>
        <label class="custom">출발 (공항·도시 코드)<input name="from" maxlength="3" value="${esc(pair === "custom" ? e.from : "")}" placeholder="SEL"></label>
        <label class="custom">도착 (공항·도시 코드)<input name="to" maxlength="3" value="${esc(pair === "custom" ? e.to : "")}" placeholder="TYO"></label>
        <label class="full">이름 (비워 두면 자동)<input name="name" value="${esc(e.name && e.name !== routeTitle(e.from, e.to) ? e.name : "")}"></label>

        <div class="form-sub">가는 편 출발 기간</div>
        <label>부터<input type="date" name="start" value="${esc(e.start || "")}"></label>
        <label>까지<input type="date" name="end" value="${esc(e.end || "")}"></label>
        <label class="full check"><input type="checkbox" name="has_return"${e.return_start ? " checked" : ""}> 오는 편도 추적</label>
        <label class="ret">오는 편 부터<input type="date" name="return_start" value="${esc(e.return_start || "")}"></label>
        <label class="ret">오는 편 까지<input type="date" name="return_end" value="${esc(e.return_end || "")}"></label>

        <div class="form-sub">좌석 등급과 목표 마일 <span class="muted small">(목표 이하로 열리면 메일)</span></div>
        <label class="check"><input type="checkbox" name="c_economy"${cabins.includes("economy") ? " checked" : ""}> 이코노미</label>
        <label>이코노미 목표<input type="number" name="t_economy" min="0" step="500" inputmode="numeric" placeholder="예: 15000" value="${esc(t.economy || "")}"></label>
        <label class="full check"><input type="checkbox" name="nonstop"${e.nonstop === true ? " checked" : ""}> 직항만 (끄면 직항 · 경유 모두)</label>
        <label class="full check"><input type="checkbox" name="active"${e.active === false ? "" : " checked"}> 조회하기 (끄면 일시 중지)</label>
      </form>
      <div class="estimate" id="est"></div>
      <p class="warn-text" id="warn" hidden></p>
    </section>
    <section class="card">
      <h3 class="section-title">routes.json 에 넣을 내용</h3>
      <pre class="snippet" id="out"></pre>
      <button class="btn" id="copy" type="button">복사하기</button>
      ${editUrl ? `<a class="btn secondary" style="margin-top:8px;background:var(--bg)" href="${editUrl}" target="_blank" rel="noopener">GitHub 에서 routes.json 열기</a>` : ""}
      <p class="muted small" style="margin:10px 0 0">
        ${edit ? "routes.json 에서 같은 id 의 항목을 이 내용으로 바꿔 주세요." : "routes.json 의 \"routes\": [ … ] 안에 붙여 넣어 주세요 (항목 사이에 쉼표)."}
        저장(Commit)하면 다음에 집 PC에서 ‘마일 좌석 조회’ 버튼을 누를 때부터 포함돼요.
      </p>
    </section>`;

  const f = document.getElementById("f");
  const out = document.getElementById("out");
  const warn = document.getElementById("warn");
  const est = document.getElementById("est");

  const update = () => {
    const v = Object.fromEntries(new FormData(f).entries());
    const custom = v.pair === "custom";
    f.querySelectorAll(".custom").forEach((el) => { el.hidden = !custom; });
    document.getElementById("dirseg").hidden = custom;
    document.querySelectorAll("#dirseg [data-dir]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.dir === dir)));
    const hasReturn = f.has_return.checked;
    f.querySelectorAll(".ret").forEach((el) => { el.hidden = !hasReturn; });

    let from, to;
    if (custom) { from = (v.from || "").trim().toUpperCase(); to = (v.to || "").trim().toUpperCase(); }
    else { const [k, j] = v.pair.split("-"); [from, to] = dir === "kr" ? [k, j] : [j, k]; }
    const cab = CABIN_ORDER.filter((c) => f["c_" + c].checked);
    const targets = {};
    for (const c of cab) { const n = parseInt(v["t_" + c], 10); if (n > 0) targets[c] = n; }
    const id = edit ? edit.id : `${from}-${to}-${(v.start || "").replaceAll("-", "")}`.toLowerCase();
    const body = {
      id,
      name: (v.name || "").trim() || routeTitle(from, to),
      from, to,
      start: v.start || null,
      end: v.end || null,
      return_start: hasReturn ? v.return_start || null : null,
      return_end: hasReturn ? v.return_end || null : null,
      cabins: cab,
      target_miles: Object.keys(targets).length ? targets : null,
      nonstop: f.nonstop.checked,
      adults: 1,
      active: f.active.checked,
    };
    out.textContent = JSON.stringify(body, null, 2);

    const problems = [];
    const today = kstToday();
    const lastBookable = addDays(today, 355);
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) problems.push("공항 코드는 영문 3자리로 적어 주세요.");
    else if (from === to) problems.push("출발과 도착 공항이 같아요.");
    if (!body.start || !body.end) problems.push("가는 편 기간을 정해 주세요.");
    else if (body.end < body.start) problems.push("가는 편 기간의 끝이 시작보다 빨라요.");
    else if (body.end < today) problems.push("가는 편 기간이 이미 지났어요.");
    else if (monthsBetween(body.start, body.end).length > MAX_MONTHS) problems.push(`가는 편 기간은 최대 ${MAX_MONTHS}개월(예: 2월~9월)까지 정할 수 있어요.`);
    if (hasReturn) {
      if (!body.return_start || !body.return_end) problems.push("오는 편 기간을 정해 주세요.");
      else if (body.return_end < body.return_start) problems.push("오는 편 기간의 끝이 시작보다 빨라요.");
      else if (body.start && body.return_end < body.start) problems.push("오는 편 기간이 가는 편보다 빨라요.");
      else if (monthsBetween(body.return_start, body.return_end).length > MAX_MONTHS) problems.push(`오는 편 기간은 최대 ${MAX_MONTHS}개월(예: 2월~9월)까지 정할 수 있어요.`);
    }
    if (!cab.length) problems.push("좌석 등급을 하나 이상 골라 주세요.");
    const far = [body.end, body.return_end].filter(Boolean).some((d) => d > lastBookable);
    if (far) problems.push(`발권은 보통 약 1년 전부터 열려서, ${mdDow(lastBookable)} 이후 날짜는 아직 안 나올 수 있어요.`);
    warn.hidden = !problems.length;
    warn.innerHTML = problems.map(esc).join("<br>");

    const months = monthsBetween(body.start, body.end).length + (hasReturn ? monthsBetween(body.return_start, body.return_end).length : 0);
    const cal = months * cab.length;
    const lo = Math.round(cal * perCalendarMin), hi = Math.round(cal * perCalendarMin + detailMax * perDetailMin);
    est.innerHTML = cal
      ? `한 번 조회할 때 이 노선은 <b>캘린더 검색 약 ${cal}회</b>(달 ${months}개 × 좌석 등급 ${cab.length}개) + <b>목표 이하 날짜 상세 확인 최대 ${detailMax}회</b>예요. 클릭마다 넉넉히 기다리며 진행해서 <b>약 ${lo}~${hi}분</b> 걸려요. 모든 노선을 합쳐 한 번에 최대 ${runLimit}회까지 검색해요.`
      : "기간과 좌석 등급을 정하면 검색 횟수와 걸리는 시간을 계산해 드려요.";
  };

  document.getElementById("dirseg").onclick = (ev) => { const b = ev.target.closest("[data-dir]"); if (b) { dir = b.dataset.dir; update(); } };
  f.addEventListener("input", update);
  f.addEventListener("change", update);
  update();
  document.getElementById("copy").onclick = async (ev) => {
    try { await navigator.clipboard.writeText(out.textContent); ev.target.textContent = "복사됨 ✓"; }
    catch { ev.target.textContent = "직접 선택해서 복사해 주세요"; }
  };
}

// ------------------------------------------------------------ 화면 전환
function renderGithub() {
  setTopRight("");
  const has = !!ghToken();
  const info = repoInfo() || { owner: "idght351-gif", repo: "flight-tracker" };
  $app.innerHTML = `
    <a href="#" class="back">‹ 달력으로</a>
    <section class="card">
      <h3 class="section-title">GitHub 연결</h3>
      <p class="small">날짜 카드의 <b>"사이트에서 좌석 없어진 것 확인"</b> 을 누르면, 이 앱이 저장소의 <code>${MARKS_PATH}</code> 에 바로 기록해요.
        그러면 1~2분 뒤 모든 기기의 앱과 추천 일정에서 그 날짜가 좌석 없음으로 바뀌어요. 그 날짜를 PC 가 다시 조회하면 새 결과가 우선해요.</p>
      <ol class="small steps">
        <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub 토큰 만들기</a> (Fine-grained token)</li>
        <li>Repository access: <b>Only select repositories</b> → <b>${esc(info.repo)}</b></li>
        <li>Permissions → Repository permissions → <b>Contents: Read and write</b> (다른 권한은 필요 없어요)</li>
        <li>만든 토큰(github_pat_…)을 아래에 붙여 넣고 저장</li>
      </ol>
      <label class="gh-field">토큰 <input id="gh-token" type="password" autocomplete="off" placeholder="${has ? "저장돼 있어요 (바꾸려면 새로 붙여 넣기)" : "github_pat_…"}"></label>
      <div class="gh-btns">
        <button class="btn" id="gh-save" type="button">저장하고 확인</button>
        ${has ? `<button class="btn line" id="gh-del" type="button">이 기기에서 지우기</button>` : ""}
      </div>
      <p class="muted small" id="gh-msg">${has ? "이 기기에 토큰이 저장돼 있어요." : "토큰은 이 기기에만 저장돼요. 다른 사람과 쓰는 기기에는 넣지 마세요."}</p>
    </section>`;
  const msg = document.getElementById("gh-msg");
  document.getElementById("gh-save").onclick = async () => {
    const v = document.getElementById("gh-token").value.trim();
    const old = ghToken();
    if (!v && !old) { msg.textContent = "토큰을 붙여 넣어 주세요."; return; }
    if (v) setGhToken(v);
    msg.textContent = "확인하는 중…";
    try {
      const res = await gh("");
      if (!res.ok) throw new Error(`저장소를 볼 수 없어요 (${res.status})`);
      const j = await res.json();
      if (!(j.permissions && j.permissions.push)) throw new Error("이 토큰은 저장소에 쓸 수 없어요 (Contents: Read and write 필요)");
      msg.textContent = "연결됐어요 ✓ 이제 날짜 카드에서 좌석 없어짐을 기록할 수 있어요.";
      document.getElementById("gh-token").value = "";
    } catch (err) {
      if (v) setGhToken(old);   // 새로 넣은 토큰이 안 되면 저장하지 않음
      msg.textContent = `연결하지 못했어요: ${err.message}`;
    }
  };
  const del = document.getElementById("gh-del");
  if (del) del.onclick = () => { setGhToken(""); renderGithub(); };
}

function route() {
  setTopRight("");
  window.scrollTo(0, 0);
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === "add") renderAdd();
  else if (h === "github") renderGithub();
  else if (h.startsWith("edit/")) renderEdit(h.slice(5));
  else if (h.startsWith("r/")) renderMain(h.slice(2));   // 알림 메일의 '달력 보기' 링크
  else renderMain();
}
window.addEventListener("hashchange", route);
route();
