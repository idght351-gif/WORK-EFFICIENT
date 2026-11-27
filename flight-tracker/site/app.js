"use strict";

const $app = document.getElementById("app");
const won = (v) => (v == null ? "-" : v.toLocaleString("ko-KR") + "원");
const md = (iso) => { const [, m, d] = iso.split("-"); return `${+m}/${+d}`; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LEVEL = { low: ["good", "Google 기준 싼 편"], typical: ["", "Google 기준 보통"], high: ["bad", "Google 기준 비싼 편"] };
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

// 나라 전체 코드 (tracker/check_prices.py REGIONS 와 같음)
const REGION_NAME = { KR: "한국", JP: "일본" };  // KR 은 인천·김포·청주로 검색
const WD = ["월", "화", "수", "목", "금", "토", "일"];  // flex.weekdays: 0=월 … 6=일
// "2월 금·토", "2~3월 주말" 처럼 짧게
// 달·요일로 정한 노선을 실제 날짜 목록으로 (tracker/check_prices.py flex_dates 와 같은 규칙)
function flexDates(flex) {
  if (flex.dates && flex.dates.length) return [...new Set(flex.dates)].sort();
  const wd = new Set(flex.weekdays && flex.weekdays.length ? flex.weekdays : [0, 1, 2, 3, 4, 5, 6]);
  const out = [];
  (flex.months || []).slice().sort().forEach((m) => {
    const [y, mo] = m.split("-").map(Number);
    for (let d = new Date(y, mo - 1, 1); d.getMonth() === mo - 1; d.setDate(d.getDate() + 1)) {
      if (wd.has((d.getDay() + 6) % 7)) out.push(`${y}-${String(mo).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
  });
  return out;
}

function flexShort(flex) {
  if (flex.dates && flex.dates.length) {
    const ds = flexDates(flex);
    return ds.length <= 2 ? ds.map(md).join("·") : `${md(ds[0])} 외 ${ds.length - 1}일`;
  }
  const ms = (flex.months || []).slice().sort();
  const m = ms.length ? (ms.length === 1 ? `${+ms[0].slice(5)}월` : `${+ms[0].slice(5)}~${+ms[ms.length - 1].slice(5)}월`) : "";
  const wd = (flex.weekdays || []).slice().sort();
  const days = !wd.length || wd.length === 7 ? "매일" : wd.join() === "5,6" ? "주말" : wd.map((i) => WD[i]).join("·");
  return `${m} ${days}`;
}
const dayLabel = (iso) => { const d = new Date(iso + "T00:00:00"); return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`; };

// 여정을 [공항, 비행(날짜), 공항, (육로 등 끊김), 공항 …] 순서로 펼칩니다.
// withReturn 이면 왕복의 돌아오는 편까지 넣습니다(상세 화면용).
function pathSteps(r, withReturn = false) {
  const legs = r.legs && r.legs.length
    ? r.legs
    : [{ from: r.from, to: r.to, date: r.date }].concat(withReturn && r.return_date ? [{ from: r.to, to: r.from, date: r.return_date }] : []);
  const steps = [];
  legs.forEach((l, i) => {
    const fmt = (c) => c.toUpperCase().split(",").map((x) => x.trim()).filter(Boolean).map((x) => REGION_NAME[x] || x).join("/");
    const from = fmt(l.from), to = fmt(l.to);
    if (i === 0) steps.push({ code: from });
    else if (fmt(legs[i - 1].to) !== from) steps.push({ gap: true }, { code: from });
    steps.push({ date: l.date }, { code: to });
  });
  return steps;
}

function routePath(r) {
  return pathSteps(r).map((st) => (st.code ? esc(st.code) : st.gap ? "·" : "→")).join(" ");
}

// 상세 화면: 화살표(비행 구간)마다 아래에 날짜
function pathWithDatesHTML(r) {
  const steps = pathSteps(r, true), firstArrow = steps.find((st) => st.date);
  return `<div class="leg-path fit-line" data-min="10">${steps.map((st) =>
    st.code ? `<span class="lp"><b>${esc(st.code)}</b><i></i></span>`
    : st.gap ? `<span class="lp gap"><b>·</b><i></i></span>`
    : `<span class="lp arrow"><b>→</b><i>${r.flex ? (st === firstArrow ? flexShort(r.flex) : `${r.flex.trip_days}박 뒤`) : md(st.date)}</i></span>`).join("")}</div>`;
}

// 날짜만: 다구간 "6/26 · 6/29 · 7/3 · 7/3", 왕복 "6/29(화) ~ 7/5", 편도 "6/29(화)"
function dateLabel(r) {
  if (r.flex) return flexShort(r.flex) + (r.flex.trip_days ? ` · ${r.flex.trip_days}박` : "");
  if (r.legs && r.legs.length) return r.legs.map((l) => md(l.date)).join(" · ");
  const d = new Date(r.date + "T00:00:00");
  return `${md(r.date)}(${DOW[d.getDay()]})` + (r.return_date ? ` ~ ${md(r.return_date)}` : "");
}

function tripLabel(r) {
  if (r.legs && r.legs.length) return `${r.legs.map((l) => md(l.date)).join(" · ")} 다구간`;
  const d = new Date(r.date + "T00:00:00");
  let s = `${md(r.date)}(${DOW[d.getDay()]})`;
  s += r.return_date ? ` ~ ${md(r.return_date)} 왕복` : " 편도";
  return s;
}

function dday(iso) {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  today.setHours(0, 0, 0, 0);
  const n = Math.round((new Date(iso + "T00:00:00") - today) / 86400000);
  const t = n > 0 ? `D-${n}` : n === 0 ? "D-day" : "출발 완료";
  return `<span style="white-space:nowrap">${t}</span>`;
}

function deltaHTML(cur, prev) {
  if (cur == null || prev == null) return `<span class="muted">어제 기록 없음</span>`;
  const d = cur - prev;
  if (d === 0) return `<span class="muted">어제와 같음</span>`;
  const pct = ((Math.abs(d) / prev) * 100).toFixed(1);
  return d < 0
    ? `<span class="down">▼ ${won(-d)} (${pct}%)</span>`
    : `<span class="up">▲ ${won(d)} (${pct}%)</span>`;
}

// 긴 공항 코드 경로를 한 줄로: 넘치면 글자를 조금씩 줄이고(최소 minPx), 그래도 넘치면 … 처리
function fitOneLine(root = document, minPx = 12) {
  root.querySelectorAll(".fit-line").forEach((el) => {
    const min = +el.dataset.min || minPx;
    const shrink = () => {
      el.style.fontSize = "";
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth && size > min) {
        size -= 0.5;
        el.style.fontSize = size + "px";
      }
    };
    // 상세 경로: 아주 좁은 화면에서 그래도 넘치면 D-day 만 다음 줄로 내리고 다시 맞춤
    const top = el.closest(".hero-top");
    if (top) top.classList.remove("wrap");
    shrink();
    if (top && el.scrollWidth > el.clientWidth) { top.classList.add("wrap"); shrink(); }
  });
}

// 위쪽 제목줄 오른쪽 자리: 목록에선 업데이트 시각, 상세에선 항공편 선택 상자
function setTopRight(html) { document.getElementById("topright").innerHTML = html; }

// 앱에서 다시 조회한 직후엔 Pages 배포(1~2분)를 기다리지 않고 저장소에서 바로 받은 데이터를 잠시 씀
const FRESH = {};
async function getJSON(url) {
  if (FRESH[url] && Date.now() < FRESH[url].until) return FRESH[url].data;
  const r = await fetch(url + "?t=" + Date.now());
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

// ------------------------------------------------------------ 지금 다시 조회 (앱 → GitHub Actions 실행)
const RUNNING = {};  // 노선 id(전체는 "*") → 요청 시각
function refreshHTML(rid, cost, lastAt) {
  const key = rid || "*";
  const when = lastAt ? `마지막 조회 ${new Date(lastAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ` : "";
  return `<div class="refresh">
    <button type="button" class="btn secondary" id="refresh-btn" ${RUNNING[key] ? "disabled" : ""}>${RUNNING[key] ? "조회 중… 1~2분 걸려요" : rid ? "지금 다시 조회" : "전체 다시 조회"}</button>
    <p class="muted small" id="refresh-msg">${RUNNING[key] ? "화면을 닫아도 조회는 계속돼요." : `${when}검색 약 ${cost}회 사용`}</p>
  </div>`;
}
function bindRefresh(rid) {
  const btn = document.getElementById("refresh-btn");
  if (btn) btn.onclick = () => runRefresh(rid);
}
async function runRefresh(rid) {
  const key = rid || "*", msg = (t) => { const el = document.getElementById("refresh-msg"); if (el) el.textContent = t; };
  if (!ghToken()) { msg("앱 설정에서 GitHub 연결이 필요해요."); location.hash = "#settings"; return; }
  const { owner, repo } = ghRepo(), asked = Date.now();
  RUNNING[key] = asked;
  const btn = document.getElementById("refresh-btn");
  if (btn) { btn.disabled = true; btn.textContent = "조회 중… 1~2분 걸려요"; }
  msg("화면을 닫아도 조회는 계속돼요.");
  const raw = (p) => gh(`/repos/${owner}/${repo}/contents/flight-tracker/site/${p}?ref=main`).then((f) => JSON.parse(b64ToText(f.content)));
  let done = false, err = null;
  try {
    await gh(`/repos/${owner}/${repo}/actions/workflows/flight-prices.yml/dispatches`, {
      method: "POST", body: JSON.stringify({ ref: "main", inputs: { route: rid || "" } }),
    });
    for (let t = 0; t < 36 && !done; t++) {  // 최대 약 6분
      await new Promise((res) => setTimeout(res, 10000));
      try {
        const index = await raw("data/index.json");
        if (new Date(index.updated_at) >= asked - 30000) {
          const until = Date.now() + 5 * 60000;
          FRESH["data/index.json"] = { data: index, until };
          for (const r of index.routes) {
            if (rid && r.id !== rid) continue;
            const p = `data/routes/${encodeURIComponent(r.id)}.json`;
            try { FRESH[p] = { data: await raw(p), until }; } catch {}
            const q = `data/returns/${encodeURIComponent(r.id)}.json`;
            try { FRESH[q] = { data: await raw(q), until }; } catch {}
          }
          done = true;
        }
      } catch {}
    }
    if (!done) err = "시간 안에 결과가 오지 않았어요. 잠시 뒤 새로고침해 보세요.";
  } catch (e) {
    err = e.status === 401 ? "GitHub 연결이 끊겼어요. 앱 설정에서 다시 연결해 주세요." : `조회를 시작하지 못했어요 (${e.message})`;
  }
  delete RUNNING[key];
  const here = decodeURIComponent(location.hash.slice(1));
  if (done && (rid ? here === rid : !here)) route();
  else if (err) { const b = document.getElementById("refresh-btn"); if (b) { b.disabled = false; b.textContent = rid ? "지금 다시 조회" : "전체 다시 조회"; } msg(err); }
}

// ------------------------------------------------------------ 목록
async function renderList() {
  let index;
  try { index = await getJSON("data/index.json"); } catch { index = { routes: [] }; }
  setTopRight(index.updated_at ? `<span class="muted small">업데이트 ${new Date(index.updated_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>` : "");

  const order = { active: 0, paused: 1, ended: 2 };
  const routes = [...index.routes].sort((a, b) => order[a.status] - order[b.status] || a.date.localeCompare(b.date));

  $app.innerHTML = `
    <div class="quota-head" style="margin-top:8px"><h2 class="section-title">추적 중인 항공권</h2><span class="muted small">${scheduleText(index.schedule_kst)}</span></div>
    ${routes.length ? routes.filter((r) => r.status === "active").map((r) => `<div class="swipe" data-id="${esc(r.id)}">
      <button type="button" class="swipe-act" data-hide="${esc(r.id)}" data-instant="1" tabindex="-1">숨기기</button>${cardHTML(r)}</div>`).join("") + hiddenHTML(routes.filter((r) => r.status !== "active")) :
      `<div class="card empty"><p>아직 추적 중인 노선이 없어요.</p><p class="muted small">routes.json 에 노선을 추가하면 다음 실행부터 기록돼요.</p></div>`}
    ${refreshHTML(null, routes.filter((r) => r.status === "active").reduce((n, r) => n + (r.cost || 2), 0))}
    <a href="#add" class="btn secondary" style="margin-top:10px">+ 노선 추가하기</a>
    <div style="margin-top:24px">${quotaHTML(index.quota)}</div>
    <a class="settings-link muted small" href="#settings">⚙︎ 앱 설정 · ${ghToken() ? "GitHub 연결됨" : "휴대폰에서 바로 저장하도록 연결하기"}</a>`;
  routes.forEach((r) => { const el = document.getElementById("spark-" + r.id); if (el) sparkline(el, r.spark, r.alert_below); });
  bindRefresh(null);
  bindHide();
  bindSwipe();
  fitOneLine($app);
  window.onresize = () => fitOneLine($app);
  routes.forEach((r) => {
    const el = document.getElementById("plan-" + r.id), p = checkPlan(r, r.status, index.schedule_kst);
    if (el) el.textContent = p ? `다음 조회 ${planLabel(p.next)}경`
      : r.last_checked_at ? `마지막 조회 ${planLabel(new Date(r.last_checked_at))}` : "";
  });
}

// ------------------------------------------------------------ 조회 일정
// 예약 시각(한국시간)과 출발일로, 보는 시점 기준 다음 조회와 마지막 조회를 계산합니다.
function kstNow() { return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })); }
function checkPlan(r, status, times) {
  if (!times || !times.length) return null;  // 예약 조회 없음 (앱에서 누를 때만)
  times = times.slice().sort();
  if (status && status !== "active") return null;
  const now = kstNow();
  const at = (d, t) => { const x = new Date(d); const [h, m] = t.split(":"); x.setHours(+h, +m, 0, 0); return x; };
  let next = null;
  for (let off = 0; off < 2 && !next; off++) {
    const day = new Date(now); day.setDate(day.getDate() + off);
    next = times.map((t) => at(day, t)).find((x) => x > now) || null;
  }
  const lastDay = new Date(r.date + "T00:00:00");
  const last = at(lastDay, times[times.length - 1]);
  if (next && next > last) next = null;
  return next ? { next, last } : null;
}
function planLabel(d, withTime = true) {
  const s = `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`;
  return withTime ? `${s} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : s;
}
function scheduleText(times) {
  return times && times.length ? `조회 매일 ${times.join(" · ")}` : "누를 때만 조회";
}

// ------------------------------------------------------------ SerpApi 잔여 검색 수
function kstToday() {
  const t = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  t.setHours(0, 0, 0, 0);
  return t;
}

function quotaHTML(q) {
  if (!q) return "";
  const fmt = (iso) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const checked = q.checked_at ? `${fmt(q.checked_at)} 기준` : "";
  if (q.total_searches_left == null) {
    return `<section class="card quota">
      <div class="quota-head"><h2 class="section-title">SerpApi 남은 검색</h2><span class="muted small">${esc(checked)}</span></div>
      <p class="muted small" style="margin:0">아직 조회 전이에요. 다음 가격 조회 때 함께 확인돼요.${q.error ? ` (${esc(q.error)})` : ""}</p></section>`;
  }
  const left = q.total_searches_left, total = q.searches_per_month || 0, daily = q.daily_usage || 0;
  const used = total ? Math.min(100, Math.max(0, ((total - (q.plan_searches_left ?? left)) / total) * 100)) : 0;
  const lines = [];
  let level = "good";
  if (q.plan_renewal_date) {
    const renew = new Date(q.plan_renewal_date + "T00:00:00");
    const days = Math.max(0, Math.round((renew - kstToday()) / 86400000));
    const need = daily * days;
    lines.push(`<div class="quota-row"><span class="muted">다음 갱신일</span><span class="num">${md(q.plan_renewal_date)} (${DOW[renew.getDay()]}) · ${days ? `${days}일 남음` : "오늘"}</span></div>`);
    if (daily) lines.push(`<div class="quota-row"><span class="muted">갱신일까지 예상 사용</span><span class="num">${need}회 (하루 ${daily}회)</span></div>`);
    if (need > left) level = "bad";
    else if (need > left * 0.8) level = "warn";
  } else {
    lines.push(`<div class="quota-row"><span class="muted">다음 갱신일</span><span class="muted">정보 없음</span></div>`);
    lines.push(`<div class="quota-row"><span class="muted">하루 사용량</span><span class="num">${daily}회</span></div>`);
    if (daily && left < daily * 7) level = "warn";
  }
  const badge = { good: ["good", "충분해요"], warn: ["warn", "빠듯해요"], bad: ["bad", "갱신 전에 부족해요"] }[level];
  return `<section class="card quota">
    <div class="quota-head"><h2 class="section-title">SerpApi 남은 검색</h2><span class="muted small">${esc(checked)}</span></div>
    <div class="quota-main"><span class="quota-left num">${left.toLocaleString("ko-KR")}회</span>
      ${total ? `<span class="muted num">/ 월 ${total.toLocaleString("ko-KR")}회</span>` : ""}
      <span class="badge ${badge[0]}">${badge[1]}</span></div>
    ${total ? `<div class="quota-bar" role="img" aria-label="이번 달 ${Math.round(used)}% 사용"><span style="width:${used.toFixed(1)}%"></span></div>` : ""}
    ${lines.join("")}
    ${q.extra_credits ? `<div class="quota-row"><span class="muted">추가 크레딧</span><span class="num">${q.extra_credits}회</span></div>` : ""}
    ${q.error ? `<p class="muted small" style="margin:8px 0 0">최근 확인 실패: ${esc(q.error)} · 마지막 성공 값을 보여주고 있어요.</p>` : ""}
  </section>`;
}

// ------------------------------------------------------------ 숨기기 (= 조회 멈춤)
function hiddenHTML(list) {
  if (!list.length) return "";
  return `<details class="card hidden-box">
    <summary><span>숨긴 항공권 ${list.length}개</span><span class="muted small">조회 안 함</span></summary>
    ${list.map((r) => `<div class="hidden-row">
      <a href="#${esc(r.id)}"><span class="fit-line">${routePath(r)}</span>
        <span class="muted small">${r.status === "ended" ? "출발일 지남" : dday(r.date)}${r.summary && r.summary.current != null ? ` · 마지막 ${won(r.summary.current)}` : ""}</span></a>
      ${r.status === "paused" ? `<button type="button" class="btn secondary" data-show="${esc(r.id)}">다시 보이기</button>` : ""}
    </div>`).join("")}
  </details>`;
}
// 숨김 상태를 화면에 먼저 반영 (저장소 반영 · 사이트 재생성 1~2분을 기다리지 않음)
async function markStatus(id, status) {
  const until = Date.now() + 3 * 60000;
  try {
    const index = await getJSON("data/index.json");
    FRESH["data/index.json"] = { data: { ...index, routes: index.routes.map((x) => (x.id === id ? { ...x, status } : x)) }, until };
  } catch {}
  try {
    const p = `data/routes/${encodeURIComponent(id)}.json`;
    FRESH[p] = { data: { ...(await getJSON(p)), status }, until };
  } catch {}
}
async function setHidden(id, hide) {
  if (!ghToken()) { location.hash = "#settings"; return; }
  await markStatus(id, hide ? "paused" : "active");
  if (hide && decodeURIComponent(location.hash.slice(1)) === id) location.hash = "#"; else route();
  if (hide) toast("숨겼어요 · 조회 멈춤", "되돌리기", () => setHidden(id, false));
  try {
    await saveRoutes((routes) => routes.map((x) => (x.id === id ? { ...x, active: !hide } : x)), `앱에서 노선 ${hide ? "숨기기" : "다시 보이기"}: ${id}`);
  } catch (err) {
    await markStatus(id, hide ? "active" : "paused");
    route();
    alert(err.status === 401 ? "GitHub 연결이 끊겼어요. 앱 설정에서 다시 연결해 주세요." : `저장하지 못했어요 (${err.message})`);
  }
}
function toast(text, actLabel, act) {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<span>${esc(text)}</span>${actLabel ? `<button type="button">${esc(actLabel)}</button>` : ""}`;
  document.body.appendChild(t);
  const close = () => t.remove();
  if (actLabel) t.querySelector("button").onclick = () => { close(); act(); };
  setTimeout(close, 5000);
}
function bindHide() {
  document.querySelectorAll(".hidden-box").forEach((d) => d.ontoggle = () => d.open && fitOneLine(d));
  document.querySelectorAll("[data-hide],[data-show]").forEach((b) => b.onclick = (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const show = !!b.dataset.show, id = b.dataset.show || b.dataset.hide;
    if (!show && !b.dataset.instant && !confirm("이 항공권을 숨길까요? 숨기면 조회도 멈춰요. 목록 아래 '숨긴 항공권'에서 언제든 다시 보이게 할 수 있어요.")) return;
    setHidden(id, !show);
  });
}

// 메인 목록 카드: 왼쪽으로 밀면 [숨기기] 버튼
function bindSwipe() {
  const OPEN = 96;
  let opened = null;
  const set = (card, x, anim) => { card.style.transition = anim ? "transform .2s ease" : "none"; card.style.transform = x ? `translateX(${x}px)` : ""; };
  const closeOpen = () => { if (opened) { set(opened, 0, true); opened.parentElement.classList.remove("open"); opened = null; } };
  document.querySelectorAll(".swipe").forEach((box) => {
    const card = box.querySelector(".route-card");
    let x0 = 0, y0 = 0, dx = 0, base = 0, mode = null, moved = false;
    card.addEventListener("touchstart", (e) => {
      const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; mode = null; moved = false;
      base = opened === card ? -OPEN : 0;
      if (opened && opened !== card) closeOpen();
    }, { passive: true });
    card.addEventListener("touchmove", (e) => {
      const t = e.touches[0], mx = t.clientX - x0, my = t.clientY - y0;
      if (!mode && Math.abs(mx) + Math.abs(my) > 8) mode = Math.abs(mx) > Math.abs(my) ? "x" : "y";
      if (mode !== "x") return;
      e.preventDefault(); moved = true;
      dx = Math.max(-OPEN - 30, Math.min(0, base + mx));
      box.classList.add("open");
      set(card, dx, false);
    }, { passive: false });
    card.addEventListener("touchend", () => {
      if (mode !== "x") return;
      if (dx < -OPEN / 2) { set(card, -OPEN, true); opened = card; box.classList.add("open"); }
      else { set(card, 0, true); box.classList.remove("open"); if (opened === card) opened = null; }
    });
    card.addEventListener("click", (e) => {
      if (moved || opened === card) { e.preventDefault(); if (!moved) closeOpen(); moved = false; }
    });
  });
  document.onclick = (e) => { if (opened && !e.target.closest(".swipe")) closeOpen(); };
}

function cardHTML(r) {
  const s = r.summary || {};
  const badges = [];
  if (r.status === "ended") badges.push(`<span class="badge">추적 종료</span>`);
  if (r.status === "paused") badges.push(`<span class="badge">일시 중지</span>`);
  if (s.current != null && r.alert_below && s.current <= r.alert_below) badges.push(`<span class="badge good">목표가 도달</span>`);
  if (s.current != null && s.days > 1 && s.current === s.min) badges.push(`<span class="badge good">역대 최저가</span>`);
  return `
  <a class="card route-card" href="#${esc(r.id)}">
    <div class="route-name fit-line">${routePath(r)}</div>
    <div>
      <div class="route-meta">${dday(r.date)}</div>
      <div class="badges">${badges.join("")}</div>
      <div class="route-plan muted small" id="plan-${esc(r.id)}"></div>
    </div>
    <div>
      <div class="route-price num">${won(s.current)}</div>
      <div class="route-delta num">${deltaHTML(s.current, s.prev)}</div>
    </div>
    ${r.spark && r.spark.length > 1 ? `<svg class="spark" id="spark-${esc(r.id)}" aria-hidden="true"></svg>
      <div class="spark-range muted small">${r.spark_dates && r.spark_dates.length > 1 ? `${md(r.spark_dates[0])} ~ ${md(r.spark_dates[r.spark_dates.length - 1])} · ` : ""}${r.spark.length}일 기록</div>` : ""}
  </a>`;
}

function sparkline(svg, data, target) {
  const W = svg.clientWidth || 300, H = 36, p = 4;
  const lo = Math.min(...data), hi = Math.max(...data), span = hi - lo || 1;
  const x = (i) => p + (i * (W - 2 * p)) / (data.length - 1);
  const y = (v) => H - p - ((v - lo) / span) * (H - 2 * p);
  const d = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = data.length - 1;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  // 날마다 작은 점을 찍어 며칠치인지 보이게 하고, 마지막 날은 크게
  const dots = data.length <= 31 ? data.slice(0, last).map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" fill="var(--accent)"/>`).join("") : "";
  svg.innerHTML = `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}<circle cx="${x(last)}" cy="${y(data[last])}" r="4" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/>`;
}

// ------------------------------------------------------------ 비교 사이트 링크
// tracker/check_prices.py 의 compare_links 와 같은 규칙입니다.
// 공항 여러 개("ICN,GMP")는 비교 사이트에 도시 코드로 넘김 (tracker/check_prices.py site_codes 와 같은 규칙)
const METRO = [[["ICN", "GMP"], "SEL", "sela"], [["KIX", "ITM", "UKB"], "OSA", "osaa"], [["HND", "NRT"], "TYO", "tyoa"],
  [["PVG", "SHA"], "SHA", "csha"], [["PEK", "PKX"], "BJS", "bjsa"], [["TPE", "TSA"], "TPE", "tpet"]];
const REGION_SITES = { KR: ["SEL", "sela"], JP: ["TYO", "jp"] };
function siteCodes(codes) {
  const items = (codes || "").toUpperCase().split(",").map((c) => c.trim()).filter(Boolean);
  const region = items.find((c) => REGION_SITES[c]);
  if (region) return REGION_SITES[region];
  if (items.length <= 1) return [items[0] || "", (items[0] || "").toLowerCase()];
  const m = METRO.find(([members]) => items.every((c) => members.includes(c)));
  return m ? [m[1], m[2]] : [items[0], items[0].toLowerCase()];
}

function compareLinks(r) {
  const [org, skyOrg] = siteCodes(r.from), [dst, skyDst] = siteCodes(r.to);
  const adults = +(r.adults || 1), ret = r.return_date, direct = r.max_stops === 0;
  const kc = { economy: "", premium_economy: "/premium", business: "/business", first: "/first" }[r.travel_class || "economy"] || "";
  const sc = { economy: "economy", premium_economy: "premiumeconomy", business: "business", first: "first" }[r.travel_class || "economy"] || "economy";
  const kTail = kc + (adults > 1 ? `/${adults}adults` : "") + "?sort=price_a" + (direct ? "&fs=stops=0" : "");
  if (r.legs && r.legs.length) {
    const q = new URLSearchParams({ adultsv2: adults, cabinclass: sc, rtn: 2, preferdirects: direct ? "true" : "false" });
    return {
      kayak: "https://www.kayak.co.kr/flights/" + r.legs.map((l) => `${l.from.toUpperCase()}-${l.to.toUpperCase()}/${l.date}`).join("/") + kTail,
      skyscanner: "https://www.skyscanner.co.kr/transport/d/" + r.legs.map((l) => `${l.from.toLowerCase()}/${l.date}/${l.to.toLowerCase()}`).join("/") + "/?" + q,
    };
  }
  let kayak = `https://www.kayak.co.kr/flights/${org}-${dst}/${r.date}` + (ret ? `/${ret}` : "") + kTail;
  const ymd = (iso) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
  let sky = `https://www.skyscanner.co.kr/transport/flights/${skyOrg}/${skyDst}/${ymd(r.date)}/` + (ret ? `${ymd(ret)}/` : "");
  sky += "?" + new URLSearchParams({ adultsv2: adults, cabinclass: sc, rtn: ret ? 1 : 0, preferdirects: direct ? "true" : "false" });
  return { kayak, skyscanner: sky };
}

function compareHTML(r) {
  const l = compareLinks(r);
  return `<div class="compare">
      <a class="btn secondary" id="cmp-kayak" href="${esc(l.kayak)}" target="_blank" rel="noopener">Kayak 비교</a>
      <a class="btn secondary" id="cmp-sky" href="${esc(l.skyscanner)}" target="_blank" rel="noopener">Skyscanner 비교</a>
    </div>
    <p class="muted small compare-note" id="cmp-note">같은 날짜·인원·좌석으로 열려요. 출발 시간대 조건은 각 사이트에서 직접 설정해 주세요.</p>`;
}

// 고르기 화면에서 고른 편들의 실제 공항 · 날짜로 비교 링크를 바꿈 (나라 전체 · 여러 공항 대신 정확한 공항)
// flights: [{ dep_airport, arr_airport, date, depart_time }...] 여정 순서
function updateCompare(r, flights) {
  const k = document.getElementById("cmp-kayak"), sk = document.getElementById("cmp-sky");
  if (!k || !sk || !flights.length || flights.some((f) => !f || !f.dep_airport || !f.arr_airport || !f.date)) return;
  const base = { adults: r.adults, travel_class: r.travel_class, max_stops: r.max_stops };
  const [a, b] = flights;
  const roundTrip = flights.length === 2 && a.dep_airport === b.arr_airport && a.arr_airport === b.dep_airport;
  const rr = flights.length === 1 ? { ...base, from: a.dep_airport, to: a.arr_airport, date: a.date }
    : roundTrip ? { ...base, from: a.dep_airport, to: a.arr_airport, date: a.date, return_date: b.date }
    : { ...base, legs: flights.map((f) => ({ from: f.dep_airport, to: f.arr_airport, date: f.date })) };
  const l = compareLinks(rr);
  k.href = l.kayak; sk.href = l.skyscanner;
  const note = document.getElementById("cmp-note");
  if (note) note.textContent = `고른 항공편 기준(${flights.map((f) => `${md(f.date)} ${f.dep_airport}→${f.arr_airport}${f.depart_time ? ` ${f.depart_time}` : ""}`).join(" · ")})으로 열려요. 시간은 각 사이트에서 골라 주세요.`;
}

// ------------------------------------------------------------ 상세
// 상세 화면 위쪽: 목록으로 돌아가기 + 다른 추적 항공편으로 바로 이동하는 선택 상자
// 선택 상자용 짧은 이름: 출발일 기준 "6월 26일 시작 여행"
function tripTitle(r) {
  if (r.flex) return `${flexShort(r.flex)} 여행`;
  const [, m, d] = r.date.split("-");
  return `${+m}월 ${+d}일 시작 여행`;
}

function switcherHTML(current, routes) {
  const order = { active: 0, paused: 1, ended: 2 };
  const list = [...routes].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.date.localeCompare(b.date));
  return `<div class="switch-box">
      <button type="button" class="switch-btn" id="switch-btn" aria-haspopup="true" aria-expanded="false" aria-controls="switch-menu"
        aria-label="다른 추적 항공편 보기 (지금: ${esc(current.name)})">
        <span class="switch-name">${tripTitle(current)}</span>
        <span class="switch-chev" aria-hidden="true">▾</span>
      </button>
      <div class="switch-menu" id="switch-menu" hidden>
        ${list.map((x) => {
          const on = x.id === current.id;
          return `<a class="switch-item${on ? " on" : ""}" href="#${esc(encodeURIComponent(x.id))}"${on ? ' aria-current="page"' : ""}>
            <span class="n">${on ? "✓ " : ""}${tripTitle(x)}${x.status !== "active" ? ` <span class="badge">${x.status === "ended" ? "종료" : "중지"}</span>` : ""}</span>
            <span class="m">${routePath(x)}</span>
          </a>`; }).join("")}
      </div>
    </div>`;
}

function bindSwitcher() {
  const btn = document.getElementById("switch-btn"), menu = document.getElementById("switch-menu");
  if (!btn) return;
  const set = (open) => { menu.hidden = !open; btn.setAttribute("aria-expanded", open); btn.parentElement.classList.toggle("open", open); };
  btn.onclick = (e) => { e.stopPropagation(); set(menu.hidden); };
  menu.onclick = (e) => { if (e.target.closest("a")) set(false); };
  document.onclick = (e) => { if (!menu.hidden && !e.target.closest(".switch-box")) set(false); };
  document.onkeydown = (e) => { if (e.key === "Escape" && !menu.hidden) { set(false); btn.focus(); } };
}

async function renderDetail(id) {
  let doc, index;
  try { [doc, index] = await Promise.all([getJSON(`data/routes/${encodeURIComponent(id)}.json`), getJSON("data/index.json").catch(() => ({ routes: [] }))]); }
  catch { $app.innerHTML = `<a class="back" href="#">‹ 목록</a><div class="card empty">노선을 찾을 수 없어요.</div>`; return; }

  const r = doc.route, s = doc.summary || {}, hist = doc.history || [];
  const ok = hist.filter((h) => h.price != null);
  const lastEntry = ok[ok.length - 1];
  const todayEntry = hist[hist.length - 1];

  let verdict = "", pos = null;
  if (s.current != null && s.max != null) {
    pos = s.max === s.min ? 0.5 : (s.current - s.min) / (s.max - s.min);
    if (s.days < 3) verdict = "기록이 쌓이는 중이에요. 며칠 더 지켜봐요.";
    else if (s.current === s.min) verdict = "🎉 추적을 시작한 뒤 가장 싼 가격이에요!";
    else if (pos <= 0.25) verdict = "지금 사기 좋은 가격이에요.";
    else if (pos <= 0.6) verdict = "평균 정도 가격이에요.";
    else verdict = "평소보다 비싸요. 조금 기다려 보세요.";
  }
  const lvl = lastEntry && LEVEL[lastEntry.price_level];
  const badges = [];
  if (doc.status === "ended") badges.push(`<span class="badge">추적 종료</span>`);
  if (s.current != null && r.alert_below && s.current <= r.alert_below) badges.push(`<span class="badge good">목표가 도달</span>`);
  if (lvl) badges.push(`<span class="badge ${lvl[0]}">${lvl[1]}</span>`);
  if (todayEntry && todayEntry.price == null && todayEntry.error) badges.push(`<span class="badge warn" title="${esc(todayEntry.error)}">최근 조회 실패</span>`);

  const routes = index.routes && index.routes.some((x) => x.id === r.id) ? index.routes : [{ ...r, status: doc.status, summary: s }];
  setTopRight(switcherHTML(r, routes));
  $app.innerHTML = `
    <section class="card">
      <div class="hero-top">${pathWithDatesHTML(r)}<span class="hero-dday">${dday(r.date)}</span></div>
      <div class="hero-price num">${won(s.current)}</div>
      ${lastEntry && lastEntry.flex_date ? `<div class="flex-best">가장 싼 날 <b>${dayLabel(lastEntry.flex_date)}${lastEntry.flex_return_date ? ` ~ ${dayLabel(lastEntry.flex_return_date)}` : ""}</b>${
        (lastEntry.flex_top || []).slice(1, 4).length ? `<span class="muted"> · 다음 ${(lastEntry.flex_top || []).slice(1, 4).map((t) => `${md(t.date)} ${won(t.price)}`).join(" · ")}</span>` : ""}</div>` : ""}
      <div class="hero-delta num">${deltaHTML(s.current, s.prev)}${s.prev != null && s.current !== s.prev ? ` <span class="muted small">어제 대비</span>` : ""}</div>
      <div class="badges" style="margin-top:10px">${badges.join("")}</div>
      ${pos != null ? `
      <div class="gauge">
        <div class="gauge-track"><div class="gauge-dot" style="left:${(pos * 100).toFixed(1)}%"></div></div>
        <div class="gauge-labels num"><span>최저 ${won(s.min)}</span><span>최고 ${won(s.max)}</span></div>
      </div>
      <div class="verdict">${verdict}</div>` : ""}
      <div class="stats num">
        <div class="stat"><div class="label">역대 최저</div><div class="value">${won(s.min)}</div></div>
        <div class="stat"><div class="label">평균</div><div class="value">${won(s.avg)}</div></div>
        <div class="stat"><div class="label">역대 최고</div><div class="value">${won(s.max)}</div></div>
      </div>
    </section>

    <section class="card">
      <h3 class="section-title">가격 변동</h3>
      <div class="chips" role="group" aria-label="기간">
        <button class="chip" data-range="7">7일</button>
        <button class="chip" data-range="30">30일</button>
        <button class="chip" data-range="0" aria-pressed="true">전체</button>
      </div>
      <div class="chart-wrap" id="chart-wrap">
        <svg class="chart" id="chart" role="img" aria-label="날짜별 최저가 그래프"></svg>
        <div class="tooltip" id="tip"></div>
      </div>
      <div class="legend"><span><i></i>그날의 최저가</span>${r.alert_below ? `<span><i class="target"></i>목표가 ${won(r.alert_below)}</span>` : ""}</div>
    </section>

    ${doc.google_flights_url ? `<a class="btn" href="${esc(doc.google_flights_url)}" target="_blank" rel="noopener">Google 항공권에서 예약하기</a>` : ""}
    ${compareHTML(lastEntry && lastEntry.flex_date ? { ...r, date: lastEntry.flex_date, return_date: lastEntry.flex_return_date || r.return_date }
      // 다구간: 최근 조회에서 고른 실제 공항으로 (JP · SEL 같은 넓은 곳은 비교 사이트가 못 알아들음)
      : r.legs && lastEntry && lastEntry.legs && lastEntry.legs.every((l) => /^[A-Z]{3}$/.test(l.from) && /^[A-Z]{3}$/.test(l.to))
        ? { ...r, legs: lastEntry.legs.map((l) => ({ from: l.from, to: l.to, date: l.date })) } : r)}
    ${doc.status === "active" ? refreshHTML(r.id, ((index.routes || []).find((x) => x.id === r.id) || {}).cost || 2, (hist[hist.length - 1] || {}).checked_at) : ""}

    ${optionsHTML(lastEntry, r)}

    <section class="card">
      <h3 class="section-title">날짜별 기록</h3>
      <table class="history num">
        <thead><tr><th>조회일</th><th>항공편</th><th class="r">최저가</th></tr></thead>
        <tbody>${[...hist].reverse().map((h, i, arr) => {
          const prev = arr.slice(i + 1).find((x) => x.price != null);
          return `<tr>
            <td>${md(h.date)}</td>
            <td>${h.price == null ? `<span class="muted">${esc(h.error || "기록 없음")}</span>`
              : h.legs ? h.legs.map((l, j) => legHTML(l, "", `${j + 1}구간 `)).join("")
              : legHTML(h, "", h.return_airline ? "가는 편 " : "") + (h.return_airline ? legHTML(h, "return_", "오는 편 ") : "")}</td>
            <td class="r">${won(h.price)}${h.price != null && prev ? `<div class="sub">${deltaHTML(h.price, prev.price).replace(/ \(.*?\)/, "")}</div>` : ""}</td>
          </tr>`; }).join("")}</tbody>
      </table>
    </section>

    <section class="card">
      <h3 class="section-title">추적 조건</h3>
      ${r.legs && r.legs.length
        ? r.legs.map((l, i) => `<div class="info-row"><span>${i + 1}구간 ${md(l.date)} ${esc(l.from)}→${esc(l.to)}</span><span>${timeRange(l.depart_after, l.depart_before)}</span></div>`).join("")
        : `<div class="info-row"><span>가는 편 출발</span><span>${timeRange(r.depart_after, r.depart_before)}</span></div>`}
      ${r.return_date ? `<div class="info-row"><span>오는 편 출발</span><span>${timeRange(r.return_after, r.return_before)}</span></div>` : ""}
      ${(() => { const p = checkPlan(r, doc.status, doc.schedule_kst); return p ? `
      <div class="info-row"><span>다음 조회</span><span>${planLabel(p.next)}경</span></div>` : ""; })()}
      <div class="info-row"><span>인원</span><span>성인 ${r.adults || 1}명</span></div>
      <div class="info-row"><span>좌석</span><span>${{ economy: "일반석", premium_economy: "프리미엄 일반석", business: "비즈니스", first: "일등석" }[r.travel_class] || "일반석"}</span></div>
      <div class="info-row"><span>경유</span><span>${r.max_stops == null ? "상관없음" : r.max_stops === 0 ? "직항만" : `${r.max_stops}회 이하`}</span></div>
      <a class="btn secondary" href="#edit/${esc(encodeURIComponent(r.id))}" style="margin-top:14px">조건 바꾸기 (직항 · 시간 · 인원 등)</a>
      ${doc.status === "active" ? `<button type="button" class="btn secondary hide-btn" data-hide="${esc(r.id)}">목록에서 숨기기 (조회 멈춤)</button>`
        : doc.status === "paused" ? `<button type="button" class="btn secondary hide-btn" data-show="${esc(r.id)}">다시 보이기 (조회 다시 시작)</button>` : ""}
    </section>`;

  const draw = (days) => drawChart(days ? hist.slice(-days) : hist, r.alert_below);
  document.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x === b));
    draw(+b.dataset.range);
  }));
  draw(0);
  bindSwitcher();
  bindRefresh(r.id);
  bindHide();
  if (lastEntry && document.getElementById("lp-card")) mountLegPicker(lastEntry, r);
  if (lastEntry && document.getElementById("rt-card")) mountRoundTrip(lastEntry, { ...r, return_date: r.return_date });
  fitOneLine($app);
  window.onresize = () => { draw(+document.querySelector('.chip[aria-pressed="true"]').dataset.range); fitOneLine($app); };
}

