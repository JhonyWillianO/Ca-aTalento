import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../js/script.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/styles.css", import.meta.url), "utf8");

assert.match(html, /data-toggle-room-code/, "room code visibility button must exist in the page");
assert.match(js, /showRoomCode:\s*false/, "room code must start hidden for the owner");
assert.match(js, /function visibleRoomCode\(code\)[\s\S]*?"\*\*\*\*\*\*"/, "hidden room code must render as a password-style mask");
assert.match(js, /data-toggle-room-code[\s\S]*?app\.showRoomCode\s*=\s*!app\.showRoomCode/, "eye button must toggle room code visibility");
assert.match(css, /\.code-actions\s*\{[\s\S]*?display:\s*flex/, "room code buttons must stay grouped");
assert.match(css, /\.owner-code-box\.is-active\s*\{[\s\S]*?display:\s*grid/, "owner code box must only appear when enabled");
assert.match(html, /ownerCodeBox[\s\S]*?data-toggle-room-code/, "room code visibility control must live in the owner juror block");
