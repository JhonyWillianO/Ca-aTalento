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
assert.match(blockFor(".participant-admin-box,\n.professor-box,\n.log-box"), /min-width:\s*0\s*;/, "bottom cards must be allowed to shrink");
assert.match(blockFor(".stage-toolbar"), /grid-template-columns:\s*minmax\(132px,\s*auto\)\s+minmax\(140px,\s*1fr\)\s+minmax\(84px,\s*auto\)/, "stage toolbar must reserve left exit, centered logo, and right QR slots");
assert.match(blockFor(".stage-qr-slot canvas"), /width:\s*clamp\(74px,\s*8vw,\s*112px\)/, "QR code must shrink on smaller screens without leaving the toolbar");
assert.match(blockFor(".photo-board"), /min-height:\s*clamp\(520px,\s*58vh,\s*720px\)/, "stage area must be larger than the old compact board");
assert.match(blockFor(".side-chat-box"), /flex:\s*1\s*;/, "chat must live under participants and guests in the side panel");
assert.match(css, /@media\s*\(max-width:\s*1280px\)[\s\S]*?\.stage-layout\s*\{[\s\S]*?minmax\(240px,\s*300px\)\s+minmax\(0,\s*1fr\)/, "stage layout must compact before notebook widths");
assert.match(css, /@media\s*\(max-width:\s*1280px\)[\s\S]*?\.bottom-panels\.has-admin\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/, "owner bottom panels must stack before notebook widths");
assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.stage-layout,[\s\S]*?\.bottom-panels,[\s\S]*?\.bottom-panels\.has-admin,[\s\S]*?\.rooms-top\s*\{[\s\S]*?grid-template-columns:\s*1fr\s*;/, "stage and bottom panels must stack at tablet widths");
assert.match(css, /@media\s*\(max-width:\s*1440px\)[\s\S]*?\.stage-toolbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(126px,\s*auto\)\s+minmax\(120px,\s*1fr\)\s+minmax\(74px,\s*auto\)/, "stage toolbar must keep leave, logo, and QR visible on smaller monitors");
assert.match(html, /class="[^"]*stage-main[^"]*"/, "stage screen must have a named central stage area");
assert.match(html, /class="[^"]*room-side-panel[^"]*"/, "stage screen must have a named side panel for participants and guests");
assert.match(html, /room-side-panel[\s\S]*?id="queueList"[\s\S]*?id="guestList"[\s\S]*?side-chat-box[\s\S]*?id="chatForm"/, "side panel must show participants, guests, then chat");
assert.doesNotMatch(html, /room-side-panel[\s\S]*?id="currentCode"[\s\S]*?id="queueList"/, "room code must not appear above the participant list");
assert.match(html, /stage-toolbar[\s\S]*?id="leaveRoom"[\s\S]*?stage-center-logo[\s\S]*?id="qrCanvas"/, "stage toolbar must place exit, logo, and QR in the requested order");
assert.match(html, /id="stageTitle">PALCO</, "stage badge must be named PALCO");
assert.match(html, /ownerCodeBox[\s\S]*?id="currentCode"[\s\S]*?id="copyCode"/, "room code must live inside the juror/control block for the owner");
assert.doesNotMatch(html, /id="inviteBox"/, "old invite bar must be removed from the stage markup");
assert.match(css, /\.stage-layout\.is-owner-view\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"side main"[\s\S]*?"side controls"/, "owner layout must match the drawn side-main-controls structure");
assert.match(css, /\.stage-layout\.is-audience-view\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"side main"[\s\S]*?"side controls"/, "audience layout must keep the side panel in the same drawn position");
assert.match(css, /\.stage-layout\.is-audience-view\s+\.participant-admin-box\s*\{[\s\S]*?display:\s*none\s*!important\s*;/, "audience layout must not show participant registration");
assert.match(js, /classList\.toggle\("is-owner-view",\s*ownerControlsActive\)/, "stage layout must switch to owner view for the room owner");
assert.match(js, /classList\.toggle\("is-audience-view",\s*!ownerControlsActive\)/, "stage layout must switch to audience view for jurors and guests");
assert.match(js, /\$\("#nextStudent"\)\.style\.display\s*=\s*isJudge\s*\?\s*"inline-block"\s*:\s*"none"/, "next button must only be visible for jurors");
assert.doesNotMatch(js, /if\s*\(isRoomOwner\(room\)\)\s*\{[\s\S]*?advanceRoom\(room\)/, "room owner must not advance participants through the next button");
