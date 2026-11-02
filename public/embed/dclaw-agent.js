(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;

  var channel = String(script.getAttribute("data-channel") || "").trim();
  if (!channel) {
    console.error("[DClaw Agent] 缺少 data-channel");
    return;
  }

  var instanceKey = "dclaw-agent:" + channel;
  if ([].some.call(document.querySelectorAll("iframe[data-dclaw-agent]"), function (item) { return item.dataset.dclawAgent === instanceKey; })) return;

  var serviceUrl;
  try {
    serviceUrl = new URL(script.src, document.baseURI);
  } catch (_error) {
    return;
  }

  var serviceOrigin = serviceUrl.origin;
  var iframe = document.createElement("iframe");
  iframe.dataset.dclawAgent = instanceKey;
  iframe.title = "AI 客服";
  iframe.allow = "microphone; camera; clipboard-write";
  iframe.src = serviceOrigin + "/channels/" + encodeURIComponent(channel) + "?surface=embed";
  iframe.setAttribute("aria-label", "AI 客服");
  iframe.style.cssText = [
    "position:fixed",
    "z-index:2147483000",
    "width:276px",
    "height:236px",
    "border:0",
    "background:transparent",
    "color-scheme:light",
    "overflow:hidden",
    "right:16px",
    "bottom:16px"
  ].join(";");

  var state = "open";

  function applyLayout() {
    var mobile = innerWidth <= 620;
    if (state === "card" && mobile) {
      iframe.style.inset = "0";
      iframe.style.width = "100vw";
      iframe.style.height = "100dvh";
      iframe.style.borderRadius = "0";
      return;
    }
    var width = state === "card" ? 420 : Math.min(276, innerWidth - 16);
    var height = Math.min(state === "card" ? 760 : 236, innerHeight - 16);
    iframe.style.width = width + "px";
    iframe.style.height = height + "px";
    iframe.style.top = "auto";
    iframe.style.bottom = mobile ? "8px" : "16px";
    iframe.style.left = "auto";
    iframe.style.right = mobile ? "8px" : "16px";
    iframe.style.borderRadius = "0";
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== serviceOrigin || event.source !== iframe.contentWindow) return;
    var message = event.data;
    if (!message || message.type !== "dclaw:embed-state" || message.channel !== channel) return;
    if (!["open", "card"].includes(message.state)) return;
    state = message.state;
    applyLayout();
  });

  window.addEventListener("resize", applyLayout, { passive: true });
  applyLayout();
  (document.body || document.documentElement).appendChild(iframe);
})();