function timeRange(a, b) {
  if (!a && !b) return "상관없음";
  if (!b || b === "24:00") return `${esc(a)} 이후`;
  if (!a || a === "00:00") return `${esc(b)} 이전`;
  return `${esc(a)} ~ ${esc(b)}`;
}

// 항공사 로고(작은 동그라미). 로고 주소가 없거나 못 불러오면 편명 앞 항공사 코드(예: RS 701 → RS)
function logoHTML(o) {
  const code = ((o.flight_number || "").trim().match(/^([A-Z0-9]{2})\s*\d/i) || [])[1];
  const ch = esc(code ? code.toUpperCase() : (o.airline || "?").trim().charAt(0));
  const safe = /^https:\/\/[\w.-]+\.(gstatic|googleusercontent|google)\.com\//.test(o.airline_logo || "");
  return `<span class="o-logo${safe ? " has-img" : ""}" title="${esc(o.airline || "")}" aria-label="${esc(o.airline || "")}">${safe
    ? `<img src="${esc(o.airline_logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('${ch}'))">`
    : ch}</span>`;
}

// 마지막 조회에서 조건에 맞았던 항공편들 (가격순, 최대 30개) — 상자 안에서 스크롤
const mixedDays = (opts) => new Set((opts || []).map((o) => o.date).filter(Boolean)).size > 1;
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const optSub = (o, showDate) => [showDate && o.date ? md(o.date) : "", o.dep_airport && o.arr_airport ? `${esc(o.dep_airport)}→${esc(o.arr_airport)}` : "", o.stops > 0 ? `경유 ${o.stops}회` : ""].filter(Boolean).join(" · ");

