// 에어프랑스 페이지에서 기록이 켜져 있을 때만 동작합니다.
//  - hook.js 가 넘긴 검색 결과(JSON)
//  - 어떤 버튼을 눌렀는지 (자동 조회 순서를 만들 때 씀. 입력한 글자는 저장하지 않음)
//  - 누른 뒤 화면이 멈췄을 때의 글자 (스크린샷 아님)
(() => {
  if (window.__awardSeatBridge) return;
  window.__awardSeatBridge = true;

  const host = location.hostname;
  const isSensitivePage = () =>
    /(^|\.)(login|auth|accounts?|sso|id|secure-login)\./i.test(host) ||
    /(login|logon|signin|sign-in|connexion|password|mot-de-passe|register|inscription|payment|paiement|checkout)/i.test(location.pathname);

  let on = false;
  const setOn = (rec) => { const was = on; on = !!(rec && rec.on); if (on && !was) scheduleSnapshot("start"); };
  chrome.storage.local.get("rec").then(({ rec }) => setOn(rec)).catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.rec) setOn(ch.rec.newValue); });

  const send = (data) => {
    if (!on || isSensitivePage()) return;
    try { chrome.runtime.sendMessage({ type: "capture", data: { ...data, page: location.href } }).catch(() => {}); } catch {}
  };

  // ---- hook.js 가 넘긴 응답
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__awardRec !== 1 || e.data.kind !== "net") return;
    const { url, method, status, req, body, t } = e.data;
    send({ kind: "net", url, method, status, req, body, t });
  });

  // ---- 누른 버튼 / 바꾼 선택 항목
  const SECRET_FIELD = /pass|pwd|email|mail|card|cvv|cvc|phone|tel\b|birth|\bpin\b|otp|verif|secret|token|iban|(first|last|full|given|family|sur|user|middle)[-_ ]?name/i;
  const isSecretField = (el) =>
    /^(password|email|tel|hidden)$/i.test(el.type || "") ||
    SECRET_FIELD.test([el.name, el.id, el.autocomplete, el.getAttribute("aria-label")].filter(Boolean).join(" "));

  const cssPath = (el) => {
    const parts = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 7; n = n.parentElement, i++) {
      let p = n.tagName.toLowerCase();
      if (n.id && !/\d{3,}/.test(n.id)) { parts.unshift(`${p}#${n.id}`); break; }
      const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(n) + 1})`;
      parts.unshift(p);
    }
    return parts.join(" > ");
  };
  const describe = (el) => {
    const data = {};
    for (const a of el.attributes) if (/^data-(testid|test|qa|cy|automation|e2e|ref|day|date|value|id)/i.test(a.name)) data[a.name] = a.value.slice(0, 80);
    const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      name: el.getAttribute("name") || undefined,
      type: el.getAttribute("type") || undefined,
      role: el.getAttribute("role") || undefined,
      aria: (el.getAttribute("aria-label") || "").slice(0, 100) || undefined,
      text: isField ? undefined : (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100) || undefined,
      cls: [...el.classList].slice(0, 5).join(" ") || undefined,
      data: Object.keys(data).length ? data : undefined,
      href: el instanceof HTMLAnchorElement ? el.pathname + el.search : undefined,
      path: cssPath(el),
    };
  };

  document.addEventListener("click", (e) => {
    if (!on || !(e.target instanceof Element)) return;
    const el = e.target.closest("button,a,[role=button],[role=tab],[role=option],[role=gridcell],[role=radio],[role=checkbox],[role=link],label,input,select,li,td,[data-testid]") || e.target;
    if (el instanceof HTMLInputElement && isSecretField(el)) return;
    send({ kind: "click", t: Date.now(), el: describe(el), x: Math.round(e.clientX), y: Math.round(e.clientY) });
    scheduleSnapshot("click");
  }, true);

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!on || !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    if (isSecretField(el)) return;
    const value = el instanceof HTMLInputElement && /^(checkbox|radio)$/i.test(el.type) ? String(el.checked) : String(el.value);
    send({ kind: "input", t: Date.now(), el: describe(el), value });
  }, true);

  // ---- 화면 글자 기록 (화면 변화가 멈춘 뒤)
  let lastSnap = 0;
  let pending = null;
  const waitQuiet = (quietMs = 1500, maxMs = 10000) => new Promise((resolve) => {
    let timer = setTimeout(done, quietMs);
    const stop = setTimeout(done, maxMs);
    const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quietMs); });
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    function done() { mo.disconnect(); clearTimeout(timer); clearTimeout(stop); resolve(); }
  });
  const snapshot = (reason) => {
    const root = document.querySelector("main") || document.body;
    if (!root) return;
    lastSnap = Date.now();
    const text = (root.innerText || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    send({ kind: "page", t: Date.now(), reason, title: document.title, url: location.href, text });
  };
  function scheduleSnapshot(reason) {
    if (!on || pending) return;
    pending = waitQuiet().then(() => {
      pending = null;
      if (Date.now() - lastSnap > 2500) snapshot(reason);
    });
  }

  // 주소가 바뀌면 (한 페이지 안에서 이동하는 경우 포함) 화면을 다시 기록
  let lastUrl = location.href;
  setInterval(() => { if (location.href !== lastUrl) { lastUrl = location.href; scheduleSnapshot("navigate"); } }, 1000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => scheduleSnapshot("load"));
  else scheduleSnapshot("load");

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === "snap") {
      if (!on) { reply({ ok: false, reason: "기록이 꺼져 있어요" }); return; }
      if (isSensitivePage()) { reply({ ok: false, reason: "로그인·결제 화면은 기록하지 않아요" }); return; }
      snapshot("manual");
      reply({ ok: true });
    }
  });
})();
