// 기록 켜기/끄기, 받은 기록을 개인정보를 가린 뒤 브라우저 안(chrome.storage)에 저장.
// 기록은 이 PC 밖으로 나가지 않아요. 관리 화면에서 파일로 저장할 때만 꺼낼 수 있어요.
import { cleanCapture } from "./redact.js";

export const AF_MATCHES = [
  "https://*.airfrance.co.kr/*",
  "https://*.airfrance.com/*",
  "https://*.airfrance.fr/*",
  "https://*.airfrance.us/*",
  "https://*.airfrance.co.jp/*",
  "https://*.airfrance.co.uk/*",
];
const HOOK_ID = "award-seat-hook";
const MAX_BYTES = 80 * 1024 * 1024;

let state = null; // { seq, bytes, count }
let chain = Promise.resolve();
const enqueue = (fn) => (chain = chain.then(fn, fn));

async function load() {
  if (state) return state;
  const { seq = 0, bytes = 0, count = 0 } = await chrome.storage.local.get(["seq", "bytes", "count"]);
  state = { seq, bytes, count };
  return state;
}

async function getRec() {
  const { rec } = await chrome.storage.local.get("rec");
  return rec || { on: false };
}

async function setBadge() {
  const rec = await getRec();
  const s = await load();
  await chrome.action.setBadgeBackgroundColor({ color: rec.on ? "#d93025" : "#5f6368" });
  await chrome.action.setBadgeText({ text: rec.on ? String(Math.min(s.count, 999)) : "" });
}

async function registerHook() {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [HOOK_ID] });
  if (!existing.length) {
    await chrome.scripting.registerContentScripts([
      { id: HOOK_ID, matches: AF_MATCHES, js: ["hook.js"], runAt: "document_start", world: "MAIN", persistAcrossSessions: true },
    ]);
  }
  // 이미 열려 있는 에어프랑스 탭에도 바로 넣음 (새로 고침하지 않아도 이후 검색부터 기록)
  const tabs = await chrome.tabs.query({ url: AF_MATCHES });
  await Promise.all(tabs.map((t) =>
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["hook.js"], world: "MAIN" }).catch(() => {})));
  return tabs.length;
}

async function unregisterHook() {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [HOOK_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [HOOK_ID] });
}

async function start() {
  const rec = { on: true, started_at: new Date().toISOString() };
  await chrome.storage.local.set({ rec });
  const tabs = await registerHook();
  await setBadge();
  return { ok: true, tabs };
}

async function stop(reason) {
  const rec = await getRec();
  await chrome.storage.local.set({ rec: { ...rec, on: false, stopped_at: new Date().toISOString(), stop_reason: reason || null } });
  await unregisterHook();
  await setBadge();
  return { ok: true };
}

async function addCapture(raw, sender) {
  const rec = await getRec();
  if (!rec.on) return { ok: false };
  const c = cleanCapture(raw);
  if (!c) return { ok: false };
  if (sender && sender.tab) c.tab = sender.tab.id;
  const s = await load();
  const size = JSON.stringify(c).length;
  if (s.bytes + size > MAX_BYTES) { await stop("용량 한도(80MB)에 닿아 기록을 멈췄어요"); return { ok: false }; }
  s.seq += 1; s.bytes += size; s.count += 1;
  await chrome.storage.local.set({ ["c:" + String(s.seq).padStart(7, "0")]: c, seq: s.seq, bytes: s.bytes, count: s.count });
  await setBadge();
  return { ok: true };
}

async function clearAll() {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("c:")));
  state = { seq: 0, bytes: 0, count: 0 };
  await chrome.storage.local.set({ seq: 0, bytes: 0, count: 0 });
  await setBadge();
  return { ok: true };
}

async function status() {
  const rec = await getRec();
  const s = await load();
  return { rec, count: s.count, bytes: s.bytes };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const run = {
    capture: () => addCapture(msg.data, sender),
    start: () => start(),
    stop: () => stop(),
    clear: () => clearAll(),
    status: () => status(),
    note: () => addCapture({ kind: "note", text: msg.text, t: Date.now() }, sender),
  }[msg && msg.type];
  if (!run) return false;
  enqueue(run).then(reply, (e) => reply({ ok: false, error: String(e && e.message || e) }));
  return true; // 비동기 응답
});

chrome.runtime.onStartup.addListener(() => { setBadge(); });
chrome.runtime.onInstalled.addListener(async () => {
  // 설치·업데이트 직후에는 기록을 꺼진 상태로 시작
  const rec = await getRec();
  if (rec.on) await stop("확장 프로그램이 다시 설치·업데이트되어 기록을 멈췄어요");
  else await unregisterHook();
  await setBadge();
});