function optListHTML(opts, label) {
  const showDate = mixedDays(opts);
  return `<ol class="opts${opts.length > 5 ? " scroll" : ""}" tabindex="0" aria-label="${label}">${opts.map((o, i) => `
      <li>
        ${logoHTML(o)}
        <div class="o-main num">${esc(o.depart_time)} → ${esc(o.arrive_time)}</div>
        <div class="o-sub muted small">${optSub(o, showDate)}</div>
        <div class="o-price num">${won(o.price)}${i === 0 ? `<span class="o-best">최저</span>` : ""}</div>
      </li>`).join("")}
    </ol>`;
}

// 최저가 조합 한 줄 (가는 편 / 오는 편)
function comboRowHTML(tag, day, o) {
  return `<div class="combo-row">
      ${logoHTML(o)}
      <div class="o-main num"><span class="combo-tag">${tag}</span>${esc(o.depart_time)} → ${esc(o.arrive_time)}</div>
      <div class="o-sub muted small">${day ? `${dayLabel(day)} · ` : ""}${o.dep_airport && o.arr_airport ? `${esc(o.dep_airport)}→${esc(o.arr_airport)}` : ""}${o.stops > 0 ? ` · 경유 ${o.stops}회` : ""}</div>
    </div>`;
}

function optionsHTML(e, r) {
  if (e && legPickerData(e, r)) return `<section class="card rt-card" id="lp-card">
    <h3 class="section-title">${e.leg_options ? "구간별 항공편 고르기" : "항공편 고르기"}</h3>
    <div id="lp-body"></div>
  </section>`;
  const outs = (e && e.options) || [];
  const rets = (e && e.return_options) || [];
  if (outs.length < 2 && rets.length < 2) return "";
  const round = !!(e.return_airline || r.return_date || (r.flex && r.flex.trip_days));
  const outDay = e.flex_date || r.date, retDay = e.flex_return_date || r.return_date;
  const hint = (n) => (n > 5 ? " · 상자 안을 스크롤하면 더 보여요" : "");
  if (!round || !rets.length) {
    return `<section class="card">
    <h3 class="section-title">조건에 맞는 항공편 ${outs.length}개</h3>
    <p class="muted small" style="margin:-6px 0 6px">${mixedDays(outs) ? "후보 날짜 모두 · " : e.flex_date ? `${dayLabel(e.flex_date)} 출발 · ` : ""}${round ? "가는 편 기준 · 가격은 왕복 최저가" : "가격순"} · ${md(e.date)} 조회${hint(outs.length)}</p>
    ${optListHTML(outs, "조건에 맞는 항공편 목록")}
  </section>`;
  }
  return `<section class="card rt-card" id="rt-card">
    <h3 class="section-title">왕복 조합 고르기</h3>
    <div id="rt-body"></div>
  </section>`;
}

