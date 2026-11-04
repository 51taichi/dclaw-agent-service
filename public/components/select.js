const SELECT_SYNC_EVENT = "dclaw:select-sync";

let activeControl = null;
let observer = null;

function eligible(select) {
  return select instanceof HTMLSelectElement
    && !select.multiple
    && Number(select.size || 0) <= 1
    && !select.hidden
    && select.getAttribute("aria-hidden") !== "true"
    && !select.dataset.nativeSelect;
}

function selectedOption(select) {
  return select.options[select.selectedIndex] || select.options[0] || null;
}

function positionMenu(control) {
  if (!control || control.menu.hidden) return;
  const rect = control.trigger.getBoundingClientRect();
  const edge = 12;
  const gap = 7;
  const availableBelow = window.innerHeight - rect.bottom - edge;
  const availableAbove = rect.top - edge;
  const preferredHeight = Math.min(320, Math.max(52, control.select.options.length * 42 + 16));
  const openAbove = availableBelow < Math.min(preferredHeight, 180) && availableAbove > availableBelow;
  const maxHeight = Math.max(96, Math.min(preferredHeight, openAbove ? availableAbove - gap : availableBelow - gap));
  const width = Math.min(Math.max(rect.width, 180), window.innerWidth - edge * 2);
  const left = Math.min(Math.max(edge, rect.left), window.innerWidth - width - edge);

  control.menu.style.width = `${width}px`;
  control.menu.style.maxHeight = `${maxHeight}px`;
  control.menu.style.left = `${left}px`;
  control.menu.style.top = openAbove ? "auto" : `${rect.bottom + gap}px`;
  control.menu.style.bottom = openAbove ? `${window.innerHeight - rect.top + gap}px` : "auto";
  control.menu.classList.toggle("opens-above", openAbove);
}

function focusOption(control, index) {
  const options = [...control.menu.querySelectorAll(".ds-select-option:not(:disabled)")];
  if (!options.length) return;
  const nextIndex = Math.min(Math.max(index, 0), options.length - 1);
  options[nextIndex].focus();
  options[nextIndex].scrollIntoView({ block: "nearest" });
}

function closeSelect(control, { restoreFocus = false } = {}) {
  if (!control) return;
  control.menu.hidden = true;
  control.wrapper.classList.remove("is-open");
  control.trigger.setAttribute("aria-expanded", "false");
  if (activeControl === control) activeControl = null;
  if (restoreFocus) control.trigger.focus();
}

function closeActive(options) {
  closeSelect(activeControl, options);
}

function syncControl(control) {
  const { select, trigger, value, menu } = control;
  if (!eligible(select)) {
    closeSelect(control);
    control.wrapper.hidden = true;
    return;
  }

  control.wrapper.hidden = false;
  const option = selectedOption(select);
  value.textContent = option?.textContent?.trim() || select.getAttribute("placeholder") || "请选择";
  const fieldLabel = select.closest("label")?.querySelector(":scope > span")?.textContent?.trim();
  trigger.setAttribute("aria-label", `${fieldLabel || "选择"}：${value.textContent}`);
  trigger.disabled = select.disabled;
  trigger.setAttribute("aria-disabled", String(select.disabled));
  trigger.classList.toggle("is-placeholder", !option?.value);

  const fragment = document.createDocumentFragment();
  [...select.options].forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ds-select-option";
    button.dataset.index = String(index);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(item.selected));
    button.disabled = item.disabled;
    button.textContent = item.textContent;
    fragment.append(button);
  });
  menu.replaceChildren(fragment);
}

