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
  var rosterWidth = 276;
  var rosterHeight = 236;
  var rosterDraggable = false;
  var rosterPosition = null;
  var dragOrigin = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function applyLayout() {
    var mobile = innerWidth <= 620;
    if (state === "card" && mobile) {
      iframe.style.inset = "0";
      iframe.style.width = "100vw";
      iframe.style.height = "100dvh";
      iframe.style.borderRadius = "0";
      return;
    }
    var width = state === "card" ? 420 : Math.min(rosterWidth, innerWidth - 16);
    var height = Math.min(state === "card" ? 760 : rosterHeight, innerHeight - 16);
    iframe.style.width = width + "px";
    iframe.style.height = height + "px";
    if (state === "open" && rosterPosition) {
      var margin = mobile ? 12 : 24;
      rosterPosition.left = clamp(rosterPosition.left, margin, Math.max(margin, innerWidth - width - margin));
      rosterPosition.top = clamp(rosterPosition.top, margin, Math.max(margin, innerHeight - height - margin));
      iframe.style.left = rosterPosition.left + "px";
      iframe.style.top = rosterPosition.top + "px";
      iframe.style.right = "auto";
      iframe.style.bottom = "auto";
    } else {
      iframe.style.top = "auto";
      iframe.style.bottom = mobile ? "12px" : rosterDraggable ? "24px" : "16px";
      iframe.style.left = "auto";
      iframe.style.right = mobile ? "12px" : rosterDraggable ? "24px" : "16px";
    }
    iframe.style.borderRadius = "0";
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== serviceOrigin || event.source !== iframe.contentWindow) return;
    var message = event.data;
    if (!message || message.channel !== channel) return;
    if (message.type === "dclaw:embed-drag") {
      if (!rosterDraggable || state !== "open") return;
      if (message.phase === "start") {
        var rect = iframe.getBoundingClientRect();
        dragOrigin = { left: rect.left, top: rect.top };
        return;
      }
      if (!dragOrigin) return;
      var dragMargin = innerWidth <= 620 ? 12 : 24;
      rosterPosition = {
        left: clamp(dragOrigin.left + (Number(message.deltaX) || 0), dragMargin, Math.max(dragMargin, innerWidth - iframe.offsetWidth - dragMargin)),
        top: clamp(dragOrigin.top + (Number(message.deltaY) || 0), dragMargin, Math.max(dragMargin, innerHeight - iframe.offsetHeight - dragMargin))
      };
      applyLayout();
      if (message.phase === "end") dragOrigin = null;
      return;
    }
    if (message.type !== "dclaw:embed-state") return;
    if (!["open", "card"].includes(message.state)) return;
    state = message.state;
    if (state === "open") {
      rosterWidth = clamp(Number(message.width) || rosterWidth, 120, 420);
      rosterHeight = clamp(Number(message.height) || rosterHeight, 120, 420);
      rosterDraggable = Boolean(message.draggable);
    }
    applyLayout();
  });

  window.addEventListener("resize", applyLayout, { passive: true });
  applyLayout();
  (document.body || document.documentElement).appendChild(iframe);
})();
