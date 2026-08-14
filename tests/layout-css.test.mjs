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
assert.match(blockFor(".stage-layout"), /grid-template-columns:\s*minmax\(240px,\s*300px\)\s+minmax\(0,\s*1fr\)\s+minmax\(330px,\s*420px\)/, "desktop room must use balanced side, stage, and juror columns");
assert.match(blockFor(".stage-layout"), /"side main judges"/, "desktop room grid must follow the reference layout");
assert.match(blockFor(".stage-toolbar"), /grid-template-columns:\s*minmax\(132px,\s*auto\)\s+minmax\(140px,\s*1fr\)\s+minmax\(84px,\s*auto\)/, "stage toolbar must reserve left exit, centered logo, and right QR slots");
assert.match(blockFor(".stage-toolbar"), /width:\s*min\(100%,\s*760px\)/, "stage toolbar controls must stay close to the stage instead of screen edges");
assert.match(blockFor(".stage-center-logo"), /width:\s*clamp\(170px,\s*16vw,\s*260px\)/, "central stage logo must be larger");
assert.match(blockFor(".leave-room-button"), /align-self:\s*end\s*;/, "leave room button must sit near the stage instead of floating high");
assert.match(blockFor(".stage-qr-slot"), /align-self:\s*end\s*;/, "QR code must sit near the stage instead of floating high");
assert.match(blockFor(".stage-qr-slot canvas"), /width:\s*clamp\(74px,\s*8vw,\s*112px\)/, "QR code must shrink on smaller screens without leaving the toolbar");
assert.match(blockFor(".stage-content-grid"), /grid-template-columns:\s*minmax\(420px,\s*1fr\)\s+minmax\(260px,\s*310px\)/, "stage and chat must sit side by side like the reference");
assert.match(blockFor(".photo-board"), /min-height:\s*clamp\(430px,\s*52vh,\s*560px\)/, "stage board must fit beside the chat column");
assert.match(blockFor(".ranking-panel"), /height:\s*calc\(100vh\s*-\s*32px\)/, "side panel must use nearly the full stage viewport height");
assert.match(blockFor(".ranking-panel"), /min-height:\s*760px\s*;/, "side panel must stay tall enough to keep chat usable");
assert.match(css, /\.side-chat-box,\s*\.stage-chat-box\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto\s*;/, "chat messages must scroll without stretching the input row");
assert.match(css, /\.side-chat-box\s+\.score-list,\s*\.stage-chat-box\s+\.score-list\s*\{[\s\S]*?max-height:\s*none\s*;/, "stage chat must not inherit the compact bottom-card message height");
assert.match(css, /\.side-chat-box\s+\.chat-form,\s*\.stage-chat-box\s+\.chat-form\s*\{[\s\S]*?grid-row:\s*2\s*;[\s\S]*?flex-shrink:\s*0\s*;/, "chat form must remain a normal-height bottom row");
assert.match(blockFor(".stage-judge-panel"), /grid-area:\s*judges\s*;/, "juror panel must occupy the right column");
assert.match(blockFor(".stage-judge-panel .criteria-panel"), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, "juror criteria must use a compact two-column desktop layout");
assert.match(css, /@media\s*\(max-width:\s*1280px\)[\s\S]*?\.stage-layout\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"side main"[\s\S]*?"side judges"/, "stage layout must compact to two columns before notebook widths");
assert.match(css, /@media\s*\(max-width:\s*900px\)[\s\S]*?\.stage-layout,[\s\S]*?\.rooms-top\s*\{[\s\S]*?grid-template-columns:\s*1fr\s*;/, "stage and room panels must stack at tablet widths");
assert.match(css, /@media\s*\(max-width:\s*1440px\)[\s\S]*?\.stage-toolbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(126px,\s*auto\)\s+minmax\(120px,\s*1fr\)\s+minmax\(74px,\s*auto\)/, "stage toolbar must keep leave, logo, and QR visible on smaller monitors");
assert.match(css, /body\[data-screen="stage"\]\s+\.game-header\s*\{[\s\S]*?display:\s*none\s*;/, "stage screen must not show a second header logo");
assert.match(html, /class="[^"]*stage-main[^"]*"/, "stage screen must have a named central stage area");
assert.match(html, /class="[^"]*room-side-panel[^"]*"/, "stage screen must have a named side panel for participants and guests");
assert.match(html, /stage-content-grid[\s\S]*?photo-board[\s\S]*?stage-chat-box[\s\S]*?id="chatForm"/, "center stage must show the performer beside the chat");
assert.match(html, /room-side-panel[\s\S]*?id="queueList"[\s\S]*?id="guestList"/, "side panel must show participants and guests");
assert.doesNotMatch(html, /room-side-panel[\s\S]*?id="chatForm"[\s\S]*?<\/aside>/, "chat must not stay inside the side panel");
assert.doesNotMatch(html, /room-side-panel[\s\S]*?id="currentCode"[\s\S]*?id="queueList"/, "room code must not appear above the participant list");
assert.match(html, /stage-toolbar[\s\S]*?id="leaveRoom"[\s\S]*?stage-center-logo[\s\S]*?id="qrCanvas"/, "stage toolbar must place exit, logo, and QR in the requested order");
assert.match(html, /id="stageTitle">PALCO</, "stage badge must be named PALCO");
assert.match(html, /ownerCodeBox[\s\S]*?id="currentCode"[\s\S]*?id="copyCode"/, "room code must live inside the juror/control block for the owner");
assert.doesNotMatch(html, /id="inviteBox"/, "old invite bar must be removed from the stage markup");
assert.match(css, /\.stage-layout\.is-owner-view\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"side main judges"/, "owner layout must match the reference structure");
assert.match(css, /\.stage-layout\.is-audience-view\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"side main judges"/, "audience layout must keep the same reference structure");
assert.match(css, /\.stage-layout\.is-audience-view\s+\.participant-admin-box\s*\{[\s\S]*?display:\s*none\s*!important\s*;/, "audience layout must not show participant registration");
assert.match(js, /classList\.toggle\("is-owner-view",\s*ownerControlsActive\)/, "stage layout must switch to owner view for the room owner");
assert.match(js, /classList\.toggle\("is-audience-view",\s*!ownerControlsActive\)/, "stage layout must switch to audience view for jurors and guests");
assert.match(js, /classList\.toggle\("has-admin",\s*ownerControlsActive\)/, "stage layout must expose owner registration state");
assert.match(js, /\$\("#nextStudent"\)\.style\.display\s*=\s*isJudge\s*\?\s*"inline-block"\s*:\s*"none"/, "next button must only be visible for jurors");
assert.doesNotMatch(js, /if\s*\(isRoomOwner\(room\)\)\s*\{[\s\S]*?advanceRoom\(room\)/, "room owner must not advance participants through the next button");
