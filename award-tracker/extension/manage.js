import { looksLikeAward } from "./redact.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtBytes = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);
const time = (t) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const KIND = { net: "데이터", click: "버튼", input: "선택", page: "화면 글자", note: "메모" };

async function loadAll() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith("c:")).sort();
  return { rec: all.rec || { on: false }, captures: keys.map((k) => all[k]) };
}

function opName(c) {
  try {
    const u = new URL(c.url);
    const q = u.searchParams.get("operationName");
    if (q) return q;
    if (c.request && typeof c.request === "object" && c.request.operationName) return c.request.operationName;
    return u.pathname;
  } catch { return c.url; }
}

function describe(c) {
  if (c.kind === "net") return `${esc(c.method)} ${esc(opName(c))}`;
  if (c.kind === "click") return esc((c.el && (c.el.text || c.el.aria || c.el.path)) || "");
  if (c.kind === "input") return `${esc((c.el && (c.el.aria || c.el.name || c.el.id)) || "")} = ${esc(c.value)}`;
  if (c.kind === "page") return `${esc(c.title)} <span class="muted">(${esc(c.reason)}, ${(c.text || "").length.toLocaleString("ko-KR")}자)</span>`;
  return esc(c.text || "");
}

async function render() {
  const { rec, captures } = await loadAll();
  const award = captures.filter(looksLikeAward);
  const count = (k) => captures.filter((c) => c.kind === k).length;
  $("n-all").textContent = captures.length.toLocaleString("ko-KR");
  $("n-award").textContent = award.length.toLocaleString("ko-KR");
  $("n-click").textContent = count("click").toLocaleString("ko-KR");
  $("n-page").textContent = count("page").toLocaleString("ko-KR");
  $("state").textContent = rec.on
    ? `● 기록 중 (${new Date(rec.started_at).toLocaleString("ko-KR")} 시작)`
    : rec.started_at ? `멈춤 · 마지막 기록 시작 ${new Date(rec.started_at).toLocaleString("ko-KR")}` : "아직 기록한 적이 없어요";

  const v = $("verdict");
  v.hidden = !captures.length;
  if (award.length) {
    v.className = "verdict good";
    v.textContent = `마일 · 세금 · 항공편으로 보이는 데이터 ${award.length}건이 기록됐어요. 파일로 저장해서 보내 주시면 돼요.`;
  } else if (captures.length) {
    v.className = "verdict warn";
    v.textContent = "아직 검색 결과로 보이는 데이터가 없어요. 기록을 켠 채로 ‘마일리지로 예약’ 검색을 해 주세요. 그래도 안 되면 지금 파일을 그대로 보내 주세요.";
  }

  $("rows").innerHTML = captures.slice(-300).reverse().map((c) => `
    <tr>
      <td class="k">${time(c.t)}</td>
      <td class="k"><span class="tag${looksLikeAward(c) ? " award" : ""}">${KIND[c.kind] || c.kind}</span></td>
      <td class="d">${describe(c)}</td>
      <td class="k muted">${fmtBytes(JSON.stringify(c).length)}</td>
    </tr>`).join("") || `<tr><td colspan="4" class="muted">기록이 없어요</td></tr>`;
}

$("export").onclick = async () => {
  const { rec, captures } = await loadAll();
  if (!captures.length) { $("msg").textContent = "저장할 기록이 없어요."; return; }
  const doc = {
    format: "award-seat-recording",
    version: 1,
    extension_version: chrome.runtime.getManifest().version,
    exported_at: new Date().toISOString(),
    recording_started_at: rec.started_at || null,
    browser: navigator.userAgent,
    counts: { all: captures.length, award_like: captures.filter(looksLikeAward).length },
    captures,
  };
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: "application/json" });
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `award-recording-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  $("msg").textContent = `${a.download} 파일로 저장했어요 (${fmtBytes(blob.size)}). 다운로드 폴더에서 찾아 Claude 대화에 첨부해 주세요.`;
};

$("clear").onclick = async () => {
  if (!confirm("기록을 모두 지울까요? 지운 기록은 되돌릴 수 없어요.")) return;
  await chrome.runtime.sendMessage({ type: "clear" });
  $("msg").textContent = "모두 지웠어요.";
  render();
};

chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && (ch.count || ch.rec)) render(); });
render();
