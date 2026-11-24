"use strict";

const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Number(n).toLocaleString("ko-KR");
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const CABIN = { economy: "이코노미", business: "비즈니스" };
const CABIN_ORDER = ["economy", "business"];

// ------------------------------------------------------------ 한일 노선 목록
// 대한항공, 그리고 12/17부터 대한항공 편명으로 바뀌는 (구)아시아나 직항 기준이에요.
// 시즌·감편으로 바뀔 수 있어서, 실제로 운항하지 않는 노선은 조회하면 '좌석 없음'으로만 나와요.
const AIRPORT = {
  ICN: "인천", GMP: "김포", PUS: "부산",
  NRT: "도쿄 나리타", HND: "도쿄 하네다", KIX: "오사카 간사이", NGO: "나고야", FUK: "후쿠오카",
  CTS: "삿포로", OKA: "오키나와", KOJ: "가고시마", KMJ: "구마모토", NGS: "나가사키", OIT: "오이타",
  KMQ: "고마쓰", KIJ: "니가타", SDJ: "센다이", OKJ: "오카야마", AOJ: "아오모리", HIJ: "히로시마",
};
const KR = ["ICN", "GMP", "PUS"];
const CATALOG = {
  ICN: ["NRT", "KIX", "NGO", "FUK", "CTS", "OKA", "KOJ", "KMJ", "NGS", "OIT", "KMQ", "KIJ", "SDJ", "OKJ", "AOJ", "HIJ"],
  GMP: ["HND", "KIX"],
  PUS: ["NRT", "KIX", "FUK", "CTS"],
};
const SEASONAL = new Set(["ICN-NGS", "ICN-OIT", "ICN-KIJ", "ICN-OKJ", "ICN-AOJ", "ICN-HIJ", "PUS-KIX", "PUS-FUK", "PUS-CTS"]);
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

// ------------------------------------------------------------ 목록
const RUN = {
  ok: ["good", "정상"],
  login_required: ["warn", "로그인 필요"],
  challenge: ["bad", "보안 확인 필요"],
  error: ["bad", "조회 실패"],
  never: ["", "조회 전"],
};

function runnerHTML(r, sample) {
  r = r || { status: "never" };
  let [cls, label] = RUN[r.status] || RUN.never;
  const stale = !sample && r.last_run_at && Date.now() - new Date(r.last_run_at) > 36 * 3600 * 1000;
  if (stale && r.status === "ok") { cls = "warn"; label = "하루 넘게 조회 없음"; }
  const msg = r.message
    || (stale ? "집 PC나 크롬이 꺼져 있었는지 확인해 주세요."
      : r.status === "never" ? "집 PC의 크롬 확장 프로그램이 조회를 시작하면 여기에 결과가 보여요." : "");
  return `
    <section class="card">
      <div class="runner-head"><h2 class="section-title">집 PC 조회</h2><span class="badge ${cls}">${label}</span></div>
      <div class="info-row"><span>마지막 조회</span><span>${stamp(r.last_run_at)}</span></div>
      ${r.next_run_at ? `<div class="info-row"><span>다음 조회</span><span>${stamp(r.next_run_at)}경</span></div>` : ""}
      ${r.daily_limit ? `<div class="info-row"><span>오늘 조회 횟수</span><span class="num">${num(r.searches_today || 0)} / ${num(r.daily_limit)}회</span></div>` : ""}
      ${msg ? `<p class="runner-msg">${esc(msg)}</p>` : ""}
    </section>`;
}

function minText(x) {
  if (x && x.min != null) return `${num(x.min)}<span class="muted small"> 마일</span>`;
  return x && x.checked ? `<span class="muted">좌석 없음</span>` : `<span class="muted">조회 전</span>`;
}

