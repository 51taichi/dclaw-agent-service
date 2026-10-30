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
    "width:190px",
    "height:72px",
    "border:0",
    "background:transparent",
    "color-scheme:light",
    "overflow:hidden",
    "right:16px",
    "bottom:16px"
  ].join(";");

  var state = "closed";
  var launcher = { x: 0.92, y: 0.88, width: 190, height: 72 };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function placeClosed() {
    var width = clamp(Number(launcher.width) || 190, 120, 280);
    var height = clamp(Number(launcher.height) || 72, 56, 110);
    var left = clamp(innerWidth * launcher.x - width / 2, 8, Math.max(8, innerWidth - width - 8));
    var top = clamp(innerHeight * launcher.y - height / 2, 8, Math.max(8, innerHeight - height - 8));
    iframe.style.width = width + "px";
    iframe.style.height = height + "px";
    iframe.style.left = left + "px";
    iframe.style.top = top + "px";
    iframe.style.right = "auto";
    iframe.style.bottom = "auto";
    iframe.style.borderRadius = "36px";
  }

  function applyLayout() {
    var mobile = innerWidth <= 620;
    if (state === "closed") return placeClosed();
    if (mobile) {
      iframe.style.inset = "0";
      iframe.style.width = "100vw";
      iframe.style.height = "100dvh";
      iframe.style.borderRadius = "0";
      return;
    }
    var isCard = state === "card";
    var width = isCard ? 420 : 380;
    var height = Math.min(isCard ? 760 : 500, innerHeight - 32);
    iframe.style.width = width + "px";
    iframe.style.height = height + "px";
    iframe.style.top = "auto";
    iframe.style.bottom = "16px";
    iframe.style.borderRadius = "10px";
    if (launcher.x < 0.5) {
      iframe.style.left = "16px";
      iframe.style.right = "auto";
    } else {
      iframe.style.left = "auto";
      iframe.style.right = "16px";
    }
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== serviceOrigin || event.source !== iframe.contentWindow) return;
    var message = event.data;
    if (!message || message.type !== "dclaw:embed-state" || message.channel !== channel) return;
    if (!["closed", "open", "card"].includes(message.state)) return;
    state = message.state;
    if (message.launcher) {
      launcher.x = clamp(Number(message.launcher.x) || launcher.x, 0.04, 0.96);
      launcher.y = clamp(Number(message.launcher.y) || launcher.y, 0.06, 0.94);
      launcher.width = Number(message.launcher.width) || launcher.width;
      launcher.height = Number(message.launcher.height) || launcher.height;
    }
    applyLayout();
  });

  window.addEventListener("resize", applyLayout, { passive: true });
  placeClosed();
  (document.body || document.documentElement).appendChild(iframe);
})();
