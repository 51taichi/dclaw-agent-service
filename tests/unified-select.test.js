import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(new URL("../public/components/select.js", import.meta.url), "utf8");
const componentStyles = readFileSync(new URL("../public/components/select.css", import.meta.url), "utf8");
const adminHtml = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
const adminApp = readFileSync(new URL("../public/admin/app.js", import.meta.url), "utf8");
const consoleHtml = readFileSync(new URL("../public/console/index.html", import.meta.url), "utf8");
const consoleApp = readFileSync(new URL("../public/console/app.js", import.meta.url), "utf8");
const consoleStyles = readFileSync(new URL("../public/console/styles.css", import.meta.url), "utf8");
const consoleAgentStyles = readFileSync(new URL("../public/console/agent.css", import.meta.url), "utf8");

test("admin and console share one dropdown implementation", () => {
  assert.match(adminHtml, /components\/select\.css/);
  assert.match(consoleHtml, /components\/select\.css/);
  assert.match(adminApp, /initUnifiedSelects\(\)/);
  assert.match(consoleApp, /initUnifiedSelects\(\)/);
  assert.match(component, /new MutationObserver/);
  assert.match(component, /dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(component, /\["ArrowDown", "ArrowUp", "Enter", " "\]/);
  assert.match(component, /event\.key === "Escape"/);
});

test("shared dropdown matches the reference trigger and option sheet", () => {
  assert.match(componentStyles, /\.ds-select\.is-open \.ds-select-trigger\s*\{[^}]*border-color:\s*var\(--select-accent\)/);
  assert.match(componentStyles, /\.ds-select-chevron\s*\{[^}]*border-right:\s*2px solid var\(--select-accent\)/);
  assert.match(componentStyles, /\.ds-select-menu\s*\{[^}]*background:\s*#fff;[^}]*box-shadow:/);
  assert.match(componentStyles, /\.ds-select-option\[aria-selected="true"\]/);
});

test("console multi-select uses the same focus, menu and checkbox language", () => {
  assert.match(consoleStyles, /\.tag-multi-select-button\[aria-expanded="true"\]\s*\{[^}]*border:\s*1px solid var\(--accent\)/);
  assert.match(consoleStyles, /\.tag-multi-select-button\[aria-expanded="true"\]::after/);
  assert.match(consoleStyles, /\.tag-multi-select-option input\[type="checkbox"\]\s*\{[^}]*appearance:\s*none/);
  assert.match(consoleStyles, /\.tag-multi-select-menu,\s*\.flow-session-tag-menu,\s*\.cockpit-reply-timeout-menu/);
  assert.match(consoleAgentStyles, /\.session-filter-grid \.tag-multi-select\s*\{\s*overflow:\s*visible/);
  assert.match(consoleAgentStyles, /\.session-filter-grid \.tag-multi-select-menu\s*\{[^}]*width:\s*max\(260px, 100%\)/);
});