// ---------- 구간 고르기 (편도 · 구간별 편도 합산 다구간): 구간마다 편을 고르면 총액 = 고른 편 가격의 합
const hm = (t) => { const [h, m] = String(t || "0:0").split(":"); return +h * 60 + +m; };
const WIDE = new Set(["KR", "JP", "SEL", "TYO", "OSA", "SPK"]);
const METRO_CITY = { ICN: "SEL", GMP: "SEL", KIX: "OSA", ITM: "OSA", UKB: "OSA", HND: "TYO", NRT: "TYO", PVG: "SHA", SHA: "SHA", PEK: "BJS", PKX: "BJS", TPE: "TPE", TSA: "TPE" };
const isWide = (c) => { c = String(c || "").trim().toUpperCase(); return WIDE.has(c) || c.startsWith("/") || c.includes(","); };
function legPickerData(e, r) {
  if (e.leg_options && r.legs && e.leg_options.length === r.legs.length && e.leg_options.every((x) => x && x.length)) {
    return { legs: r.legs, opts: e.leg_options };
  }
  const round = !!(e.return_airline || r.return_date || (r.flex && r.flex.trip_days));
  if (!round && !r.legs && e.options && e.options.length > 1) {
    return { legs: [{ from: r.from, to: r.to, date: e.flex_date || r.date }], opts: [e.options] };
  }
  return null;
}
function mountLegPicker(e, r) {
  const host = document.getElementById("lp-body");
  const data = host && legPickerData(e, r);
  if (!data) return;
  const { legs, opts } = data, n = legs.length;
  const minConn = r.min_connection_min || 120;
  // 앞 구간 편 a 와 다음 구간 편 b 가 이어지는지 (같은 넓은 곳이면 같은 도시, 같은 날이면 환승 시간)
  const fits = (i, a, b) => {
    const p = legs[i], q = legs[i + 1];
    if (String(p.to).trim().toUpperCase() === String(q.from).trim().toUpperCase() && isWide(q.from)
        && a.arr_airport && b.dep_airport && (METRO_CITY[a.arr_airport] || a.arr_airport) !== (METRO_CITY[b.dep_airport] || b.dep_airport)) return false;
    const da = a.date || p.date, db = b.date || q.date;
    if (da === db && a.arrive_time && hm(a.arrive_time) + minConn > hm(b.depart_time)) return false;
    return true;
  };
  const st = { rev: false, sel: [] };
  const order = () => (st.rev ? [...Array(n).keys()].reverse() : [...Array(n).keys()]);
  // rest[s][j]: 순서상 s 번째 구간에서 j 편을 골랐을 때 남은 구간까지 포함한 최저 합계
  const restTable = (ord) => {
    const rest = Array(n);
    for (let s = n - 1; s >= 0; s--) {
      const li = ord[s];
      rest[s] = opts[li].map((o) => {
        if (s === n - 1) return o.price;
        const lj = ord[s + 1];
        let best = Infinity;
        opts[lj].forEach((x, k) => {
          const ok = li < lj ? fits(li, o, x) : fits(lj, x, o);
          if (ok && rest[s + 1][k] < best) best = rest[s + 1][k];
        });
        return o.price + best;
      });
    }
    return rest;
  };
  const draw = () => {
    const ord = order(), rest = restTable(ord);
    const base = Math.min(...rest[0]);
    // 고르지 않은 단계는 앞 선택에 이어지는 가장 싼 편으로 채움
    const pick = [];
    let prefix = 0;
    const steps = ord.map((li, s) => {
      const prev = s ? { li: ord[s - 1], o: opts[ord[s - 1]][pick[s - 1]] } : null;
      const ok = (o) => !prev || (prev.li < li ? fits(prev.li, prev.o, o) : fits(li, o, prev.o));
      const cand = opts[li].map((o, j) => ({ o, j, total: prefix + rest[s][j] })).filter((c) => isFinite(c.total) && ok(c.o)).sort((x, y) => x.total - y.total);
      let j = st.sel[s];
      if (j == null || !cand.some((c) => c.j === j)) j = cand.length ? cand.reduce((a, c) => (c.total < a.total ? c : a)).j : null;
      pick[s] = j;
      const html = { li, cand, j };
      if (j != null) prefix += opts[li][j].price;
      return html;
    });
    const done = pick.every((j) => j != null);
    const total = done ? ord.reduce((t, li, s) => t + opts[li][pick[s]].price, 0) : null;
    const chosen = Array(n);
    ord.forEach((li, s) => (chosen[li] = pick[s] != null ? opts[li][pick[s]] : null));
    if (done) updateCompare(r, chosen.map((o, i) => ({ ...o, date: o.date || legs[i].date })));
    const legName = (l) => `${String(l.from).toUpperCase()}→${String(l.to).toUpperCase()}`;
    const diff = total == null ? 0 : Math.abs(total - base) < 500 ? 0 : total - base;
    host.innerHTML = `
      ${n > 1 ? `<div class="seg rt-mode" role="tablist">
        <button type="button" data-rev="0" class="${st.rev ? "" : "on"}" aria-selected="${!st.rev}">${n === 2 ? "1구간 먼저" : "앞 구간부터"}</button>
        <button type="button" data-rev="1" class="${st.rev ? "on" : ""}" aria-selected="${st.rev}">${n === 2 ? "2구간 먼저" : "뒤 구간부터"}</button>
      </div>` : ""}
      ${done ? `<div class="combo">
        <div class="combo-head"><span class="muted small">${n > 1 ? "선택한 일정" : "선택한 항공편"}</span><b class="num">${won(total)}</b></div>
        ${chosen.map((o, i) => comboRowHTML(n > 1 ? `${i + 1}구간` : "가는 편", o.date || legs[i].date, o)).join("")}
        ${diff ? `<div class="combo-diff muted small">최저가보다 <b class="${diff > 0 ? "up" : "down"}">${diff > 0 ? "+" : "−"}${won(Math.abs(diff))}</b></div>`
          : `<div class="combo-diff small"><span class="o-best" style="display:inline">최저가 ${n > 1 ? "조합" : ""}</span></div>`}
        ${n > 1 ? `<div class="combo-diff muted small">구간마다 따로 예약하는 편도 항공권 합계예요</div>` : ""}
      </div>` : ""}
      ${steps.map((st2, s) => {
        const l = legs[st2.li];
        return `${n > 1 ? `<div class="rt-step"><span class="rt-no">${s + 1}</span>${st2.li + 1}구간 고르기 <span class="muted small">· ${l.date ? dayLabel(l.date) : ""} · ${esc(legName(l))}${s ? " · 앞에서 고른 편과 이어지는 편" : ""}</span></div>`
          : `<p class="muted small" style="margin:10px 0 6px">${l.date ? `${dayLabel(l.date)} · ` : ""}가격순 · ${md(e.date)} 조회</p>`}
        ${st2.cand.length ? `<ol class="opts rt-list${st2.cand.length > 5 ? " scroll" : ""}">${st2.cand.map((c) =>
            rtRowHTML({ ...c.o, price: c.total }, c.j, "leg" + s, c.j === st2.j, base, mixedDays(opts[st2.li]))).join("")}</ol>`
          : `<p class="rt-wait muted small">앞에서 고른 편과 이어지는 편이 없어요.</p>`}`;
      }).join("")}`;
    host.querySelectorAll(".rt-row").forEach((b) => b.onclick = () => {
      const s = +b.dataset.kind.slice(3);
      st.sel[s] = +b.dataset.i;
      st.sel.length = s + 1;  // 뒤 단계는 다시 가장 싼 편으로
      draw();
    });
    host.querySelectorAll(".rt-mode button").forEach((b) => b.onclick = () => { st.rev = b.dataset.rev === "1"; st.sel = []; draw(); });
  };
  draw();
}

