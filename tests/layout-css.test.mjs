import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../css/styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../js/script.js", import.meta.url), "utf8");

function blockFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `CSS block not found for ${selector}`);
  return match[1];
}

assert.match(blockFor(".show-area"), /min-width:\s*0\s*;/, "show area must shrink inside the stage grid");
assert.match(blockFor(".invite-box"), /min-width:\s*0\s*;/, "invite bar must not force horizontal overflow");
assert.match(blockFor(".invite-box"), /justify-self:\s*center\s*;/, "invite bar must stay centered in the stage area");
assert.match(blockFor(".invite-box"), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s*;/, "invite bar must reserve a visible QR column");
assert.match(blockFor(".participant-admin-box,\n.professor-box,\n.log-box"), /min-width:\s*0\s*;/, "bottom cards must be allowed to shrink");
assert.match(blockFor("#inviteText"), /min-width:\s*0\s*;/, "invite text must wrap before pushing QR off screen");
assert.match(css, /@media\s*\(max-width:\s*1280px\)[\s\S]*?\.stage-layout\s*\{[\s\S]*?minmax\(260px,\s*320px\)\s+minmax\(0,\s*1fr\)/, "stage layout must compact before notebook widths");
assert.match(css, /@media\s*\(max-width:\s*1280px\)[\s\S]*?\.bottom-panels\.has-admin\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, "admin bottom panels must stop using three fixed columns on notebook widths");
assert.match(css, /@media\s*\(max-width:\s*1280px\)[\s\S]*?\.bottom-panels\.has-admin\s+\.log-box\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1\s*;/, "chat panel must move to a full row on notebook widths");
assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.stage-layout,[\s\S]*?\.bottom-panels,[\s\S]*?\.bottom-panels\.has-admin,[\s\S]*?\.rooms-top\s*\{[\s\S]*?grid-template-columns:\s*1fr\s*;/, "stage and bottom panels must stack at tablet widths");
assert.match(css, /@media\s*\(max-width:\s*1440px\)[\s\S]*?\.stage-toolbar\s*\{[\s\S]*?justify-content:\s*center\s*;[\s\S]*?flex-wrap:\s*wrap\s*;/, "stage toolbar must keep the leave button visible on smaller monitors");
assert.match(html, /class="[^"]*stage-main[^"]*"/, "stage screen must have a named central stage area");
assert.match(html, /class="[^"]*room-side-panel[^"]*"/, "stage screen must have a named side panel for participants and guests");
assert.match(css, /\.stage-layout\.is-owner-view\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"side main"[\s\S]*?"side controls"/, "owner layout must match the drawn side-main-controls structure");
assert.match(css, /\.stage-layout\.is-audience-view\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"main side"[\s\S]*?"controls side"/, "audience layout must keep stage first and side info secondary");
assert.match(css, /\.stage-layout\.is-audience-view\s+\.participant-admin-box\s*\{[\s\S]*?display:\s*none\s*!important\s*;/, "audience layout must not show participant registration");
assert.match(js, /classList\.toggle\("is-owner-view",\s*ownerControlsActive\)/, "stage layout must switch to owner view for the room owner");
assert.match(js, /classList\.toggle\("is-audience-view",\s*!ownerControlsActive\)/, "stage layout must switch to audience view for jurors and guests");