function cardHTML(r) {
  const s = r.summary || {};
  const round = !!r.return_start;
  const cabins = CABIN_ORDER.filter((c) => (r.cabins || []).includes(c));
  let fresh = 0;
  const rows = cabins.map((c) => {
    const o = (s.out || {})[c] || {}, b = (s.back || {})[c] || {};
    const target = (r.target_miles || {})[c];
    const hits = (o.hit || 0) + (b.hit || 0);
    fresh += (o.fresh || 0) + (b.fresh || 0);
    const mins = round
      ? `<span>가는 편 <strong class="num">${minText(o)}</strong></span><span>오는 편 <strong class="num">${minText(b)}</strong></span>`
      : `<span>최저 <strong class="num">${minText(o)}</strong>${o.min_date ? ` <span class="muted small">${mdDow(o.min_date)}</span>` : ""}</span>`;
    const hitBadge = target
      ? `<span class="badge ${hits ? "good" : ""}">${num(target)} 이하 ${hits}일</span>`
      : `<span class="muted small">목표 없음</span>`;
    return `<div class="rc-cabin"><div class="rc-cabin-top"><b>${CABIN[c]}</b>${hitBadge}</div><div class="rc-cabin-mins">${mins}</div></div>`;
  }).join("");
  const paused = r.active === false;
  return `
    <a class="card route-card${paused ? " paused" : ""}" href="#r/${esc(encodeURIComponent(r.id))}">
      <div class="rc-head">
        <div>
          <div class="route-name">${esc(r.name || routeTitle(r.from, r.to))}</div>
          <div class="route-meta">${round ? "가는 편" : "편도"} ${periodText(r.start, r.end)}</div>
          ${round ? `<div class="route-meta">오는 편 ${periodText(r.return_start, r.return_end)}</div>` : ""}
        </div>
        <div class="rc-badges">
          ${paused ? `<span class="badge warn">일시 중지</span>` : fresh ? `<span class="badge info">새로 열림 ${fresh}</span>` : ""}
        </div>
      </div>
      <div class="rc-cabins">${rows}</div>
      <div class="route-meta small rc-foot">마지막 조회 ${stamp(r.last_checked_at)}</div>
    </a>`;
}

async function renderList() {
  let index;
  try { index = await getJSON("data/index.json"); } catch { index = { routes: [] }; }
  setTopRight(index.updated_at ? `<span class="muted small">업데이트 ${stamp(index.updated_at)}</span>` : "");
  const routes = index.routes || [];
  const active = routes.filter((r) => r.active !== false);
  const paused = routes.filter((r) => r.active === false);
  $app.innerHTML = `
    ${index.sample ? SAMPLE_NOTICE : ""}
    ${runnerHTML(index.runner, index.sample)}
    <div class="list-title"><h2 class="section-title">추적 중인 노선</h2><span class="muted small">Flying Blue · 스카이팀 · 1인</span></div>
    ${active.length ? active.map(cardHTML).join("") : `
      <div class="card empty">
        <p>아직 추적 중인 노선이 없어요.</p>
        <p class="muted small">아래 ‘노선 추가하기’에서 한일 노선을 골라 routes.json 에 넣으면 다음 조회부터 기록돼요.</p>
      </div>`}
    ${paused.length ? `<div class="list-title"><h2 class="section-title">일시 중지</h2></div>${paused.map(cardHTML).join("")}` : ""}
    <a href="#add" class="btn secondary" style="margin-top:16px">+ 노선 추가하기</a>`;
}