// ---------- 왕복: 1단계 가는 편 → 2단계 오는 편 (가는 편마다 오는 편은 앱에서 요청해 조회)
function rtRowHTML(o, idx, kind, selected, base, showDate) {
  const d = Math.abs(o.price - base) < 500 ? 0 : o.price - base;  // 조회 간 몇백 원 차이는 같은 값으로
  const delta = kind === "rfetch" ? `<span class="o-delta fetch">조합 조회 ›</span>` : d === 0 ? `<span class="o-best">최저</span>` : `<span class="o-delta ${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${won(Math.abs(d))}</span>`;
  return `<li><button type="button" class="rt-row${selected ? " sel" : ""}" data-kind="${kind}" data-i="${idx}" aria-pressed="${selected}">
      ${logoHTML(o)}
      <span class="o-main num">${esc(o.depart_time)} → ${esc(o.arrive_time)}</span>
      <span class="o-sub muted small">${optSub(o, showDate)}</span>
      <span class="o-price num">${won(o.price)}${delta}</span>
    </button></li>`;
}

async function mountRoundTrip(e, r) {
  const host = document.getElementById("rt-body");
  if (!host) return;
  const outs = e.options || [];
  const base = outs.length ? Math.min(outs[0].price, e.price) : e.price;  // 최저가 조합
  const outDay = e.flex_date || r.date, retDay = e.flex_return_date || r.return_date;
  const mixed = mixedDays(outs);
  const dayOf = (o) => o.date || outDay;
  const keyOf = (o) => `${dayOf(o)}|${o.flight_number}|${o.depart_time}`;
  const tripDays = r.flex && r.flex.trip_days;
  const retDayOf = (i) => {  // 가는 편마다 오는 날 (날짜가 섞여 있으면 가는 날 + 여행 기간)
    const o = outs[i];
    if (!o || i === 0 || dayOf(o) === outDay) return retDay;
    const it = st.items[keyOf(o)];
    return (it && it.return_date) || (tripDays ? addDays(dayOf(o), +tripDays) : r.return_date);
  };
  const cheapestBack = { price: e.price, depart_time: e.return_depart_time, arrive_time: e.return_arrive_time, stops: e.return_stops,
    dep_airport: e.return_dep_airport, arr_airport: e.return_arr_airport, airline: e.return_airline,
    flight_number: e.return_flight_number, airline_logo: e.return_airline_logo };
  const st = { mode: "out", out: 0, ret: 0, rkey: null, rout: 0, items: {}, loading: {} };
  // 저장돼 있는 '가는 편별 오는 편' 결과 불러오기
  try { st.items = (await getJSON(`data/returns/${encodeURIComponent(r.id)}.json`)).items || {}; } catch {}
  const returnsFor = (i) => {
    if (i === 0) return e.return_options && e.return_options.length ? e.return_options : [cheapestBack];
    const it = st.items[keyOf(outs[i])];
    return it && it.returns;
  };

  const diffHTML = (total) => {
    const diff = Math.abs(total - base) < 500 ? 0 : total - base;
    return diff ? `<div class="combo-diff muted small">최저가 조합보다 <b class="${diff > 0 ? "up" : "down"}">${diff > 0 ? "+" : "−"}${won(Math.abs(diff))}</b></div>`
      : `<div class="combo-diff small"><span class="o-best" style="display:inline">최저가 조합</span></div>`;
  };
  const modeHTML = () => `<div class="seg rt-mode" role="tablist">
      <button type="button" role="tab" data-mode="out" class="${st.mode === "out" ? "on" : ""}" aria-selected="${st.mode === "out"}">가는 편 먼저</button>
      <button type="button" role="tab" data-mode="ret" class="${st.mode === "ret" ? "on" : ""}" aria-selected="${st.mode === "ret"}">오는 편 먼저</button>
    </div>`;
  const loadingHTML = (o) => `<p class="rt-wait muted small">가는 편 ${esc(o.depart_time)}${mixed ? ` (${md(dayOf(o))})` : ""}의 오는 편을 조회하는 중이에요… 1~2분쯤 걸려요. 화면을 닫아도 결과는 저장돼요.</p>`;

  // 오는 편 먼저: 지금까지 조회한 조합(가는 편별 오는 편 목록)을 오는 편 기준으로 다시 묶음
  const retGroups = () => {
    const g = new Map();
    outs.forEach((o, i) => (returnsFor(i) || []).forEach((x) => {
      const k = `${x.date || retDayOf(i)}|${x.flight_number}|${x.depart_time}`;
      if (!g.has(k)) g.set(k, { k, r: { ...x, date: x.date || retDayOf(i) }, pairs: [] });
      g.get(k).pairs.push({ i, price: x.price });
    }));
    const list = [...g.values()];
    list.forEach((x) => { x.pairs.sort((p, q) => p.price - q.price); x.r = { ...x.r, price: x.pairs[0].price }; });
    return list.sort((p, q) => p.r.price - q.r.price);
  };

  const drawRetFirst = () => {
    const groups = retGroups();
    const known = new Set(outs.map((o, i) => (returnsFor(i) ? i : -1)).filter((i) => i >= 0));
    const grp = groups.find((x) => x.k === st.rkey) || groups[0];
    if (grp) st.rkey = grp.k;
    const pair = grp && (grp.pairs.find((p) => p.i === st.rout) || grp.pairs[0]);
    if (pair) st.rout = pair.i;
    if (pair) updateCompare(r, [{ ...outs[pair.i], date: dayOf(outs[pair.i]) }, { ...grp.r }]);
    const unknown = outs.map((o, i) => i).filter((i) => !known.has(i));
    const loadingIdx = unknown.filter((i) => st.loading[keyOf(outs[i])]);
    const multiRet = new Set(groups.map((x) => x.r.date)).size > 1;
    host.innerHTML = `${modeHTML()}
      ${pair ? `<div class="combo">
        <div class="combo-head"><span class="muted small">선택한 왕복</span><b class="num">${won(pair.price)}</b></div>
        ${comboRowHTML("가는 편", dayOf(outs[pair.i]), outs[pair.i])}
        ${comboRowHTML("오는 편", grp.r.date, grp.r)}
        ${diffHTML(pair.price)}
      </div>` : ""}
      <div class="rt-step"><span class="rt-no">1</span>오는 편 고르기 <span class="muted small">· ${multiRet ? "날짜 모두" : grp ? dayLabel(grp.r.date) : ""} · 가격은 가능한 왕복 최저가</span></div>
      <ol class="opts rt-list${groups.length > 5 ? " scroll" : ""}">${groups.map((x, j) => rtRowHTML(x.r, j, "rgrp", x === grp, base, multiRet)).join("")}</ol>
      <div class="rt-step"><span class="rt-no">2</span>가는 편 고르기 <span class="muted small">· 이 오는 편과 묶었을 때 왕복 총액</span></div>
      ${grp ? `<ol class="opts rt-list${grp.pairs.length > 5 ? " scroll" : ""}">${grp.pairs.map((p) => rtRowHTML({ ...outs[p.i], price: p.price }, p.i, "rpair", p.i === st.rout, base, mixed)).join("")}</ol>` : ""}
      ${unknown.length ? `<p class="rt-note muted small">오는 편 목록을 아직 조회하지 않은 가는 편 ${unknown.length}개는 위에 없어요. 아래에서 누르면 그 가는 편의 조합을 조회해요 (검색 1~2회 · 약 1분).</p>
        ${loadingIdx.map((i) => loadingHTML(outs[i])).join("")}
        ${ghToken() ? `<ol class="opts rt-list rt-unknown${unknown.length > 4 ? " scroll" : ""}">${unknown.filter((i) => !st.loading[keyOf(outs[i])]).map((i) => rtRowHTML(outs[i], i, "rfetch", false, base, mixed)).join("")}</ol>`
          : `<p class="rt-wait muted small">조회하려면 <a href="#settings">앱 설정</a>에서 GitHub 연결이 필요해요.</p>`}` : ""}`;
    host.querySelectorAll(".rt-row").forEach((b) => b.onclick = () => {
      const i = +b.dataset.i;
      if (b.dataset.kind === "rgrp") { st.rkey = groups[i].k; st.rout = groups[i].pairs[0].i; }
      else if (b.dataset.kind === "rpair") st.rout = i;
      else if (b.dataset.kind === "rfetch") { requestReturns(outs[i]); return; }
      draw();
    });
  };

  const draw = () => {
    if (st.mode === "ret") drawRetFirst(); else drawOutFirst();
    host.querySelectorAll(".rt-mode button").forEach((b) => b.onclick = () => { st.mode = b.dataset.mode; draw(); });
  };

  const drawOutFirst = () => {
    const o = outs[st.out] || e;
    const rets = returnsFor(st.out);
    const rr = rets && rets[Math.min(st.ret, rets.length - 1)];
    const it = st.items[keyOf(o)];
    const total = rr ? rr.price : o.price;
    if (rr) updateCompare(r, [{ ...o, date: dayOf(o) }, { ...rr, date: rr.date || retDayOf(st.out) }]);
    host.innerHTML = `${modeHTML()}
      <div class="combo">
        <div class="combo-head"><span class="muted small">${rr ? "선택한 왕복" : "선택한 가는 편 (오는 편 미정)"}</span>
          <b class="num">${rr ? "" : "약 "}${won(total)}</b></div>
        ${comboRowHTML("가는 편", dayOf(o), o)}
        ${rr ? comboRowHTML("오는 편", retDayOf(st.out), rr) : ""}
        ${diffHTML(total)}
      </div>
      <div class="rt-step"><span class="rt-no">1</span>가는 편 고르기 <span class="muted small">· ${mixed ? "후보 날짜 모두" : outDay ? dayLabel(outDay) : ""} · 가격은 왕복 최저가</span></div>
      <ol class="opts rt-list${outs.length > 5 ? " scroll" : ""}">${outs.map((x, i) => rtRowHTML(x, i, "out", i === st.out, base, mixed)).join("")}</ol>
      <div class="rt-step"><span class="rt-no">2</span>오는 편 고르기 <span class="muted small">· ${retDayOf(st.out) ? dayLabel(retDayOf(st.out)) : ""} · 가격은 왕복 총액</span></div>
      ${rets ? `<ol class="opts rt-list${rets.length > 5 ? " scroll" : ""}">${rets.map((x, i) => rtRowHTML(x, i, "ret", i === st.ret, base)).join("")}</ol>`
        : st.loading[keyOf(o)] ? loadingHTML(o)
        : `${it && it.error ? `<p class="rt-wait small" style="color:var(--up)">조회하지 못했어요: ${esc(it.error)}</p>` : ""}
           ${ghToken() ? `<button type="button" class="btn secondary" id="rt-fetch">이 가는 편의 오는 편 조회 (검색 1~2회 · 약 1분)</button>`
             : `<p class="rt-wait muted small">다른 가는 편의 오는 편을 보려면 <a href="#settings">앱 설정</a>에서 GitHub 연결이 필요해요.</p>`}`}`;
    host.querySelectorAll(".rt-row").forEach((b) => b.onclick = () => {
      if (b.dataset.kind === "out") { st.out = +b.dataset.i; st.ret = 0; } else st.ret = +b.dataset.i;
      draw();
    });
    const fb = document.getElementById("rt-fetch");
    if (fb) fb.onclick = () => requestReturns(o);
  };

  // 앱에서 GitHub 실행 요청 → 저장소의 결과 파일이 갱신될 때까지 기다림
  const requestReturns = async (o) => {
    const key = keyOf(o), { owner, repo } = ghRepo(), asked = new Date().toISOString();
    st.loading[key] = true; draw();
    try {
      await gh(`/repos/${owner}/${repo}/actions/workflows/flight-prices.yml/dispatches`, {
        method: "POST", body: JSON.stringify({ ref: "main", inputs: { returns_for: `${r.id}|${dayOf(o)}|${o.flight_number}|${o.depart_time}` } }),
      });
      for (let t = 0; t < 30; t++) {  // 최대 약 5분
        await new Promise((res) => setTimeout(res, 10000));
        try {
          const f = await gh(`/repos/${owner}/${repo}/contents/flight-tracker/site/data/returns/${encodeURIComponent(r.id)}.json?ref=main`);
          const items = JSON.parse(b64ToText(f.content)).items || {};
          const it = items[key];
          if (it && new Date(it.checked_at) >= new Date(asked) - 60000) { st.items = items; break; }
        } catch {}
      }
      if (!st.items[key]) st.items[key] = { error: "시간 안에 결과가 오지 않았어요. 잠시 뒤 다시 열어 보세요." };
    } catch (err) {
      st.items[key] = { error: err.status === 401 ? "GitHub 연결이 끊겼어요. 앱 설정에서 다시 연결해 주세요." : err.message };
    }
    st.loading[key] = false;
    if (outs[st.out] && keyOf(outs[st.out]) === key) st.ret = 0;
    draw();
  };
  draw();
}

