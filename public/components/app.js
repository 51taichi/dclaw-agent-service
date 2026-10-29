import { COMPONENT_DEMOS, renderConversationComponent } from "/components/cards.js";

const root = document.querySelector("#componentRoot");

function renderDemo(demo) {
  const content = demo.states
    ? `<div class="component-state-list">${demo.states.map((state) => `<section class="component-state"><span class="component-state-label">${state.label}</span>${renderConversationComponent(demo.type, state.props)}${state.customerMessage ? `<div class="component-state-customer"><small>客户回复</small>${renderConversationComponent("message", { role: "customer", content: state.customerMessage })}</div>` : ""}</section>`).join("")}</div>`
    : demo.variants
    ? `<div class="variant-stack">${demo.variants.map((props) => renderConversationComponent(demo.type, props)).join("")}</div>`
    : renderConversationComponent(demo.type, demo.props);
  return `<section class="component-specimen" id="${demo.type}"><header><span>${demo.type}</span><strong>${demo.name}</strong></header><div class="component-stage">${content}</div></section>`;
}

root.innerHTML = `<header class="library-header"><div><small>DCLAW AGENT SERVICE</small><h1>会话组件</h1></div><span>${COMPONENT_DEMOS.length} 个组件</span></header><nav class="library-nav">${COMPONENT_DEMOS.map((demo) => `<a href="#${demo.type}">${demo.name}</a>`).join("")}</nav><div class="library-grid">${COMPONENT_DEMOS.map(renderDemo).join("")}</div>`;

const feedback = document.createElement("div");
feedback.className = "component-feedback";
feedback.setAttribute("role", "status");
feedback.setAttribute("aria-live", "polite");
document.body.append(feedback);
let feedbackTimer;

function showFeedback(message) {
  feedback.textContent = message;
  feedback.classList.add("is-visible");
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => feedback.classList.remove("is-visible"), 1800);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function setPressed(button, pressed) {
  button.classList.toggle("active", pressed);
  button.setAttribute("aria-pressed", String(pressed));
}

root.addEventListener("change", (event) => {
  const form = event.target.closest("[data-choice-form]");
  if (!form) return;
  form.querySelector("[data-action='submit-choice']").disabled = !form.querySelector("input:checked");
});

root.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-choice-form]");
  const leadForm = event.target.closest("[data-lead-form]");
  if (leadForm) {
    event.preventDefault();
    const button = leadForm.querySelector("[data-action='submit-lead']");
    button.textContent = "已提交";
    button.disabled = true;
    return;
  }
  if (!form) return;
  event.preventDefault();
  form.querySelectorAll("input").forEach((input) => { input.disabled = true; });
  const button = form.querySelector("[data-action='submit-choice']");
  button.disabled = true;
  button.textContent = "已提交";
  form.classList.add("is-submitted");
});

root.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-response-action]");
  if (!button || button.disabled) return;
  const card = button.closest("[data-component='assistant-response']");
  const content = card?.querySelector(".dclaw-answer-content")?.innerText.trim() || "";
  const action = button.dataset.responseAction;

  if (action === "copy") {
    try {
      await copyText(content);
      showFeedback("回复已复制");
    } catch {
      showFeedback("复制失败，请手动选择文字");
    }
    return;
  }

  if (action === "speak") {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return showFeedback("当前浏览器不支持朗读");
    if (button.classList.contains("active")) {
      window.speechSynthesis.cancel();
      setPressed(button, false);
      showFeedback("已停止朗读");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = "zh-CN";
    utterance.onend = utterance.onerror = () => setPressed(button, false);
    setPressed(button, true);
    window.speechSynthesis.speak(utterance);
    showFeedback("正在朗读");
    return;
  }

  if (action === "like" || action === "dislike") {
    const pressed = !button.classList.contains("active");
    card.querySelectorAll("[data-response-action='like'], [data-response-action='dislike']").forEach((item) => setPressed(item, false));
    setPressed(button, pressed);
    showFeedback(pressed ? action === "like" ? "感谢您的反馈" : "已记录，将继续改进" : "已取消反馈");
    return;
  }

  if (action === "share") {
    try {
      if (navigator.share) await navigator.share({ title: "DClaw Agent 回复", text: content, url: location.href });
      else {
        await copyText(`${content}\n${location.href}`);
        showFeedback("回复和页面链接已复制");
      }
    } catch (error) {
      if (error?.name !== "AbortError") showFeedback("分享未完成");
    }
    return;
  }

  if (action === "regenerate") {
    button.disabled = true;
    button.classList.add("is-working");
    showFeedback("正在重新生成");
    setTimeout(() => {
      button.disabled = false;
      button.classList.remove("is-working");
      showFeedback("组件演示：已触发重新生成");
    }, 700);
  }
});
