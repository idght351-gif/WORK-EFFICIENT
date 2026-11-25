"use strict";

const $app = document.getElementById("app");
const won = (v) => (v == null ? "-" : v.toLocaleString("ko-KR") + "원");
const md = (iso) => { const [, m, d] = iso.split("-"); return `${+m}/${+d}`; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LEVEL = { low: ["good", "Google 기준 싼 편"], typical: ["", "Google 기준 보통"], high: ["bad", "Google 기준 비싼 편"] };
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

// 여정을 [공항, 비행(날짜), 공항, (육로 등 끊김), 공항 …] 순서로 펼칩니다.
// withReturn 이면 왕복의 돌아오는 편까지 넣습니다(상세 화면용).
function pathSteps(r, withReturn = false) {
  const legs = r.legs && r.legs.length
    ? r.legs
    : [{ from: r.from, to: r.to, date: r.date }].concat(withReturn && r.return_date ? [{ from: r.to, to: r.from, date: r.return_date }] : []);
  const steps = [];
  legs.forEach((l, i) => {
    const fmt = (c) => c.toUpperCase().split(",").map((x) => x.trim()).filter(Boolean).join("/");
    const from = fmt(l.from), to = fmt(l.to);
    if (i === 0) steps.push({ code: from });
    else if (legs[i - 1].to.toUpperCase() !== from) steps.push({ gap: true }, { code: from });
    steps.push({ date: l.date }, { code: to });
  });
  return steps;
}

function routePath(r) {
  return pathSteps(r).map((st) => (st.code ? esc(st.code) : st.gap ? "·" : "→")).join(" ");
}

// 상세 화면: 화살표(비행 구간)마다 아래에 날짜
function pathWithDatesHTML(r) {
  return `<div class="leg-path fit-line" data-min="10">${pathSteps(r, true).map((st) =>
    st.code ? `<span class="lp"><b>${esc(st.code)}</b><i></i></span>`
    : st.gap ? `<span class="lp gap"><b>·</b><i></i></span>`
    : `<span class="lp arrow"><b>→</b><i>${md(st.date)}</i></span>`).join("")}</div>`;
}

// 날짜만: 다구간 "6/26 · 6/29 · 7/3 · 7/3", 왕복 "6/29(화) ~ 7/5", 편도 "6/29(화)"
function dateLabel(r) {
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

async function getJSON(url) {
  const r = await fetch(url + "?t=" + Date.now());
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

// ------------------------------------------------------------ 목록
async function renderList() {
  let index;
  try { index = await getJSON("data/index.json"); } catch { index = { routes: [] }; }
  setTopRight(index.updated_at ? `<span class="muted small">업데이트 ${new Date(index.updated_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>` : "");

  const order = { active: 0, paused: 1, ended: 2 };
  const routes = [...index.routes].sort((a, b) => order[a.status] - order[b.status] || a.date.localeCompare(b.date));

  $app.innerHTML = `
    <div class="quota-head" style="margin-top:8px"><h2 class="section-title">추적 중인 항공권</h2><span class="muted small">조회 ${scheduleText(index.schedule_kst)}</span></div>
    ${routes.length ? routes.map(cardHTML).join("") :
      `<div class="card empty"><p>아직 추적 중인 노선이 없어요.</p><p class="muted small">routes.json 에 노선을 추가하면 다음 실행부터 기록돼요.</p></div>`}
    <a href="#add" class="btn secondary" style="margin-top:16px">+ 노선 추가하기</a>
    <div style="margin-top:24px">${quotaHTML(index.quota)}</div>
    <a class="settings-link muted small" href="#settings">⚙︎ 앱 설정 · ${ghToken() ? "GitHub 연결됨" : "휴대폰에서 바로 저장하도록 연결하기"}</a>`;
  routes.forEach((r) => { const el = document.getElementById("spark-" + r.id); if (el) sparkline(el, r.spark, r.alert_below); });
  fitOneLine($app);
  window.onresize = () => fitOneLine($app);
  routes.forEach((r) => {
    const el = document.getElementById("plan-" + r.id), p = checkPlan(r, r.status, index.schedule_kst);
    if (el) el.textContent = p ? `다음 조회 ${planLabel(p.next)}경` : "";
  });
}

// ------------------------------------------------------------ 조회 일정
// 예약 시각(한국시간)과 출발일로, 보는 시점 기준 다음 조회와 마지막 조회를 계산합니다.
function kstNow() { return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })); }
function checkPlan(r, status, times) {
  times = (times && times.length ? times : ["06:30"]).slice().sort();
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
  return `매일 ${(times && times.length ? times : ["06:30"]).join(" · ")}`;
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
    lines.push(`<div class="quota-row"><span class="muted">갱신일까지 예상 사용</span><span class="num">${need}회 (하루 ${daily}회)</span></div>`);
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
function siteCodes(codes) {
  const items = (codes || "").toUpperCase().split(",").map((c) => c.trim()).filter(Boolean);
  if (items.length <= 1) return [items[0] || "", (items[0] || "").toLowerCase()];
  const m = METRO.find(([members]) => items.every((c) => members.includes(c)));
  return m ? [m[1], m[2]] : [items[0], items[0].toLowerCase()];
}

function compareLinks(r) {
  const [org, skyOrg] = siteCodes(r.from), [dst, skyDst] = siteCodes(r.to);
  const adults = +(r.adults || 1), ret = r.return_date, direct = r.max_stops === 0;
  const kc = { economy: "", premium_economy: "/premium", business: "/business", first: "/first" }[r.travel_class || "economy"] || "";
  const sc = { economy: "economy", premium_economy: "premiumeconomy", business: "business", first: "first" }[r.travel_class || "economy"] || "economy";
  const kTail = kc + (adults > 1 ? `/${adults}adults` : "") + "?sort=price_a" + (direct ? "&fs=stops%3D0" : "");
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
      <a class="btn secondary" href="${esc(l.kayak)}" target="_blank" rel="noopener">Kayak 비교</a>
      <a class="btn secondary" href="${esc(l.skyscanner)}" target="_blank" rel="noopener">Skyscanner 비교</a>
    </div>
    <p class="muted small compare-note">같은 날짜·인원·좌석으로 열려요. 출발 시간대 조건은 각 사이트에서 직접 설정해 주세요.</p>`;
}

// ------------------------------------------------------------ 상세
// 상세 화면 위쪽: 목록으로 돌아가기 + 다른 추적 항공편으로 바로 이동하는 선택 상자
// 선택 상자용 짧은 이름: 출발일 기준 "6월 26일 시작 여행"
function tripTitle(r) {
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
    ${compareHTML(r)}

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
      ${(() => { const p = checkPlan(r, doc.status, doc.schedule_kst); return `
      <div class="info-row"><span>다음 조회</span><span>${p ? `${planLabel(p.next)}경` : "조회 끝"}</span></div>`; })()}
      <div class="info-row"><span>인원</span><span>성인 ${r.adults || 1}명</span></div>
      <div class="info-row"><span>좌석</span><span>${{ economy: "일반석", premium_economy: "프리미엄 일반석", business: "비즈니스", first: "일등석" }[r.travel_class] || "일반석"}</span></div>
      <div class="info-row"><span>경유</span><span>${r.max_stops == null ? "상관없음" : r.max_stops === 0 ? "직항만" : `${r.max_stops}회 이하`}</span></div>
      <a class="btn secondary" href="#edit/${esc(encodeURIComponent(r.id))}" style="margin-top:14px">조건 바꾸기 (직항 · 시간 · 인원 등)</a>
    </section>`;

  const draw = (days) => drawChart(days ? hist.slice(-days) : hist, r.alert_below);
  document.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x === b));
    draw(+b.dataset.range);
  }));
  draw(0);
  bindSwitcher();
  fitOneLine($app);
  window.onresize = () => { draw(+document.querySelector('.chip[aria-pressed="true"]').dataset.range); fitOneLine($app); };
}