function legHTML(h, k, label) {
  const stops = h[k + "stops"];
  if (!k && h.dep_airport && h.arr_airport) label = `${label}${esc(h.dep_airport)}→${esc(h.arr_airport)} `;
  if (!k && h.flex_date) label = `${dayLabel(h.flex_date)} ${label}`;
  return `<div>${label}${esc(h[k + "airline"])}</div><div class="sub">${esc(h[k + "flight_number"])} · ${esc(h[k + "depart_time"])}→${esc(h[k + "arrive_time"])}${stops === 0 ? " · 직항" : stops ? ` · 경유 ${stops}회` : ""}</div>`;
}

function niceTicks(lo, hi, n = 4) {
  const raw = (hi - lo) / n || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const start = Math.floor(lo / step) * step, ticks = [];
  for (let v = start; v <= hi + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function drawChart(hist, target) {
  const svg = document.getElementById("chart"), tip = document.getElementById("tip");
  const W = svg.clientWidth, H = 220, L = 8, R = 52, T = 18, B = 24;
  const pts = hist.map((h, i) => ({ ...h, i })).filter((h) => h.price != null);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  if (!pts.length) {
    svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle">아직 기록이 없어요. 내일 첫 가격이 기록돼요.</text>`;
    return;
  }
  const vals = pts.map((p) => p.price).concat(target ? [target] : []);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const n = Math.max(hist.length - 1, 1);
  const x = (i) => L + (hist.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / n);
  const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);

  // 끊긴 날(조회 실패)은 선을 끊어서 보여줌
  let line = "", prevI = null;
  pts.forEach((p) => { line += `${prevI === null || p.i - prevI > 1 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.price).toFixed(1)}`; prevI = p.i; });
  const area = pts.length > 1 ? `M${x(pts[0].i)},${y(lo)}` + pts.map((p) => `L${x(p.i).toFixed(1)},${y(p.price).toFixed(1)}`).join("") + `L${x(pts[pts.length - 1].i)},${y(lo)}Z` : "";
  const minP = pts.reduce((a, b) => (b.price < a.price ? b : a));
  const last = pts[pts.length - 1];
  // 눈금 간격에 맞춰 소수 자리를 늘려서 "62.6만"이 두 번 나오는 일이 없게 함
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 10000;
  const digits = Math.min(3, Math.max(1, Math.ceil(-Math.log10(step / 10000) - 1e-9)));
  const fmtK = (v) => (v >= 10000 ? (v / 10000).toLocaleString("ko-KR", { maximumFractionDigits: digits }) + "만" : v.toLocaleString("ko-KR"));
  const xIdx = hist.length <= 1 ? [0] : [0, Math.round((hist.length - 1) / 2), hist.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const minLabelX = Math.min(Math.max(x(minP.i), L + 40), W - R - 40);

  svg.innerHTML = `
    ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)" stroke-width="1"/>
      <text x="${W - R + 8}" y="${y(t) + 4}">${fmtK(t)}</text>`).join("")}
    ${xIdx.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 && hist.length > 1 ? "start" : i === hist.length - 1 && hist.length > 1 ? "end" : "middle"}">${md(hist[i].date)}</text>`).join("")}
    ${target ? `<line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" stroke="var(--good-fg)" stroke-width="1.5" stroke-dasharray="4 4"/>` : ""}
    <path d="${area}" fill="var(--accent-wash)"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.length > 1 && minP !== last ? `<circle cx="${x(minP.i)}" cy="${y(minP.price)}" r="4" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/>
      <text x="${minLabelX}" y="${y(minP.price) + 18}" text-anchor="middle" style="fill:var(--text-2);font-weight:600">최저 ${won(minP.price)}</text>` : ""}
    <circle cx="${x(last.i)}" cy="${y(last.price)}" r="5" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/>
    <g id="hover" style="display:none">
      <line id="hx" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-width="1"/>
      <circle id="hc" r="5" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/>
    </g>
    <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" id="hit"/>`;

  const hover = svg.querySelector("#hover"), hx = svg.querySelector("#hx"), hc = svg.querySelector("#hc");
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const p = pts.reduce((a, b) => (Math.abs(x(b.i) - mx) < Math.abs(x(a.i) - mx) ? b : a));
    const px = x(p.i), py = y(p.price);
    hover.style.display = ""; hx.setAttribute("x1", px); hx.setAttribute("x2", px);
    hc.setAttribute("cx", px); hc.setAttribute("cy", py);
    tip.innerHTML = `${md(p.date)} 조회<br><b>${won(p.price)}</b>`;
    tip.style.left = Math.min(Math.max(px, 60), W - 60) + "px";
    tip.style.top = py - 10 + "px";
    tip.style.opacity = 1;
  };
  const leave = () => { hover.style.display = "none"; tip.style.opacity = 0; };
  svg.onpointermove = move; svg.onpointerdown = move; svg.onpointerleave = leave;
}

// ------------------------------------------------------------ 노선 추가 도우미
function repoInfo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  if (!m) return null;
  const repo = location.pathname.split("/").filter(Boolean)[0];
  return repo ? { owner: m[1], repo } : null;
}

// ------------------------------------------------------------ 휴대폰에서 바로 저장 (GitHub 연결)
// 접근 키는 이 휴대폰(브라우저)에만 저장되고, 이 저장소의 routes.json 을 고칠 때만 씁니다.
const TOKEN_KEY = "flight-tracker-gh-token";
const ROUTES_PATH = "flight-tracker/routes.json";
function ghToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } }
function setGhToken(v) { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch {} }
function ghRepo() { return repoInfo() || { owner: "idght351-gif", repo: "flight-tracker" }; }

async function gh(path, opts = {}, token = ghToken()) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg += " " + (await res.json()).message; } catch {}
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res.status === 204 ? null : res.json();
}
const b64ToText = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
const textToB64 = (text) => { const bytes = new TextEncoder().encode(text); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };

// routes.json 을 읽어 change(routes) 로 고친 뒤 커밋. 다른 곳에서 동시에 바뀌면 한 번 더 시도.
async function saveRoutes(change, message) {
  const { owner, repo } = ghRepo();
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await gh(`/repos/${owner}/${repo}/contents/${ROUTES_PATH}?ref=main`);
    const data = JSON.parse(b64ToText(file.content));
    data.routes = change(data.routes || []);
    try {
      return await gh(`/repos/${owner}/${repo}/contents/${ROUTES_PATH}`, {
        method: "PUT",
        body: JSON.stringify({ message, content: textToB64(JSON.stringify(data, null, 2) + "\n"), sha: file.sha, branch: "main" }),
      });
    } catch (e) { if (e.status !== 409 || attempt) throw e; }
  }
}

function renderSettings() {
  const { owner, repo } = ghRepo();
  const token = ghToken();
  // classic 키: 다른 사람 계정의 저장소에 협업자로 들어가 있어도 쓸 수 있음 (fine-grained 키는 본인·소속 조직 저장소만 고를 수 있음)
  const newTokenUrl = "https://github.com/settings/tokens/new?scopes=repo&description=" + encodeURIComponent("항공권 가격 추적 앱");
  $app.innerHTML = `
    <section class="card">
      <h3 class="section-title">휴대폰에서 바로 저장하기</h3>
      <p class="small" style="margin-top:-4px">처음 한 번만 연결하면, 노선 추가 · 조건 바꾸기 · 삭제를 앱에서 버튼 한 번으로 저장하고 바로 조회해요.</p>
      <div id="state" class="info-row" style="border-top:0"><span>연결 상태</span><span>${token ? "연결됨 ✓" : "연결 안 됨"}</span></div>
    </section>
    <section class="card">
      <h3 class="section-title">1. GitHub 접근 키 만들기</h3>
      <ol class="steps small">
        <li>아래 버튼으로 GitHub 키 만들기 화면을 열어요 (본인 계정으로 로그인).</li>
        <li><b>Note</b>(이름)와 <b>repo</b> 체크는 미리 채워져 있어요. 그대로 두세요.</li>
        <li><b>Expiration</b>: 원하는 기간 (예: 90 days). 만료되면 여기서 다시 연결하면 돼요.</li>
        <li>맨 아래 <b>Generate token</b> → 나온 키(<b>ghp_…</b>)를 복사</li>
      </ol>
      <p class="muted small" style="margin:-4px 2px 12px">저장소 주인(${esc(owner)})이 아니어도, 이 저장소에 쓰기 권한(협업자)만 있으면 연결돼요.</p>
      <a class="btn secondary" href="${newTokenUrl}" target="_blank" rel="noopener">GitHub 키 만들기 화면 열기</a>
    </section>
    <section class="card">
      <h3 class="section-title">2. 키 붙여 넣고 연결</h3>
      <form class="form" id="tf" onsubmit="return false">
        <label class="full">접근 키<input name="token" type="password" autocomplete="off" placeholder="ghp_… 또는 github_pat_…" value=""></label>
      </form>
      <button class="btn" id="connect" style="margin-top:12px">연결 확인하고 저장</button>
      ${token ? `<button class="btn secondary" id="disconnect" style="margin-top:8px">연결 해제 (이 휴대폰에서 키 지우기)</button>` : ""}
      <p class="muted small" id="msg" style="margin:10px 2px 0">키는 이 휴대폰에만 저장되고, 앱은 이 저장소의 노선 설정 파일을 고칠 때만 써요. 다만 이 키는 내 계정의 다른 저장소에도 쓸 수 있는 키라서, 다른 곳에 붙여 넣거나 공유하지 마세요. 휴대폰을 바꾸면 다시 연결해 주세요.</p>
    </section>`;
  const msg = document.getElementById("msg");
  document.getElementById("connect").onclick = async (e) => {
    const v = document.getElementById("tf").token.value.trim();
    if (!v) { msg.textContent = "키를 붙여 넣어 주세요."; return; }
    e.target.disabled = true; msg.textContent = "확인하는 중…";
    try {
      const info = await gh(`/repos/${owner}/${repo}`, {}, v);
      if (!info.permissions || !info.permissions.push) throw new Error(`이 계정에는 ${owner}/${repo} 쓰기 권한이 없어요. 저장소 주인에게 협업자(Write) 초대를 받았는지, 키에 repo 가 체크됐는지 확인해 주세요.`);
      setGhToken(v);
      msg.textContent = "연결됐어요 ✓ 이제 조건 바꾸기 화면에서 바로 저장할 수 있어요.";
      document.querySelector("#state span:last-child").textContent = "연결됨 ✓";
    } catch (err) {
      msg.textContent = err.status === 401 ? "키가 맞지 않거나 만료됐어요. 다시 확인해 주세요."
        : err.status === 404 || err.status === 403 ? `이 키로 ${owner}/${repo} 저장소를 볼 수 없어요. 키를 만들 때 repo 를 체크했는지 확인해 주세요. (fine-grained 키는 다른 사람 계정의 저장소를 고를 수 없어요)`
        : !err.status ? err.message : `연결하지 못했어요: ${err.message}`;
    } finally { e.target.disabled = false; }
  };
  const dis = document.getElementById("disconnect");
  if (dis) dis.onclick = () => { setGhToken(""); renderSettings(); };
}

async function renderEdit(id) {
  let doc;
  try { doc = await getJSON(`data/routes/${encodeURIComponent(id)}.json`); }
  catch { $app.innerHTML = `<a class="back" href="#">‹ 목록</a><div class="card empty">노선을 찾을 수 없어요.</div>`; return; }
  renderAdd(doc.route);
}

