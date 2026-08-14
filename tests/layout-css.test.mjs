import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../css/styles.css", import.meta.url), "utf8");

function blockFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `CSS block not found for ${selector}`);
  return match[1];
}

assert.match(blockFor(".show-area"), /min-width:\s*0\s*;/, "show area must shrink inside the stage grid");
assert.match(blockFor(".invite-box"), /min-width:\s*0\s*;/, "invite bar must not force horizontal overflow");
assert.match(blockFor("#inviteText"), /min-width:\s*0\s*;/, "invite text must wrap before pushing QR off screen");
assert.match(css, /@media\s*\(max-width:\s*1280px\)[\s\S]*?\.stage-layout\s*\{[\s\S]*?minmax\(260px,\s*320px\)\s+minmax\(0,\s*1fr\)/, "stage layout must compact before notebook widths");
assert.match(css, /@media\s*\(max-width:\s*1440px\)[\s\S]*?\.stage-toolbar\s*\{[\s\S]*?justify-content:\s*center\s*;[\s\S]*?flex-wrap:\s*wrap\s*;/, "stage toolbar must keep the leave button visible on smaller monitors");
