"use strict";

const $app = document.getElementById("app");
const won = (v) => (v == null ? "-" : v.toLocaleString("ko-KR") + "원");
const md = (iso) => { const [, m, d] = iso.split("-"); return `${+m}/${+d}`; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LEVEL = { low: ["good", "Google 기준 싼 편"], typical: ["", "Google 기준 보통"], high: ["bad", "Google 기준 비싼 편"] };
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function routePath(r) {
  return r.legs && r.legs.length
    ? r.legs.map((l) => l.from).concat(r.legs[r.legs.length - 1].to).map((c) => esc(c.toUpperCase())).join(" → ")
    : `${esc(r.from)} → ${esc(r.to)}`;
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

async function getJSON(url) {
  const r = await fetch(url + "?t=" + Date.now());
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

// ------------------------------------------------------------ 목록
async function renderList() {
  let index;
  try { index = await getJSON("data/index.json"); } catch { index = { routes: [] }; }
  if (index.updated_at) document.getElementById("updated").textContent =
    "업데이트 " + new Date(index.updated_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const order = { active: 0, paused: 1, ended: 2 };
  const routes = [...index.routes].sort((a, b) => order[a.status] - order[b.status] || a.date.localeCompare(b.date));

  $app.innerHTML = `
    ${quotaHTML(index.quota)}
    <div class="quota-head" style="margin-top:8px"><h2 class="section-title">추적 중인 항공권</h2><span class="muted small">조회 ${scheduleText(index.schedule_kst)}</span></div>
    ${routes.length ? routes.map(cardHTML).join("") :
      `<div class="card empty"><p>아직 추적 중인 노선이 없어요.</p><p class="muted small">routes.json 에 노선을 추가하면 다음 실행부터 기록돼요.</p></div>`}
    <a href="#add" class="btn secondary" style="margin-top:16px">+ 노선 추가하기</a>`;
  routes.forEach((r) => { const el = document.getElementById("spark-" + r.id); if (el) sparkline(el, r.spark, r.alert_below); });
  routes.forEach((r) => {
    const el = document.getElementById("plan-" + r.id), p = checkPlan(r, r.status, index.schedule_kst);
    if (el) el.textContent = p ? `다음 조회 ${planLabel(p.next)}경 · 마지막 ${planLabel(p.last, false)}` : "";
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
    <div>
      <div class="route-name">${esc(r.name)}</div>
      <div class="route-meta">${routePath(r)} · ${tripLabel(r)} · ${dday(r.date)}</div>
      <div class="badges">${badges.join("")}</div>
      <div class="route-plan muted small" id="plan-${esc(r.id)}"></div>
    </div>
    <div>
      <div class="route-price num">${won(s.current)}</div>
      <div class="route-delta num">${deltaHTML(s.current, s.prev)}</div>
    </div>
    ${r.spark && r.spark.length > 1 ? `<svg class="spark" id="spark-${esc(r.id)}" aria-hidden="true"></svg>` : ""}
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
  svg.innerHTML = `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last)}" cy="${y(data[last])}" r="4" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/>`;
}

// ------------------------------------------------------------ 비교 사이트 링크
// tracker/check_prices.py 의 compare_links 와 같은 규칙입니다.
function compareLinks(r) {
  const org = (r.from || "").toUpperCase(), dst = (r.to || "").toUpperCase();
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
  let sky = `https://www.skyscanner.co.kr/transport/flights/${org.toLowerCase()}/${dst.toLowerCase()}/${ymd(r.date)}/` + (ret ? `${ymd(ret)}/` : "");
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
async function renderDetail(id) {
  let doc;
  try { doc = await getJSON(`data/routes/${encodeURIComponent(id)}.json`); }
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

  $app.innerHTML = `
    <a class="back" href="#">‹ 목록</a>
    <section class="card">
      <div class="hero-route">${esc(r.name)} · ${routePath(r)}</div>
      <div class="hero-sub">${tripLabel(r)} · ${(r.adults || 1) > 1 ? `성인 ${r.adults}명 총액` : "1인 가격"} · ${dday(r.date)}</div>
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
      <h3 class="section-title">추적 조건</h3>
      ${r.legs && r.legs.length
        ? r.legs.map((l, i) => `<div class="info-row"><span>${i + 1}구간 ${md(l.date)} ${esc(l.from)}→${esc(l.to)}</span><span>${timeRange(l.depart_after, l.depart_before)}</span></div>`).join("")
        : `<div class="info-row"><span>가는 편 출발</span><span>${timeRange(r.depart_after, r.depart_before)}</span></div>`}
      ${r.return_date ? `<div class="info-row"><span>오는 편 출발</span><span>${timeRange(r.return_after, r.return_before)}</span></div>` : ""}
      ${(() => { const p = checkPlan(r, doc.status, doc.schedule_kst); return `
      <div class="info-row"><span>조회 일정</span><span>${scheduleText(doc.schedule_kst)}<div class="sub muted small">빠지면 07:10 · 07:50 에 다시 시도</div></span></div>
      <div class="info-row"><span>다음 조회</span><span>${p ? `${planLabel(p.next)}경` : "조회 끝"}</span></div>
      <div class="info-row"><span>마지막 조회</span><span>${p ? `${planLabel(p.last)} (출발일)` : "-"}</span></div>`; })()}
      <div class="info-row"><span>인원</span><span>성인 ${r.adults || 1}명</span></div>
      <div class="info-row"><span>알림 목표가</span><span class="num">${r.alert_below ? won(r.alert_below) + " 이하" : "설정 안 함"}</span></div>
      <div class="info-row"><span>좌석</span><span>${{ economy: "일반석", premium_economy: "프리미엄 일반석", business: "비즈니스", first: "일등석" }[r.travel_class] || "일반석"}</span></div>
      <div class="info-row"><span>경유</span><span>${r.max_stops == null ? "상관없음" : r.max_stops === 0 ? "직항만" : `${r.max_stops}회 이하`}</span></div>
      ${lastEntry && lastEntry.legs
        ? lastEntry.legs.map((l, i) => `<div class="info-row"><span>최근 최저가 ${i + 1}구간</span><span>${esc(`${l.airline} ${l.flight_number}`)}</span></div>`).join("")
        : `<div class="info-row"><span>최근 최저가 가는 편</span><span>${lastEntry ? esc(`${lastEntry.airline} ${lastEntry.flight_number}`) : "-"}</span></div>`}
      ${lastEntry && lastEntry.return_airline ? `<div class="info-row"><span>최근 최저가 오는 편</span><span>${esc(`${lastEntry.return_airline} ${lastEntry.return_flight_number}`)}</span></div>` : ""}
      <a class="btn secondary" href="#edit/${esc(encodeURIComponent(r.id))}" style="margin-top:14px">조건 바꾸기 (직항 · 시간 · 인원 등)</a>
    </section>

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
    </section>`;

  const draw = (days) => drawChart(days ? hist.slice(-days) : hist, r.alert_below);
  document.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x === b));
    draw(+b.dataset.range);
  }));
  draw(0);
  window.onresize = () => draw(+document.querySelector('.chip[aria-pressed="true"]').dataset.range);
}

function timeRange(a, b) {
  if (!a && !b) return "상관없음";
  if (!b || b === "24:00") return `${esc(a)} 이후`;
  if (!a || a === "00:00") return `${esc(b)} 이전`;
  return `${esc(a)} ~ ${esc(b)}`;
}

function legHTML(h, k, label) {
  const stops = h[k + "stops"];
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
  const fmtK = (v) => (v >= 10000 ? (v / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "만" : v.toLocaleString("ko-KR"));
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

async function renderEdit(id) {
  let doc;
  try { doc = await getJSON(`data/routes/${encodeURIComponent(id)}.json`); }
  catch { $app.innerHTML = `<a class="back" href="#">‹ 목록</a><div class="card empty">노선을 찾을 수 없어요.</div>`; return; }
  renderAdd(doc.route);
}

function renderAdd(edit) {
  const info = repoInfo();
  const editUrl = info ? `https://github.com/${info.owner}/${info.repo}/edit/main/flight-tracker/routes.json` : null;
  const legRow = (l = {}) => `
    <div class="leg">
      <div class="leg-head"><b class="leg-no"></b><button type="button" class="link leg-del">삭제</button></div>
      <div class="form">
        <label>출발 공항<input data-k="from" value="${esc(l.from || "")}" maxlength="3"></label>
        <label>도착 공항<input data-k="to" value="${esc(l.to || "")}" maxlength="3"></label>
        <label class="full">날짜<input data-k="date" type="date" value="${esc(l.date || "")}"></label>
        <label>출발 (부터)<input data-k="depart_after" type="time" value="${esc(l.depart_after || "")}"></label>
        <label>출발 (까지)<input data-k="depart_before" type="time" value="${esc(l.depart_before === "24:00" ? "" : l.depart_before || "")}"></label>
      </div>
    </div>`;
  $app.innerHTML = `
    <a class="back" href="${edit ? `#${esc(encodeURIComponent(edit.id))}` : "#"}">‹ ${edit ? "노선" : "목록"}</a>
    <section class="card">
      <h3 class="section-title">${edit ? "추적 조건 바꾸기" : "노선 추가하기"}</h3>
      <p class="muted small" style="margin-top:-6px">${edit ? "바꾸면 아래에 routes.json 에서 이 노선 항목을 대신할 내용이 만들어져요." : "입력하면 아래에 routes.json 에 붙여 넣을 내용이 만들어져요."}</p>
      <form id="f" onsubmit="return false">
        <div class="seg" role="radiogroup" aria-label="여정 종류">
          <label><input type="radio" name="trip" value="round" checked><span>왕복</span></label>
          <label><input type="radio" name="trip" value="oneway"><span>편도</span></label>
          <label><input type="radio" name="trip" value="multi"><span>다구간</span></label>
        </div>
        <div class="form">
          <label class="full">이름<input name="name" value="서울 → 오사카"></label>
        </div>
        <div class="form" id="simple">
          <label>출발 공항 코드<input name="from" value="ICN" maxlength="3"></label>
          <label>도착 공항 코드<input name="to" value="KIX" maxlength="3"></label>
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
      <h3 class="section-title">${edit ? "routes.json 에서 바꿀 내용" : "routes.json 에 추가할 내용"}</h3>
      <pre class="snippet" id="out"></pre>
      <button class="btn secondary" id="copy" style="margin:12px 0 8px">복사하기</button>
      ${editUrl ? `<a class="btn" href="${editUrl}" target="_blank" rel="noopener">GitHub에서 routes.json 열기</a>` : ""}
      <p class="muted small">${edit
        ? `routes.json 에서 "id": "${esc(edit.id)}" 인 항목의 { } 전체를 위 내용으로 바꾼 뒤 Commit 하세요. 바로 한 번 조회되고, 이후 매일 06:30 에 조회돼요.`
        : `"routes" 목록 안의 마지막 항목 뒤에 쉼표(,)를 찍고 붙여 넣은 뒤 Commit 하세요. 바로 한 번 조회되고, 이후 매일 06:30 에 조회돼요.`}</p>
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
  };

  if (edit) {
    f.elements["name"].value = edit.name;
    f.adults.value = edit.adults || 1; f.travel_class.value = edit.travel_class || "economy";
    f.max_stops.value = edit.max_stops == null ? "" : String(edit.max_stops);
    f.alert_below.value = edit.alert_below || "";
    if (edit.legs && edit.legs.length) {
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

  const update = () => {
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
      body = { id, name: v.name, legs, ...common };
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
}

// ------------------------------------------------------------ 라우팅
function route() {
  window.onresize = null;
  window.scrollTo(0, 0);
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) renderList();
  else if (id === "add") renderAdd();
  else if (id.startsWith("edit/")) renderEdit(id.slice(5));
  else renderDetail(id);
}
window.addEventListener("hashchange", route);
route();