// ------------------------------------------------------------ 노선 이름 자동 만들기
// 한국 공항은 공항 이름(인천 · 김포 …), 해외는 도시 이름(하네다 · 나리타 → 도쿄)으로 씁니다.
const KR_AIRPORTS = { ICN: "인천", GMP: "김포", PUS: "부산", CJU: "제주", TAE: "대구", CJJ: "청주", KWJ: "광주", MWX: "무안", RSU: "여수", USN: "울산", YNY: "양양", KPO: "포항", HIN: "사천", WJU: "원주", KUV: "군산" };
const CITY = {
  HND: "도쿄", NRT: "도쿄", KIX: "오사카", ITM: "오사카", UKB: "고베", NGO: "나고야", FUK: "후쿠오카", CTS: "삿포로", AKJ: "아사히카와",
  OKA: "오키나와", KOJ: "가고시마", KMJ: "구마모토", HIJ: "히로시마", SDJ: "센다이", KMQ: "고마쓰", TAK: "다카마쓰", MYJ: "마쓰야마",
  OKJ: "오카야마", FSZ: "시즈오카", KIJ: "니가타", HKD: "하코다테", OIT: "오이타", NGS: "나가사키", KKJ: "기타큐슈", TOY: "도야마",
  YGJ: "요나고", AOJ: "아오모리", AXT: "아키타", KCZ: "고치", UBJ: "우베", MMY: "미야코지마", ISG: "이시가키", OBO: "오비히로", KUH: "구시로", MMB: "메만베쓰",
  TPE: "타이베이", TSA: "타이베이", KHH: "가오슝", RMQ: "타이중", HKG: "홍콩", MFM: "마카오", PVG: "상하이", SHA: "상하이", PEK: "베이징", PKX: "베이징",
  TAO: "칭다오", CAN: "광저우", SZX: "선전", DLC: "다롄", SHE: "선양", YNJ: "옌지", CGQ: "창춘", HRB: "하얼빈",
  BKK: "방콕", DMK: "방콕", HKT: "푸껫", CNX: "치앙마이", SGN: "호찌민", HAN: "하노이", DAD: "다낭", CXR: "나트랑", PQC: "푸꾸옥", DLI: "달랏",
  MNL: "마닐라", CEB: "세부", CRK: "클라크", MPH: "보라카이", SIN: "싱가포르", KUL: "쿠알라룸푸르", BKI: "코타키나발루", PEN: "페낭",
  DPS: "발리", CGK: "자카르타", VTE: "비엔티안", PNH: "프놈펜", REP: "시엠레아프", ULN: "울란바토르", GUM: "괌", SPN: "사이판",
  HNL: "호놀룰루", LAX: "로스앤젤레스", SFO: "샌프란시스코", SEA: "시애틀", JFK: "뉴욕", EWR: "뉴욕", LAS: "라스베이거스", YVR: "밴쿠버", YYZ: "토론토",
  SYD: "시드니", MEL: "멜버른", BNE: "브리즈번", AKL: "오클랜드", CDG: "파리", LHR: "런던", FRA: "프랑크푸르트", MUC: "뮌헨", FCO: "로마",
  MXP: "밀라노", BCN: "바르셀로나", MAD: "마드리드", AMS: "암스테르담", IST: "이스탄불", DXB: "두바이", PRG: "프라하", VIE: "빈", ZRH: "취리히",
};
const placeName1 = (c) => REGION_NAME[c] || KR_AIRPORTS[c] || CITY[c] || c;
const placeName = (code) => [...new Set((code || "").toUpperCase().split(",").map((c) => c.trim()).filter(Boolean).map(placeName1))].join(" · ");

// 왕복·편도: "인천 → 삿포로" / 다구간: "김포 → 도쿄 · 삿포로 · 아사히카와" (들르는 해외 도시, 중복 없이)
function autoName(trip, simple, legs) {
  if (trip !== "multi") return simple.from && simple.to ? `${placeName(simple.from)} → ${placeName(simple.to)}` : "";
  const ok = legs.filter((l) => l.from && l.to);
  if (!ok.length) return "";
  const start = ok[0].from.toUpperCase();
  const stops = [];
  ok.forEach((l) => [l.from, l.to].forEach((c) => {
    const code = c.toUpperCase();
    if (code === start || KR_AIRPORTS[code]) return;
    const name = placeName(code);
    if (!stops.includes(name)) stops.push(name);
  }));
  return stops.length ? `${placeName(start)} → ${stops.join(" · ")}` : `${placeName(start)} → ${placeName(ok[ok.length - 1].to)}`;
}