function timeRange(a, b) {
  if (!a && !b) return "상관없음";
  if (!b || b === "24:00") return `${esc(a)} 이후`;
  if (!a || a === "00:00") return `${esc(b)} 이전`;
  return `${esc(a)} ~ ${esc(b)}`;
}

function legHTML(h, k, label) {
  const stops = h[k + "stops"];
  if (!k && h.dep_airport && h.arr_airport) label = `${label}${esc(h.dep_airport)}→${esc(h.arr_airport)} `;
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
const placeName1 = (c) => KR_AIRPORTS[c] || CITY[c] || c;
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
          <label>가는 날<input name="date" type="date"></label>
          <label data-round>오는 날<input name="return_date" type="date"></label>
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
  const setTrip = (trip) => {
    f.querySelector(`input[name=trip][value=${trip}]`).checked = true;
    document.getElementById("simple").hidden = trip === "multi";
    document.getElementById("multi").hidden = trip !== "multi";
    f.querySelectorAll("[data-round]").forEach((el) => { el.hidden = trip !== "round"; });
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

  f.addEventListener("change", (e) => { if (e.target.name === "trip") setTrip(e.target.value); update(); });
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
      ["from", "to"].forEach((k) => { if (!/^[A-Za-z]{3}(\s*,\s*[A-Za-z]{3})*$/.test(q(k).value.trim())) bad.push(q(k)); });
      if (!q("date").value) bad.push(q("date"));
    });
    if (!multi && body.return_date === null && f.querySelector("input[name=trip]:checked").value === "round") bad.push(f.elements.return_date);
    if (bad.length || (multi && body.legs.length < 2)) {
      bad.forEach((el) => el.classList.add("invalid"));
      smsg.textContent = bad.some((el) => el.type === "date") ? "빨간 칸을 채워 주세요. (날짜가 비어 있어요)" : "빨간 칸을 확인해 주세요. 공항 코드는 영문 3글자예요. 여러 곳이면 쉼표로 (예: ICN,GMP)";
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