function selectIndex(control, index) {
  const option = control.select.options[index];
  if (!option || option.disabled) return;
  const changed = control.select.selectedIndex !== index;
  control.select.selectedIndex = index;
  syncControl(control);
  if (changed) {
    control.select.dispatchEvent(new Event("input", { bubbles: true }));
    control.select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  closeSelect(control, { restoreFocus: true });
}

function openSelect(control, { focusSelected = false } = {}) {
  if (control.select.disabled || !eligible(control.select)) return;
  if (activeControl && activeControl !== control) closeActive();
  syncControl(control);
  control.menu.hidden = false;
  control.wrapper.classList.add("is-open");
  control.trigger.setAttribute("aria-expanded", "true");
  activeControl = control;
  positionMenu(control);
  if (focusSelected) {
    requestAnimationFrame(() => {
      const enabled = [...control.menu.querySelectorAll(".ds-select-option:not(:disabled)")];
      const selected = enabled.findIndex((item) => item.getAttribute("aria-selected") === "true");
      focusOption(control, selected < 0 ? 0 : selected);
    });
  }
}

function enhanceSelect(select) {
  if (!eligible(select) || select.closest(".ds-select")) return;

  const wrapper = document.createElement("span");
  wrapper.className = "ds-select";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "ds-select-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const value = document.createElement("span");
  value.className = "ds-select-value";
  const chevron = document.createElement("span");
  chevron.className = "ds-select-chevron";
  chevron.setAttribute("aria-hidden", "true");
  trigger.append(value, chevron);

  const menu = document.createElement("div");
  menu.className = "ds-select-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  document.body.append(menu);

  select.before(wrapper);
  wrapper.append(select, trigger);
  select.classList.add("ds-select-native");
  select.tabIndex = -1;
  const control = { select, wrapper, trigger, value, menu };
  select.__unifiedSelect = control;
  trigger.setAttribute("aria-controls", `ds-select-menu-${Math.random().toString(36).slice(2)}`);
  menu.id = trigger.getAttribute("aria-controls");

  trigger.addEventListener("click", () => {
    if (menu.hidden) openSelect(control);
    else closeSelect(control);
  });
  trigger.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openSelect(control, { focusSelected: true });
    }
  });
  menu.addEventListener("click", (event) => {
    const item = event.target.closest(".ds-select-option");
    if (item) selectIndex(control, Number(item.dataset.index));
  });
  menu.addEventListener("keydown", (event) => {
    const items = [...menu.querySelectorAll(".ds-select-option:not(:disabled)")];
    const index = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(control, index + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(control, event.key === "Home" ? 0 : items.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSelect(control, { restoreFocus: true });
    } else if (event.key === "Tab") closeSelect(control);
  });
  select.addEventListener("change", () => syncControl(control));
  select.addEventListener(SELECT_SYNC_EVENT, () => syncControl(control));
  syncControl(control);
}

function destroySelect(select) {
  const control = select.__unifiedSelect;
  if (!control || select.isConnected) return;
  closeSelect(control);
  control.menu.remove();
  delete select.__unifiedSelect;
}

function cleanup(root) {
  if (root instanceof HTMLSelectElement) destroySelect(root);
  root.querySelectorAll?.("select.ds-select-native").forEach(destroySelect);
}

function scan(root) {
  if (root instanceof HTMLSelectElement) enhanceSelect(root);
  root.querySelectorAll?.("select").forEach(enhanceSelect);
}

export function refreshUnifiedSelects(root = document) {
  scan(root);
  root.querySelectorAll?.("select.ds-select-native").forEach((select) => syncControl(select.__unifiedSelect));
}

export function initUnifiedSelects() {
  if (observer) return;
  scan(document);
  observer = new MutationObserver((mutations) => {
    const controls = new Set();
    mutations.forEach((mutation) => {
      scan(mutation.target);
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) scan(node);
      });
      mutation.removedNodes.forEach((node) => {
        if (node instanceof Element) cleanup(node);
      });
      const select = mutation.target instanceof HTMLSelectElement ? mutation.target : mutation.target.closest?.("select");
      if (select?.__unifiedSelect) controls.add(select.__unifiedSelect);
    });
    controls.forEach(syncControl);
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled", "hidden", "aria-hidden"] });

  document.addEventListener("pointerdown", (event) => {
    if (activeControl && !activeControl.wrapper.contains(event.target) && !activeControl.menu.contains(event.target)) closeActive();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeControl) closeActive({ restoreFocus: true });
  });
  window.addEventListener("resize", () => positionMenu(activeControl));
  window.addEventListener("scroll", (event) => {
    if (activeControl && !activeControl.menu.contains(event.target)) closeActive();
  }, true);
  document.addEventListener("reset", (event) => requestAnimationFrame(() => refreshUnifiedSelects(event.target)));
}

export function syncUnifiedSelect(select) {
  select?.dispatchEvent(new Event(SELECT_SYNC_EVENT));
}