function renderAdd(edit) {
  const info = repoInfo();
  const editUrl = info ? `https://github.com/${info.owner}/${info.repo}/edit/main/flight-tracker/routes.json` : null;
  const legRow = (l = {}) => `
    <div class="leg">
      <div class="leg-head"><b class="leg-no"></b><button type="button" class="link leg-del">삭제</button></div>
      <div class="form">
        <label>출발 공항<input data-k="from" value="${esc(l.from || "")}" maxlength="23"></label>
        <label>도착 공항<input data-k="to" value="${esc(l.to || "")}" maxlength="23"></label>
        <label class="full">날짜<input data-k="date" type="date" value="${esc(l.date || "")}"></label>
        <label>출발 (부터)<input data-k="depart_after" type="time" value="${esc(l.depart_after || "")}"></label>
        <label>출발 (까지)<input data-k="depart_before" type="time" value="${esc(l.depart_before === "24:00" ? "" : l.depart_before || "")}"></label>
      </div>
    </div>`;
  $app.innerHTML = `
    <a class="back" href="${edit ? `#${esc(encodeURIComponent(edit.id))}` : "#"}">‹ ${edit ? "노선" : "목록"}</a>
    <section class="card">
      <h3 class="section-title">${edit ? "추적 조건 바꾸기" : "노선 추가하기"}</h3>
      <p class="muted small" style="margin-top:-6px">${ghToken()
        ? `조건을 바꾸고 맨 아래 [${edit ? "저장하고" : "추가하고"} 바로 조회]를 누르세요.`
        : edit ? "바꾸면 아래에 routes.json 에서 이 노선 항목을 대신할 내용이 만들어져요." : "입력하면 아래에 routes.json 에 붙여 넣을 내용이 만들어져요."}</p>
      <form id="f" onsubmit="return false">
        <div class="seg" role="radiogroup" aria-label="여정 종류">
          <label><input type="radio" name="trip" value="round" checked><span>왕복</span></label>
          <label><input type="radio" name="trip" value="oneway"><span>편도</span></label>
          <label><input type="radio" name="trip" value="multi"><span>다구간</span></label>
        </div>
        <div class="form">
          <label class="full">이름 <span class="muted" style="font-weight:500">· 공항을 고르면 자동으로 채워져요</span><input name="name" value=""></label>
        </div>
        <div class="form" id="simple">
          <label>출발 공항 코드<input name="from" value="ICN" maxlength="23" placeholder="ICN 또는 ICN,GMP"></label>
          <label>도착 공항 코드<input name="to" value="KIX" maxlength="23" placeholder="KIX 또는 KIX,UKB"></label>
          <div class="full quick">
            <button type="button" class="chip" data-set="from" data-v="ICN,GMP,CJJ">출발 인천·김포·청주</button>
            <button type="button" class="chip" data-set="to" data-v="JP">도착 일본 전체</button>
          </div>
          <div class="full seg seg2" role="radiogroup" aria-label="날짜 정하는 방식">
            <label><input type="radio" name="datemode" value="fixed" checked><span>정해진 날</span></label>
            <label><input type="radio" name="datemode" value="flex"><span>여러 날짜 중 찾기</span></label>
          </div>
          <label data-fixed>가는 날<input name="date" type="date"></label>
          <label data-round data-fixed>오는 날<input name="return_date" type="date"></label>
          <div class="full pick-dates" data-flex>
            <label>가는 날 후보 추가<span class="pick-row"><input name="pick" type="date"><button type="button" class="btn secondary" id="pick-add">추가</button></span></label>
            <div class="date-chips" id="date-chips" aria-live="polite"></div>
          </div>
          <label data-round data-flex>여행 기간 (박)<input name="trip_days" type="number" min="1" max="30" value="2"></label>
          <p class="full muted small" data-flex style="margin:-2px 2px 0">고른 날짜들 중 가장 싼 출발일을 찾아요. 날짜를 몇 개 고르든 조회 한 번에 검색 2회(왕복 3회)예요.</p>
          <label>가는 편 출발 (부터)<input name="depart_after" type="time" value="08:00"></label>
          <label>가는 편 출발 (까지)<input name="depart_before" type="time" value=""></label>
          <label data-round>오는 편 출발 (부터)<input name="return_after" type="time" value="12:00"></label>
          <label data-round>오는 편 출발 (까지)<input name="return_before" type="time" value=""></label>
        </div>
        <div id="multi" hidden>
          <div id="legs"></div>
          <button type="button" class="btn secondary" id="add-leg">+ 구간 추가</button>
          <p class="muted small" style="margin:8px 2px 0">구간은 2~6개까지 넣을 수 있어요. 조회할 때 구간마다 검색 1회를 써요.</p>
        </div>
        <div class="form" style="margin-top:10px">
          <label>인원 (성인)<input name="adults" type="number" min="1" max="9" value="1"></label>
          <label>좌석
            <select name="travel_class"><option value="economy">일반석</option><option value="premium_economy">프리미엄 일반석</option><option value="business">비즈니스</option><option value="first">일등석</option></select></label>
          <label>경유
            <select name="max_stops"><option value="">상관없음</option><option value="0">직항만</option><option value="1">1회 이하</option></select></label>
          <label>알림 목표가 (원, 비우면 알림 없음)<input name="alert_below" type="number" step="1000"></label>
        </div>
      </form>
    </section>
    <section class="card">
      ${ghToken()
        ? `<button class="btn" id="save">${edit ? "저장하고 바로 조회" : "추가하고 바로 조회"}</button>
           ${edit ? `<button class="btn secondary danger" id="del" style="margin-top:8px">이 노선 삭제</button>` : ""}
           <p class="muted small" id="save-msg" style="margin:10px 2px 0">저장하면 1~2분 뒤 새 조건으로 조회한 가격이 앱에 반영돼요. 바뀐 노선만 조회해요.</p>`
        : `<p class="small" style="margin:0 0 10px">휴대폰에서 버튼 한 번으로 저장하려면 처음 한 번 GitHub 연결이 필요해요.</p>
           <a class="btn" href="#settings">앱에서 바로 저장하도록 연결하기</a>`}
      <details class="manual"${ghToken() ? "" : " open"}>
        <summary>직접 붙여 넣기 (GitHub 에서 수정)</summary>
        <pre class="snippet" id="out"></pre>
        <button class="btn secondary" id="copy" style="margin:12px 0 8px">복사하기</button>
        ${editUrl ? `<a class="btn secondary" href="${editUrl}" target="_blank" rel="noopener">GitHub에서 routes.json 열기</a>` : ""}
        <p class="muted small">${edit
          ? `routes.json 에서 "id": "${esc(edit.id)}" 인 항목의 { } 전체를 위 내용으로 바꾼 뒤 Commit 하세요.`
          : `"routes" 목록 안의 마지막 항목 뒤에 쉼표(,)를 찍고 붙여 넣은 뒤 Commit 하세요.`}</p>
      </details>
    </section>`;

  const f = document.getElementById("f"), out = document.getElementById("out");
  const $legs = document.getElementById("legs"), $add = document.getElementById("add-leg");
  const t = (x) => (x === "24:00" ? "" : x || "");
  const addLeg = (l) => { $legs.insertAdjacentHTML("beforeend", legRow(l)); renumber(); };
  const renumber = () => {
    const rows = [...$legs.querySelectorAll(".leg")];
    rows.forEach((el, i) => { el.querySelector(".leg-no").textContent = `${i + 1}구간`; el.querySelector(".leg-del").hidden = rows.length <= 2; });
    $add.hidden = rows.length >= 6;
  };
  // 여정 종류(왕복/편도)와 날짜 방식(정해진 날/월·요일)에 맞는 칸만 보이기
  function applyVis() {
    const trip = f.querySelector("input[name=trip]:checked").value;
    const mode = f.querySelector("input[name=datemode]:checked").value;
    f.querySelectorAll("[data-round],[data-fixed],[data-flex]").forEach((el) => {
      el.hidden = (el.hasAttribute("data-round") && trip !== "round") || (el.hasAttribute("data-fixed") && mode !== "fixed")
        || (el.hasAttribute("data-flex") && mode !== "flex");
    });
  }
  let picked = [];
  const $chips = () => document.getElementById("date-chips");
  const drawChips = () => {
    $chips().innerHTML = picked.length
      ? picked.map((d) => `<span class="date-chip">${dayLabel(d)}<button type="button" data-del="${d}" aria-label="${dayLabel(d)} 빼기">×</button></span>`).join("")
      : `<span class="muted small">아직 고른 날짜가 없어요</span>`;
  };
  const setMode = (mode) => { f.querySelector(`input[name=datemode][value=${mode}]`).checked = true; applyVis(); };

  const setTrip = (trip) => {
    f.querySelector(`input[name=trip][value=${trip}]`).checked = true;
    document.getElementById("simple").hidden = trip === "multi";
    document.getElementById("multi").hidden = trip !== "multi";
    applyVis();
    if (trip === "multi" && !$legs.children.length) {
      const v = Object.fromEntries(new FormData(f));
      addLeg({ from: v.from, to: v.to, date: v.date, depart_after: v.depart_after, depart_before: v.depart_before });
      addLeg({ from: v.to, to: "", date: v.return_date || "" });
    }
    if (trip !== "multi" && $legs.children.length) fillSimpleFromLegs(trip);
  };
  // 다구간에서 편도·왕복으로 바꿀 때: 빈 칸만 첫 구간(왕복이면 마지막 구간도) 값으로 채움
  const fillSimpleFromLegs = (trip) => {
    const rows = [...$legs.querySelectorAll(".leg")].map((el) => Object.fromEntries(
      [...el.querySelectorAll("[data-k]")].map((i) => [i.dataset.k, i.value.trim()])));
    if (!rows.length) return;
    const first = rows[0], last = rows[rows.length - 1];
    const put = (name, v) => { if (v && !f.elements[name].value) f.elements[name].value = v; };
    put("from", first.from); put("to", first.to); put("date", first.date);
    put("depart_after", first.depart_after); put("depart_before", first.depart_before);
    if (trip === "round" && rows.length > 1) { put("return_date", last.date); put("return_after", last.depart_after); put("return_before", last.depart_before); }
  };

  if (edit) {
    f.elements["name"].value = edit.name;
    f.adults.value = edit.adults || 1; f.travel_class.value = edit.travel_class || "economy";
    f.max_stops.value = edit.max_stops == null ? "" : String(edit.max_stops);
    f.alert_below.value = edit.alert_below || "";
    if (edit.legs && edit.legs.length) {
      ["from", "to", "date", "return_date", "depart_after", "depart_before", "return_after", "return_before"].forEach((k) => { f.elements[k].value = ""; });
      edit.legs.forEach(addLeg);
      setTrip("multi");
    } else if (edit.flex) {
      f.from.value = edit.from; f.to.value = edit.to;
      f.date.value = ""; f.return_date.value = "";
      picked = flexDates(edit.flex);
      if (edit.flex.trip_days) f.trip_days.value = edit.flex.trip_days;
      f.depart_after.value = t(edit.depart_after); f.depart_before.value = t(edit.depart_before);
      f.return_after.value = t(edit.return_after); f.return_before.value = t(edit.return_before);
      setMode("flex");
      setTrip(edit.flex.trip_days ? "round" : "oneway");
    } else {
      f.from.value = edit.from; f.to.value = edit.to;
      f.date.value = edit.date; f.return_date.value = edit.return_date || "";
      f.depart_after.value = t(edit.depart_after); f.depart_before.value = t(edit.depart_before);
      f.return_after.value = t(edit.return_after); f.return_before.value = t(edit.return_before);
      setTrip(edit.return_date ? "round" : "oneway");
    }
  } else {
    f.date.value = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    f.return_date.value = new Date(Date.now() + 34 * 86400000).toISOString().slice(0, 10);
    setTrip("round");
  }

  // 이름: 사용자가 직접 고치기 전까지는 공항에 맞춰 자동으로 채움
  const nameInput = f.elements["name"];
  let nameTouched = false;
  const readLegs = () => [...$legs.querySelectorAll(".leg")].map((el) => ({
    from: el.querySelector("[data-k=from]").value.trim(), to: el.querySelector("[data-k=to]").value.trim() }));
  // 지금 고른 여정·공항을 한 줄로 (처음 불러온 값과 달라졌는지 비교용)
  const airportSig = () => {
    const v = Object.fromEntries(new FormData(f));
    return v.trip + "|" + (v.trip === "multi" ? readLegs().map((l) => `${l.from}-${l.to}`).join(",") : `${v.from}-${v.to}`).toUpperCase();
  };
  let keepFileName = false, initialSig = "";
  const fillName = () => {
    if (nameTouched) return;
    if (keepFileName && airportSig() === initialSig) return;  // 직접 지은 이름: 공항을 바꾸기 전까지는 그대로
    const v = Object.fromEntries(new FormData(f));
    const auto = autoName(v.trip, { from: v.from, to: v.to }, readLegs());
    if (auto) nameInput.value = auto;
  };
  nameInput.addEventListener("input", () => { nameTouched = nameInput.value.trim() !== ""; });
  // 기존 노선: 이름이 자동 형식과 다르면(직접 지은 이름) 공항이나 여정 종류를 바꾸기 전까지는 그대로 둠
  if (edit) {
    const v = Object.fromEntries(new FormData(f));
    keepFileName = !!edit.name && edit.name !== autoName(v.trip, { from: v.from, to: v.to }, readLegs());
    initialSig = airportSig();
  }

  const update = () => {
    fillName();
    const v = Object.fromEntries(new FormData(f));
    const common = {
      adults: +v.adults || 1, travel_class: v.travel_class, max_stops: v.max_stops === "" ? null : +v.max_stops,
      alert_below: +v.alert_below || null, active: edit ? edit.active !== false : true,
    };
    let body;
    if (v.trip === "multi") {
      const legs = [...$legs.querySelectorAll(".leg")].map((el) => {
        const g = (k) => el.querySelector(`[data-k=${k}]`).value;
        const leg = { from: g("from").toUpperCase(), to: g("to").toUpperCase(), date: g("date") };
        if (g("depart_after")) leg.depart_after = g("depart_after");
        if (g("depart_before")) leg.depart_before = g("depart_before");
        return leg;
      });
      const first = legs[0] || {};
      const id = edit ? edit.id : `${first.from}-${legs.map((l) => l.to).join("-")}-${(first.date || "").replaceAll("-", "")}`.toLowerCase();
      body = { id, name: v.name, legs, ...(edit && edit.separate_tickets ? { separate_tickets: true } : {}), ...common };
    } else if (v.datemode === "flex") {
      const round = v.trip === "round";
      const dates = picked.slice();
      const id = edit ? edit.id : `${v.from}-${v.to}-${(dates[0] || "").slice(0, 7).replace("-", "")}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
      body = {
        id, name: v.name, from: v.from.toUpperCase(), to: v.to.toUpperCase(),
        flex: { dates, trip_days: round ? (+v.trip_days || 2) : null },
        depart_after: v.depart_after || "00:00", depart_before: v.depart_before || "24:00",
        ...(round ? { return_after: v.return_after || "00:00", return_before: v.return_before || "24:00" } : {}),
        ...common,
      };
    } else {
      const round = v.trip === "round";
      const id = edit ? edit.id : `${v.from}-${v.to}-${(v.date || "").replaceAll("-", "")}`.toLowerCase();
      body = {
        id, name: v.name, from: v.from.toUpperCase(), to: v.to.toUpperCase(), date: v.date,
        return_date: round ? v.return_date || null : null,
        depart_after: v.depart_after || "00:00", depart_before: v.depart_before || "24:00",
        ...(round && v.return_date ? { return_after: v.return_after || "00:00", return_before: v.return_before || "24:00" } : {}),
        ...common,
      };
    }
    // 화면에 없는 설정(구간별 편도 합산, 최소 환승 시간 등)은 그대로 유지
    if (edit && v.trip === "multi") for (const k of ["separate_tickets", "min_connection_min"]) if (edit[k] != null && body[k] == null) body[k] = edit[k];
    out.textContent = JSON.stringify(body, null, 2);
  };

  f.addEventListener("change", (e) => { if (e.target.name === "trip") setTrip(e.target.value); if (e.target.name === "datemode") applyVis(); update(); });
  f.querySelectorAll(".quick [data-set]").forEach((b) => { b.onclick = () => { f.elements[b.dataset.set].value = b.dataset.v; update(); }; });
  const addPick = () => {
    const d = f.elements.pick.value;
    if (!d) { f.elements.pick.focus(); return; }
    if (!picked.includes(d)) picked = [...picked, d].sort();
    f.elements.pick.value = ""; f.elements.pick.classList.remove("invalid"); drawChips(); update();
  };
  document.getElementById("pick-add").onclick = addPick;
  f.elements.pick.addEventListener("change", addPick);  // 달력에서 고르면 바로 추가
  $chips().addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    picked = picked.filter((d) => d !== b.dataset.del); drawChips(); update();
  });
  drawChips();
  f.addEventListener("input", update);
  $add.onclick = () => {
    const rows = $legs.querySelectorAll(".leg");
    const prevTo = rows.length ? rows[rows.length - 1].querySelector("[data-k=to]").value : "";
    addLeg({ from: prevTo }); update();
  };
  $legs.addEventListener("click", (e) => {
    if (!e.target.classList.contains("leg-del")) return;
    e.target.closest(".leg").remove(); renumber(); update();
  });
  update();
  document.getElementById("copy").onclick = async (e) => {
    try { await navigator.clipboard.writeText(out.textContent); e.target.textContent = "복사됨 ✓"; } catch { e.target.textContent = "직접 선택해서 복사해 주세요"; }
  };

  const saveBtn = document.getElementById("save"), delBtn = document.getElementById("del"), smsg = document.getElementById("save-msg");
  const fail = (err) => {
    smsg.scrollIntoView({ behavior: "smooth", block: "center" });
    smsg.textContent = err.status === 401 ? "GitHub 연결이 끊겼어요(키 만료 등). 앱 설정에서 다시 연결해 주세요."
      : err.message && !err.status ? err.message : `저장하지 못했어요: ${err.message}`;
  };
  const busy = (on) => { [saveBtn, delBtn].forEach((b) => b && (b.disabled = on)); };
  if (saveBtn) saveBtn.onclick = async () => {
    let body;
    try { body = JSON.parse(out.textContent); } catch { smsg.textContent = "입력값을 확인해 주세요."; return; }
    f.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
    const multi = !!body.legs;
    const scope = multi ? [...$legs.querySelectorAll(".leg")] : [document.getElementById("simple")];
    const bad = [];
    scope.forEach((root) => {
      const q = (k) => root.querySelector(multi ? `[data-k=${k}]` : `[name=${k}]`);
      ["from", "to"].forEach((k) => { if (!/^([A-Za-z]{3}|KR|JP)(\s*,\s*([A-Za-z]{3}|KR|JP))*$/i.test(q(k).value.trim())) bad.push(q(k)); });
      const flexMode = !multi && f.querySelector("input[name=datemode]:checked").value === "flex";
      if (flexMode) { if (!picked.length) bad.push(f.elements.pick); }
      else if (!q("date").value) bad.push(q("date"));
    });
    if (!multi && !body.flex && body.return_date === null && f.querySelector("input[name=trip]:checked").value === "round") bad.push(f.elements.return_date);
    if (bad.length || (multi && body.legs.length < 2)) {
      bad.forEach((el) => el.classList.add("invalid"));
      smsg.textContent = bad.some((el) => el.name === "pick") ? "가는 날 후보를 하나 이상 추가해 주세요." : bad.some((el) => el.type === "date") ? "빨간 칸을 채워 주세요. (날짜가 비어 있어요)"
        : "빨간 칸을 확인해 주세요. 공항 코드는 영문 3글자(나라 전체는 KR · JP)예요. 여러 곳이면 쉼표로 (예: ICN,GMP)";
      (bad[0] || smsg).scrollIntoView({ behavior: "smooth", block: "center" });
      if (bad[0]) setTimeout(() => bad[0].focus({ preventScroll: true }), 300);
      return;
    }
    busy(true); smsg.textContent = "저장하는 중…";
    try {
      await saveRoutes((routes) => {
        if (edit) return routes.map((x) => (x.id === edit.id ? body : x));
        let id = body.id, n = 2;
        while (routes.some((x) => x.id === id)) id = `${body.id}-${n++}`;
        return routes.concat({ ...body, id });
      }, `앱에서 노선 ${edit ? "수정" : "추가"}: ${body.name}`);
      smsg.textContent = "저장했어요 ✓ 1~2분 뒤 새 조건으로 조회한 가격이 반영돼요. 앱을 다시 열면 보여요.";
      smsg.scrollIntoView({ behavior: "smooth", block: "center" });
      saveBtn.textContent = "저장됨 ✓";
    } catch (err) { fail(err); busy(false); }
  };
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm(`"${edit.name}" 노선 추적을 그만할까요? (지금까지 기록은 남아 있어요)`)) return;
    busy(true); smsg.textContent = "삭제하는 중…";
    try {
      await saveRoutes((routes) => routes.filter((x) => x.id !== edit.id), `앱에서 노선 삭제: ${edit.name}`);
      smsg.textContent = "삭제했어요 ✓ 1~2분 뒤 목록에서 사라져요.";
      delBtn.textContent = "삭제됨 ✓";
    } catch (err) { fail(err); busy(false); }
  };
}

// ------------------------------------------------------------ 라우팅
function route() {
  setTopRight("");
  window.onresize = null;
  document.onclick = null;
  document.onkeydown = null;
  window.scrollTo(0, 0);
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) renderList();
  else if (id === "add") renderAdd();
  else if (id === "settings") renderSettings();
  else if (id.startsWith("edit/")) renderEdit(id.slice(5));
  else renderDetail(id);
}
window.addEventListener("hashchange", route);
route();
