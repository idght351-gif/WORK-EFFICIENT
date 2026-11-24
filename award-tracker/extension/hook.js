// 페이지가 받아 오는 검색 결과(JSON)를 복사해서 기록기(bridge.js)에 넘겨 줍니다.
// 기록을 켰을 때만 에어프랑스 페이지에 들어가고, 추가 요청은 보내지 않아요 (이미 받은 응답을 복사만 함).
(() => {
  const FLAG = Symbol.for("award-seat-recorder");
  if (window[FLAG]) return;
  Object.defineProperty(window, FLAG, { value: true });

  const MAX = 4 * 1024 * 1024;
  const post = (d) => window.postMessage({ __awardRec: 1, kind: "net", ...d }, location.origin);
  const wanted = (url, ct) => /json|graphql/i.test(ct || "") || /\/gql\b|graphql/i.test(String(url || ""));
  const reqText = (b) => (typeof b === "string" ? b.slice(0, 50000) : null);

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input && input.url;
      const method = (init && init.method) || (input && input.method) || "GET";
      const req = reqText(init && init.body);
      p.then((res) => {
        try {
          if (!wanted(res.url || url, res.headers.get("content-type"))) return;
          res.clone().text().then((body) => {
            if (body.length <= MAX) post({ url: res.url || String(url), method, status: res.status, req, body, t: Date.now() });
          }).catch(() => {});
        } catch {}
      }, () => {});
    } catch {}
    return p;
  };

  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__awardRec = { method, url: String(url) }; } catch {}
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (b) {
    const meta = this.__awardRec;
    if (meta) {
      meta.req = reqText(b);
      this.addEventListener("load", () => {
        try {
          if (!wanted(this.responseURL || meta.url, this.getResponseHeader("content-type"))) return;
          let body = null;
          if (this.responseType === "" || this.responseType === "text") body = this.responseText;
          else if (this.responseType === "json") body = JSON.stringify(this.response);
          if (body != null && body.length <= MAX) {
            post({ url: this.responseURL || meta.url, method: meta.method, status: this.status, req: meta.req, body, t: Date.now() });
          }
        } catch {}
      });
    }
    return XS.apply(this, arguments);
  };
})();