// ------------------------------------------------------------ 상세
function calHTML(days, cabin, a, b, target, selected, ref) {
  let min = null;
  for (const [iso, d] of Object.entries(days)) {
    const e = d && d[cabin];
    if (iso >= a && iso <= b && e && e.miles != null && (min == null || e.miles < min)) min = e.miles;
  }
  return monthsBetween(a, b).map(([y, m]) => {
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0).getDate();
    let cells = DOW.map((d, i) => `<div class="cal-dow${i === 0 ? " sun" : ""}" aria-hidden="true">${d}</div>`).join("");
    cells += `<div aria-hidden="true"></div>`.repeat(first.getDay());
    for (let d = 1; d <= last; d++) {
      const iso = isoOf(new Date(y, m, d));
      if (iso < a || iso > b) { cells += `<div class="day out" aria-hidden="true"><span class="d">${d}</span></div>`; continue; }
      const e = days[iso] ? days[iso][cabin] : undefined;
      const st = dayState(e, target);
      const label = st === "unk" ? "" : st === "none" ? "–" : kMiles(e.miles);
      const aria = `${m + 1}월 ${d}일 ${st === "unk" ? "조회 전" : st === "none" ? "좌석 없음" : `${num(e.miles)}마일`}`;
      const isMin = st === "hit" || st === "avail" ? e.miles === min : false;
      cells += `<button type="button" class="day ${st}${isMin ? " min" : ""}" data-date="${iso}" aria-pressed="${iso === selected}" aria-label="${aria}"><span class="d">${d}</span><span class="m">${label}</span>${isFresh(e, ref) ? `<i class="dot"></i>` : ""}</button>`;
    }
    return `<div class="cal-month"><div class="cal-title">${y}년 ${m + 1}월</div><div class="cal-grid">${cells}</div></div>`;
  }).join("");
}

function flightsHTML(fs) {
  if (!fs || !fs.length) return "";
  return `
    <table class="flights">
      <thead><tr><th>편명</th><th>출발–도착</th><th class="r">마일 · 추가 비용</th></tr></thead>
      <tbody>${fs.map((f) => `
        <tr>
          <td><b>${esc(f.no)}</b>${f.operated_by ? `<div class="sub">${esc(f.operated_by)} 운항</div>` : ""}</td>
          <td class="num">${esc(f.dep || "")}–${esc(f.arr || "")}</td>
          <td class="r num">${f.miles != null ? num(f.miles) : "-"}${money(f.tax) ? `<div class="sub">${money(f.tax)}</div>` : ""}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

function dayHTML(iso, cabin, e, target, from, to, ref) {
  const d = parseDate(iso);
  const title = `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]}) · ${CABIN[cabin]}`;
  let body;
  if (e === undefined) {
    body = `<p class="muted dd-empty">아직 조회하지 않은 날짜예요. 다음 조회 때 확인해요.</p>`;
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
      ${e.seats != null ? `<div class="info-row"><span>남은 좌석</span><span>${num(e.seats)}석</span></div>` : ""}
      ${change ? `<div class="info-row"><span>지난 조회 대비</span><span>${change}</span></div>` : ""}
      ${e.first_seen ? `<div class="info-row"><span>처음 본 때</span><span>${stamp(e.first_seen)}</span></div>` : ""}
      <div class="info-row"><span>확인</span><span>${e.source === "detail" ? "편 상세까지 확인" : "캘린더 값 · 세금은 상세 확인 때"}<br><span class="muted small">${stamp(e.checked_at)}</span></span></div>
      ${flightsHTML(e.flights)}`;
  }
  return `
    <section class="card" id="day-card">
      <div class="dd-head"><h3 class="section-title">${title}</h3><span class="muted small">${esc(from)} → ${esc(to)}</span></div>
      ${body}
    </section>`;
}

function combosHTML(doc, r, cabin) {
  const pick = (days, a, b) => Object.entries(days || {})
    .filter(([iso, d]) => iso >= a && iso <= b && d && d[cabin] && d[cabin].miles != null)
    .map(([iso, d]) => ({ iso, ...d[cabin] }));
  const O = pick(doc.directions.out.days, r.start, r.end);
  const B = pick(doc.directions.back.days, r.return_start, r.return_end);
  const list = [];
  for (const o of O) for (const b of B) {
    if (b.iso <= o.iso) continue;
    const tax = o.tax && b.tax && (o.tax.currency || "KRW") === (b.tax.currency || "KRW")
      ? { amount: o.tax.amount + b.tax.amount, currency: o.tax.currency || "KRW" } : null;
    list.push({ o, b, miles: o.miles + b.miles, tax });
  }
  list.sort((x, y) => x.miles - y.miles || (x.tax ? x.tax.amount : Infinity) - (y.tax ? y.tax.amount : Infinity) || x.o.iso.localeCompare(y.o.iso));
  const nights = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
  return `
    <h3 class="section-title">마일이 가장 적은 왕복 조합 · ${CABIN[cabin]}</h3>
    ${list.length ? list.slice(0, 5).map((c) => `
      <div class="combo">
        <div><div class="when">${mdDow(c.o.iso)} → ${mdDow(c.b.iso)}</div>
          <div class="muted small">${nights(c.o.iso, c.b.iso)}박 · 가는 ${num(c.o.miles)} + 오는 ${num(c.b.miles)}</div></div>
        <div class="cost"><b class="num">${num(c.miles)}마일</b>
          <div class="small ${c.tax ? "" : "muted"}">${c.tax ? "+ " + money(c.tax) : "세금 일부 확인 전"}</div></div>
      </div>`).join("") : `<p class="muted" style="margin:0">가는 편과 오는 편 모두 좌석이 있는 조합이 아직 없어요.</p>`}`;
}

function switcherHTML(current, routes) {
  if (!routes || routes.length < 2) return "";
  return `<select class="switch-select" id="switch" aria-label="다른 노선 보기">${routes.map((r) =>
    `<option value="${esc(r.id)}"${r.id === current ? " selected" : ""}>${esc(r.name || routeTitle(r.from, r.to))}</option>`).join("")}</select>`;
}

async function renderDetail(id) {
  let doc, index = null;
  try {
    [doc, index] = await Promise.all([
      getJSON(`data/routes/${encodeURIComponent(id)}.json`),
      getJSON("data/index.json").catch(() => null),
    ]);
  } catch {
    $app.innerHTML = `<a class="back" href="#">‹ 목록</a><div class="card empty">노선을 찾을 수 없어요.</div>`;
    return;
  }
  const r = doc.route;
  const dirs = doc.directions || {};
  dirs.out = dirs.out || { days: {} };
  doc.directions = dirs;
  const round = !!(r.return_start && dirs.back);
  const cabins = CABIN_ORDER.filter((c) => (r.cabins || []).includes(c));
  const st = { dir: "out", cabin: cabins[0] || "economy", day: null };

  if (index) {
    setTopRight(switcherHTML(id, index.routes));
    const sw = document.getElementById("switch");
    if (sw) sw.onchange = () => { location.hash = "#r/" + encodeURIComponent(sw.value); };
  }

  $app.innerHTML = `
    <a class="back" href="#">‹ 목록</a>
    ${index && index.sample ? SAMPLE_NOTICE : ""}
    <section class="card">
      <div class="hero-route">${esc(r.from)} → ${esc(r.to)} · ${round ? "왕복" : "편도"} · 1인 · 직항</div>
      <h2 class="hero-title">${esc(r.name || routeTitle(r.from, r.to))}</h2>
      <div class="hero-sub">${round ? "가는 편 " : ""}${periodText(r.start, r.end)}</div>
      ${round ? `<div class="hero-sub">오는 편 ${periodText(r.return_start, r.return_end)}</div>` : ""}
      <div class="targets">
        ${cabins.map((c) => `<span class="badge">${CABIN[c]} 목표 ${r.target_miles && r.target_miles[c] ? `${num(r.target_miles[c])} 이하` : "없음"}</span>`).join("")}
        ${r.active === false ? `<span class="badge warn">일시 중지</span>` : ""}
      </div>
      <div class="hero-sub" style="margin-top:10px">마지막 조회 ${stamp(doc.updated_at)}</div>
    </section>
    <section class="card">
      ${round ? `
        <div class="seg" role="group" aria-label="방향" id="dirs">
          <button type="button" data-dir="out">가는 편<span class="sub">${esc(r.from)} → ${esc(r.to)}</span></button>
          <button type="button" data-dir="back">오는 편<span class="sub">${esc(r.to)} → ${esc(r.from)}</span></button>
        </div>` : ""}
      ${cabins.length > 1 ? `<div class="chips" id="cabins" role="group" aria-label="좌석 등급">${cabins.map((c) => `<button type="button" class="chip" data-cabin="${c}">${CABIN[c]}</button>`).join("")}</div>` : ""}
      <div id="cal"></div>
      <div class="legend">
        <span><i class="hit"></i>목표 이하</span><span><i class="avail"></i>좌석 있음</span>
        <span>– 좌석 없음</span><span><i class="unk"></i>조회 전</span><span><i class="dot"></i> 새로 열림</span>
      </div>
    </section>
    <div id="daybox"></div>
    ${round ? `<section class="card" id="combos"></section>` : ""}
    <a class="btn secondary" href="#edit/${esc(encodeURIComponent(id))}">조건 바꾸기</a>`;

  const draw = () => {
    document.querySelectorAll("#dirs [data-dir]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.dir === st.dir)));
    document.querySelectorAll("#cabins [data-cabin]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cabin === st.cabin)));
    const back = st.dir === "back";
    const days = (dirs[st.dir] && dirs[st.dir].days) || {};
    const [a, b] = back ? [r.return_start, r.return_end] : [r.start, r.end];
    const target = (r.target_miles || {})[st.cabin];
    document.getElementById("cal").innerHTML = calHTML(days, st.cabin, a, b, target, st.day, doc.updated_at);
    document.getElementById("daybox").innerHTML = st.day
      ? dayHTML(st.day, st.cabin, days[st.day] ? days[st.day][st.cabin] : undefined, target, back ? r.to : r.from, back ? r.from : r.to, doc.updated_at)
      : "";
    if (round) document.getElementById("combos").innerHTML = combosHTML(doc, r, st.cabin);
  };

  const dirsEl = document.getElementById("dirs");
  if (dirsEl) dirsEl.onclick = (e) => { const b = e.target.closest("[data-dir]"); if (b && b.dataset.dir !== st.dir) { st.dir = b.dataset.dir; st.day = null; draw(); } };
  const cabinsEl = document.getElementById("cabins");
  if (cabinsEl) cabinsEl.onclick = (e) => { const b = e.target.closest("[data-cabin]"); if (b) { st.cabin = b.dataset.cabin; draw(); } };
  document.getElementById("cal").onclick = (e) => {
    const b = e.target.closest("button.day");
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
  const groups = { ICN: "인천 출발 · 도착", GMP: "김포 출발 · 도착", PUS: "부산 출발 · 도착" };
  return Object.entries(CATALOG).map(([k, list]) => `
    <optgroup label="${groups[k]}">${list.map((j) => {
      const v = `${k}-${j}`;
      return `<option value="${v}"${v === sel ? " selected" : ""}>${cityName(k)} ↔ ${cityName(j)}${SEASONAL.has(v) ? " (운항 확인 필요)" : ""}</option>`;
    }).join("")}</optgroup>`).join("") + `<option value="custom"${sel === "custom" ? " selected" : ""}>직접 입력</option>`;
}

async function renderEdit(id) {
  let doc;
  try { doc = await getJSON(`data/routes/${encodeURIComponent(id)}.json`); }
  catch { $app.innerHTML = `<a class="back" href="#">‹ 목록</a><div class="card empty">노선을 찾을 수 없어요.</div>`; return; }
  renderAdd(doc.route);
}

async function renderAdd(edit) {
  let settings = {};
  try { settings = (await getJSON("data/index.json")).settings || {}; } catch {}
  const dailyLimit = settings.daily_search_limit || 40;
  const detailMax = settings.max_details_per_route || 4;
  const info = repoInfo();
  const editUrl = info ? `https://github.com/${info.owner}/${info.repo}/edit/main/award-tracker/routes.json` : null;
  const e = edit || {};

  let pair = "ICN-NRT", dir = "kr";
  if (e.from) {
    if (inCatalog(e.from, e.to)) pair = `${e.from}-${e.to}`;
    else if (inCatalog(e.to, e.from)) { pair = `${e.to}-${e.from}`; dir = "jp"; }
    else pair = "custom";
  }
  const cabins = e.cabins || ["economy", "business"];
  const t = e.target_miles || {};

  $app.innerHTML = `
    <a class="back" href="${edit ? `#r/${esc(encodeURIComponent(edit.id))}` : "#"}">‹ ${edit ? "노선" : "목록"}</a>
    <section class="card">
      <h3 class="section-title">${edit ? "추적 조건 바꾸기" : "노선 추가하기"}</h3>
      <p class="muted small" style="margin-top:-6px">입력하면 아래에 routes.json 에 넣을 내용이 만들어져요. 대한항공 · (구)아시아나 한일 직항, 1인 기준이에요.</p>
      <form id="f" class="form" onsubmit="return false">
        <label class="full">노선<select name="pair">${pairOptions(pair)}</select></label>
        <div class="full seg" id="dirseg" role="group" aria-label="방향">
          <button type="button" data-dir="kr">한국 → 일본</button>
          <button type="button" data-dir="jp">일본 → 한국</button>
        </div>
        <label class="custom">출발 공항<input name="from" maxlength="3" value="${esc(pair === "custom" ? e.from : "")}" placeholder="ICN"></label>
        <label class="custom">도착 공항<input name="to" maxlength="3" value="${esc(pair === "custom" ? e.to : "")}" placeholder="NRT"></label>
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
        <label class="check"><input type="checkbox" name="c_business"${cabins.includes("business") ? " checked" : ""}> 비즈니스</label>
        <label>비즈니스 목표<input type="number" name="t_business" min="0" step="500" inputmode="numeric" placeholder="예: 30000" value="${esc(t.business || "")}"></label>
        <label class="full check"><input type="checkbox" name="active"${e.active === false ? "" : " checked"}> 매일 조회하기 (끄면 일시 중지)</label>
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
        저장(Commit)하면 집 PC가 켜져 있을 때 30분 안에 한 번 바로 조회하고, 그 뒤로는 매일 정해진 시각에 조회해요.
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
      nonstop: true,
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
    if (hasReturn) {
      if (!body.return_start || !body.return_end) problems.push("오는 편 기간을 정해 주세요.");
      else if (body.return_end < body.return_start) problems.push("오는 편 기간의 끝이 시작보다 빨라요.");
      else if (body.start && body.return_end < body.start) problems.push("오는 편 기간이 가는 편보다 빨라요.");
    }
    if (!cab.length) problems.push("좌석 등급을 하나 이상 골라 주세요.");
    const far = [body.end, body.return_end].filter(Boolean).some((d) => d > lastBookable);
    if (far) problems.push(`발권은 보통 약 1년 전부터 열려서, ${mdDow(lastBookable)} 이후 날짜는 아직 안 나올 수 있어요.`);
    warn.hidden = !problems.length;
    warn.innerHTML = problems.map(esc).join("<br>");

    const months = monthsBetween(body.start, body.end).length + (hasReturn ? monthsBetween(body.return_start, body.return_end).length : 0);
    const cal = months * cab.length;
    est.innerHTML = cal
      ? `이 노선은 하루에 <b>캘린더 조회 약 ${cal}회</b>(달 ${months}개 × 좌석 등급 ${cab.length}개) + <b>목표 이하 날짜 상세 확인 최대 ${detailMax}회</b>를 써요. 모든 노선을 합친 하루 한도는 ${dailyLimit}회예요.`
      : "기간과 좌석 등급을 정하면 하루 조회 횟수를 계산해 드려요.";
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
function route() {
  setTopRight("");
  window.scrollTo(0, 0);
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) renderList();
  else if (h === "add") renderAdd();
  else if (h.startsWith("edit/")) renderEdit(h.slice(5));
  else if (h.startsWith("r/")) renderDetail(h.slice(2));
  else renderList();
}
window.addEventListener("hashchange", route);
route();
