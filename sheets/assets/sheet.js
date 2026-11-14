#!/usr/bin/env node
// Every command the Sheets skill runs, so a person allows this one script. It talks to one space through
// the spacesheep CLI (the one on the PATH, else npx's copy, downloaded from npm the first time), and reads
// and writes only inside the folder given with -C.
//
//   node sheet.js -C <folder> start <link> ["<title>" "<tab>" ...]  a status, the title and the named tabs on the
//                                                   space at once; its id kept in .sheet/space; data.json seeded
//                                                   with them; the format printed. A space that already holds a
//                                                   sheet: its data in data.json, and the rest of the skill printed.
//   node sheet.js -C <folder> start --new "<title>" ["<tab>" ...]  a new space instead, from the starter.
//   node sheet.js -C <folder> push ["<status>"]     the sheet in data.json and cells/*.json, on every open tab
//                                                   (the first push also prints references/build.md, and rows are
//                                                   refused until it has been printed):
//                                                   the first time, and when tabs, columns, drop-downs, ticks,
//                                                   highlights or charts change, the whole page (also saved, so
//                                                   a later visitor sees it); otherwise only the cells that
//                                                   changed, in batches of at most 500, each outlined as it lands.
//   node sheet.js -C <folder> save "<message>" ["<status>"]  the whole sheet saved as a version; the status after.
//   node sheet.js -C <folder> check [Tab!A1 ...]    the starter's own engine on the sheet: error cells, unknown
//                                                   functions, and the value of each cell named. Only reads.
//
// The agent writes only data.json (the sheet: tabs, header cells, formats, drop-downs, highlights, charts,
// plus "lede" and "description" for the page) and cells/NN-<what>.json, one batch each:
// {"tab": "Transactions", "cells": {"A2": "2026-11-03", "B2": "Stock", "C2": 300}}. This script builds the
// page from the starter; cell text goes into it as JSON with <, > and & escaped, never as HTML.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync, execSync } = require("child_process");

const STARTER = path.join(__dirname, "..", "references", "sheet-template.html");
const FORMAT = path.join(__dirname, "..", "references", "sheet-format.md"), BUILD = path.join(__dirname, "..", "references", "build.md");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 500;

function die(msg, code = 2) { console.error(`sheet.js: ${msg}`); process.exit(code); }
// Nothing passed to the CLI may be read as one of its flags.
const plain = (what, v) => { if (typeof v === "string" && v.startsWith("-")) die(`a ${what} can't start with "-"`); return v; };

// --- the page: the starter with this sheet's words and data (pure, so tests can call it) ---
const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// JSON inside <script>: no <, > or & can end the block or start a tag, whatever a cell holds.
const scriptJson = (x, space) => JSON.stringify(x, null, space).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
function sheetOnly(sheet) { const s = Object.assign({}, sheet); delete s.lede; delete s.description; return s; }
function buildPage(starter, sheet) {
  const title = sheet.title || "Sheet";
  const json = scriptJson(sheetOnly(sheet), 1);
  const swaps = [ // each a function, so no $ in a cell is read as a pattern
    [/<title>[\s\S]*?<\/title>/, () => `<title>${escText(title)}</title>`],
    [/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escText(sheet.description || title)}">`],
    [/<h1 data-ss-id="title">[\s\S]*?<\/h1>/, () => `<h1 data-ss-id="title">${escText(title)}</h1>`],
    [/<p class="lede" data-ss-id="lede">[\s\S]*?<\/p>/, () => `<p class="lede" data-ss-id="lede">${escText(sheet.lede || "")}</p>`],
    [/(<script type="application\/json" id="sheet-data">)[\s\S]*?(<\/script>)/, (m, a, b) => `${a}\n${json}\n${b}`],
  ];
  let page = starter;
  for (const [re, to] of swaps) {
    if (!re.test(page)) throw new Error(`the starter has no ${re.source.slice(0, 40)}`);
    page = page.replace(re, to);
  }
  return page;
}
// The worker file saved beside the page: the starter's engine plus its worker lines, the same text the page starts
// a worker from. Pages whose rules refuse a worker made from the page's own text (a new account's) load this file.
function workerFile(starter) {
  const part = (re, what) => { const m = re.exec(starter); if (!m) throw new Error(`the starter has no ${what}`); return m[1]; };
  return part(/<script id="sheet-engine">([\s\S]*?)<\/script>/, "engine") + "\n" + part(/<script type="text\/plain" id="sheet-worker">([\s\S]*?)<\/script>/, "worker lines");
}
// One live edit: the delta block, replaced on every open tab; the page's listener draws it.
const deltaEdit = (tab, cells) => ({ anchor: "sheet-delta", op: "replace",
  html: `<script type="application/json" id="sheet-delta" data-ss-id="sheet-delta">${scriptJson({ tab, cells, at: Date.now() })}</script>` });
// What isn't a cell: when it changes, the whole page goes again.
function frame(sheet) { const s = JSON.parse(JSON.stringify(sheet)); delete s.saved_at; (s.tabs || []).forEach((t) => delete t.cells); return JSON.stringify(s); }
// The cells that differ from what was sent, by tab, in batches of at most BATCH (null clears a cell).
function batches(sent, now) {
  const out = [];
  for (const t of now.tabs || []) {
    const was = ((sent.tabs || []).find((x) => x.name === t.name) || {}).cells || {}, is = t.cells || {}, diff = Object.create(null);
    for (const a of Object.keys(is)) if (JSON.stringify(is[a]) !== JSON.stringify(was[a])) diff[a] = is[a];
    for (const a of Object.keys(was)) if (!(a in is)) diff[a] = null;
    const keys = Object.keys(diff);
    for (let i = 0; i < keys.length; i += BATCH) out.push({ tab: t.name, cells: Object.fromEntries(keys.slice(i, i + BATCH).map((a) => [a, diff[a]])) });
  }
  return out;
}
// Fill down or across: a key like "F2:F400" (one column) or "B5:M5" (one row) holds one value for every
// cell in it. A formula is written for the first cell, and its relative references move with each cell,
// as Excel's fill does: $ fixes a column or row; whole columns (B:B), text in quotes and tab names stay put.
const colNum = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
function shiftFormula(f, dr, dc) {
  return f.replace(/("[^"]*"|'[^']*'!?)|(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(!])/g, (m, quoted, c$, col, r$, row, at, all) => {
    if (quoted) return m;
    if (/[A-Za-z0-9_.]$/.test(all.slice(0, at))) return m; // part of a longer name
    return c$ + (c$ ? col : colName(colNum(col) + dc)) + r$ + (r$ ? row : String(+row + dr));
  });
}
// Every key is checked by the page's own validator before anything is expanded: a cell, or a range whose two
// corners are cells on the sheet.
function fill(cells, where) {
  const E = eng(), out = Object.create(null), last = E.colName(E.LIMIT.cols) + E.LIMIT.rows;
  for (const [k, v] of Object.entries(cells || {})) {
    const m = /^([A-Z]{1,3}\d+):([A-Z]{1,3}\d+)$/.exec(k);
    for (const a of m ? [m[1], m[2]] : [k]) if (!E.isCell(a)) throw new Error(`${where}: ${k} is off the sheet or isn't an address: a tab runs from A1 to ${last}, and an address is written like B4`);
    if (!m) { out[k] = v; continue; }
    const p = E.parseAddr(m[1]), q = E.parseAddr(m[2]), c0 = p.c, r0 = p.r, c1 = q.c, r1 = q.r;
    if ((c0 !== c1 && r0 !== r1) || c1 < c0 || r1 < r0) throw new Error(`${where}: ${k} must be one column or one row, top to bottom or left to right`);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const f = (x) => (typeof x === "string" && x.startsWith("=") ? shiftFormula(x, r - r0, c - c0) : x);
      out[colName(c) + r] = v && typeof v === "object" ? Object.assign({}, v, { v: f(v.v) }) : f(v); // {"v": "=…", "fmt": …} fills too
    }
  }
  return out;
}
let ENGINE = null;
const eng = () => ENGINE || (ENGINE = engine());
// data.json, then each cells/*.json in name order on top.
function assemble(dir) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { throw new Error(`${path.relative(dir, f)}: ${e.code === "ENOENT" ? "missing" : "not valid JSON: " + e.message}`); } };
  const sheet = read(path.join(dir, "data.json"));
  if (!Array.isArray(sheet.tabs) || !sheet.tabs.length) throw new Error("data.json: it needs \"tabs\", at least one");
  for (const t of sheet.tabs) t.cells = fill(t.cells, `data.json, ${t.name}`);
  const cdir = path.join(dir, "cells");
  const files = fs.existsSync(cdir) ? fs.readdirSync(cdir).filter((f) => f.endsWith(".json")).sort() : [];
  for (const f of files) {
    const b = read(path.join(cdir, f));
    const tab = sheet.tabs.find((t) => t.name === b.tab);
    if (!tab) throw new Error(`cells/${f}: no tab named ${JSON.stringify(b.tab)} in data.json`);
    if (!b.cells || typeof b.cells !== "object") throw new Error(`cells/${f}: it needs "cells"`);
    const cells = fill(b.cells, `cells/${f}`);
    tab.cells = Object.assign(tab.cells || Object.create(null), cells);
    for (const a of Object.keys(cells)) if (cells[a] === null) delete tab.cells[a];
  }
  // Every cell went through fill's check; the drop-downs, ticks, highlights and charts' ranges get the page's too.
  const E = eng(), last = E.colName(E.LIMIT.cols) + E.LIMIT.rows;
  for (const t of sheet.tabs) {
    const ranges = [...(t.lists || []).map((l) => l.range), ...(t.checks || []), ...(t.rules || []).map((x) => x.range), ...(t.charts || []).flatMap((c) => [c.labels, ...(c.series || []).map((x) => x.range)])];
    for (const rg of ranges) if (rg !== undefined && !E.expand(rg).length) throw new Error(`${t.name}: the range ${rg} runs off the sheet: a tab runs from A1 to ${last}`);
  }
  return sheet;
}
// What check finds: error cells, unknown functions, and formulas that all come to zero (a whole column of 3 or
// more, or 4 or more in a row), which means the example rows never reach them: a month table that starts
// before the examples' dates, a lookup on a name spelled another way.
function checkSheet(sheet, E) {
  const book = new E.Book(sheet), names = new Set(E.NAMES);
  const fails = E.report(book).errors.map((e) => `error cell: ${e}`);
  let formulas = 0, cells = 0;
  for (const t of sheet.tabs) {
    const cols = {};
    for (const [a, c] of Object.entries(t.cells || {})) {
      cells++;
      const f = typeof c === "string" ? c : c && typeof c.v === "string" ? c.v : "";
      if (!f.startsWith("=")) continue;
      formulas++;
      for (const m of f.matchAll(/([A-Za-z][A-Za-z0-9.]*)\s*\(/g)) if (!names.has(m[1].toUpperCase().replace(/^_XLFN\./, ""))) fails.push(`unknown function ${m[1]} in ${t.name}!${a}`);
      const p = E.parseAddr(a), v = book.value(t.name, a);
      if (p && typeof v === "number") (cols[p.c] = cols[p.c] || []).push({ r: p.r, v });
    }
    for (const [c, list] of Object.entries(cols)) {
      list.sort((x, y) => x.r - y.r);
      const col = E.colName(+c), all = list.length >= 3 && list.every((x) => x.v === 0);
      // runs of zeros in next rows: the whole column (3 or more), or 4 or more in a row inside it
      const runs = all ? [list] : [];
      if (!all) for (let i = 0; i < list.length;) {
        let j = i; while (j < list.length && list[j].v === 0 && (j === i || list[j].r === list[j - 1].r + 1)) j++;
        if (j - i >= 4) runs.push(list.slice(i, j));
        i = Math.max(j, i + 1);
      }
      for (const run of runs) fails.push(`zeros: ${t.name}!${col}${run[0].r}:${col}${run[run.length - 1].r} (${run.length} formulas) all come to 0: the example rows don't reach them`);
    }
  }
  return { fails, formulas, cells, book };
}
function engine() {
  const m = /<script id="sheet-engine">([\s\S]*?)<\/script>/.exec(fs.readFileSync(STARTER, "utf8"));
  const box = { module: {}, TextEncoder, Intl, Date, Math, JSON };
  vm.runInNewContext(m[1], box);
  return box.module.exports;
}
module.exports = { buildPage, workerFile, deltaEdit, batches, frame, assemble, fill, shiftFormula, checkSheet, scriptJson, escText, engine };
if (require.main !== module) return;

// --- the commands ---
const argv = process.argv.slice(2);
if (argv[0] !== "-C" || !argv[1]) die("start with -C <folder>: node sheet.js -C <folder> <start|push|save|check>");
const DIR = path.resolve(argv[1]);
const [cmd, ...rest] = argv.slice(2);
const ST = path.join(DIR, ".sheet");
fs.mkdirSync(ST, { recursive: true });
const t0 = Date.now(), took = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;

let cli = ["npx", "-y", "spacesheep@latest"];
try { const bin = execSync("command -v spacesheep", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 }).trim(); if (bin) cli = [bin]; } catch {}
const run = (args, opts = {}) => execFileSync(cli[0], [...cli.slice(1), ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 90000, killSignal: "SIGKILL", maxBuffer: 64 << 20, ...opts });
const why = (e) => String(e.stderr || e.message).trim().split("\n").slice(-2).join(" ").slice(0, 300);
// A live push; its answer says how many tabs were open and how many edits they missed.
const live = (body) => { const out = run(["call", "push_live", "-"], { input: JSON.stringify(Object.assign({ space_id: space }, body)) }); try { return JSON.parse(out.slice(out.indexOf("{"))); } catch { return {}; } };
const seen = (a) => a.tabs_open === undefined ? "" : a.tabs_open ? `, drawn on ${a.tabs_open} open tab${a.tabs_open === 1 ? "" : "s"}${a.missed ? `, ${a.missed} missed` : ""}` : ", no tab open";
const status = (text) => { try { run(["live", "push", "--space-id", space, "--status", text]); return true; } catch (e) { console.error(`status refused: ${why(e)}`); return false; } };

let space = (fs.existsSync(path.join(ST, "space")) ? fs.readFileSync(path.join(ST, "space"), "utf8") : "").trim();
if (cmd !== "start" && cmd !== "check" && !UUID.test(space)) die(`${cmd}: no space yet; run start first, in this folder`);
const WORK = path.join(ST, "work");
const sentFile = path.join(ST, "sent.json"), pubFile = path.join(ST, "published"), rulesFile = path.join(ST, "rules-read");
// Rows come after the rules for them: the first push prints references/build.md, and until it has, a push or save
// that holds rows (a cell below a tab's header rows, or any cells/ batch) is refused and prints it instead.
function hasRows(sheet) { const E = eng(); return sheet.tabs.some((t) => Object.keys(t.cells || {}).some((a) => (E.parseAddr(a) || { r: 0 }).r > Math.max(1, t.freeze || 1))); }
function rulesFirst(sheet, verb) {
  if (fs.existsSync(rulesFile) || !hasRows(sheet)) return;
  fs.writeFileSync(rulesFile, verb);
  console.log("\n" + fs.readFileSync(BUILD, "utf8"));
  die(`${verb} refused: rows come after the rules for them, printed above. Read them, then ${verb} again`, 1);
}
function rulesAfter() { if (fs.existsSync(rulesFile)) return; fs.writeFileSync(rulesFile, "push"); console.log("\n" + fs.readFileSync(BUILD, "utf8")); }
function publish(sheet, message) {
  const s = Object.assign({}, sheet, { saved_at: sheet.saved_at || new Date().toISOString().replace(/\.\d+Z$/, "Z") });
  fs.mkdirSync(WORK, { recursive: true });
  const starter = fs.readFileSync(STARTER, "utf8");
  fs.writeFileSync(path.join(WORK, "index.html"), buildPage(starter, s));
  fs.writeFileSync(path.join(WORK, "sheet-worker.js"), workerFile(starter));
  run(["deploy", WORK, "--space", space, "-m", message]);
  fs.writeFileSync(pubFile, new Date().toISOString());
}

if (cmd === "start") {
  const fresh = rest[0] === "--new", link = fresh ? null : plain("link", rest[0]);
  const title = plain("title", rest[1]) || "", names = rest.slice(2).map((n) => plain("tab name", n));
  for (const n of names) if (!n || n.length > 31 || /[\[\]:*?\/\\]/.test(n)) die(`start: the tab name ${JSON.stringify(n)} must be 1 to 31 characters, none of [ ] : * ? / \\`);
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) die("start: two tabs have the same name");
  // The sheet as the person first sees it: its title and its named tabs, nothing in them yet.
  const seed = { title: title || "Setting up the sheet…", lede: "", tabs: (names.length ? names : ["Sheet1"]).map((n) => ({ name: n, freeze: 1, cells: {} })) };
  const seedData = () => { if (names.length && !fs.existsSync(path.join(DIR, "data.json"))) fs.writeFileSync(path.join(DIR, "data.json"), JSON.stringify({ title: title || "Sheet", tabs: names.map((n) => ({ name: n })) }, null, 1) + "\n"); };
  const say = (file) => console.log("\n" + fs.readFileSync(file, "utf8"));
  if (fresh) {
    if (space) die("start: this folder already has a space; use another folder for a new one");
    if (!title) die("start --new: give the sheet's title");
    fs.mkdirSync(WORK, { recursive: true });
    const starter = fs.readFileSync(STARTER, "utf8");
    fs.writeFileSync(path.join(WORK, "index.html"), buildPage(starter, seed));
    fs.writeFileSync(path.join(WORK, "sheet-worker.js"), workerFile(starter));
    const out = run(["deploy", WORK, "--title", title, "--emoji", "🧮", "--json"]);
    const j = JSON.parse(out.slice(out.indexOf("{")));
    space = (j.space || j).uuid || (j.space || j).id;
    if (!UUID.test(space || "")) die("start: the new space's id isn't in the answer", 1);
    fs.writeFileSync(path.join(ST, "space"), space);
    status("Setting up the sheet");
    seedData();
    console.log(`made a new space: ${(j.space || j).url || space}\nspace: ${space} (${took()})`);
    say(FORMAT);
    process.exit(0);
  }
  if (!link) die("start: give the space's link and the sheet's title and tabs, or --new \"<title>\" and the tabs");
  const id = UUID.test(link) ? link : ((run(["spaces", "get", link]).match(/^ *id: (.*)$/m) || [])[1] || "").trim();
  if (!UUID.test(id)) die(`start: no id in the answer to spaces get ${link}`, 1);
  if (space && space !== id) die(`start: this folder is for space ${space}; use another folder for ${id}`);
  space = id;
  fs.writeFileSync(path.join(ST, "space"), space);
  console.log(status("Setting up the sheet") ? `status: Setting up the sheet (${took()})` : "no status shown");
  // Read the space, so the first save is built on it; a sheet already there becomes data.json.
  try { run(["read", space, "-o", WORK]); } catch (e) { console.error(`read: ${why(e)}`); }
  const page = fs.existsSync(path.join(WORK, "index.html")) ? fs.readFileSync(path.join(WORK, "index.html"), "utf8") : "";
  const m = /<script type="application\/json" id="sheet-data">([\s\S]*?)<\/script>/.exec(page);
  // An empty space shows the title and the named tabs at once, live only (nothing is saved): the sheet is coming.
  const words = page.replace(/<(script|style)[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!m && words.length < 200) {
    try { live({ html: buildPage(fs.readFileSync(STARTER, "utf8"), seed) }); console.log(`${names.length ? "the title and " + names.length + " named tabs are" : "an empty grid is"} on screen (${took()})`); }
    catch (e) { console.error(`grid not shown: ${why(e)}`); }
  }
  if (m && !fs.existsSync(path.join(DIR, "data.json"))) {
    const sheet = JSON.parse(m[1]);
    fs.writeFileSync(path.join(DIR, "data.json"), JSON.stringify(sheet, null, 1));
    fs.writeFileSync(sentFile, JSON.stringify(sheet));
    fs.writeFileSync(pubFile, "read");
    fs.writeFileSync(rulesFile, "start");
    console.log(`the space holds a sheet: its data is in data.json\nspace: ${space} (${took()})`);
    say(BUILD); say(FORMAT);
    process.exit(0);
  }
  seedData();
  console.log(`the space holds no sheet yet: data.json has the title and tabs; add the headers, then push\nspace: ${space} (${took()})`);
  say(FORMAT);
  process.exit(0);
}

// The sheet on every open tab: the whole page when its frame changed (the first push is also saved, so a
// later visitor sees it), else only the changed cells, in batches. The status goes with the push.
function pushSheet(sheet, say) {
  const sent = fs.existsSync(sentFile) ? JSON.parse(fs.readFileSync(sentFile, "utf8")) : null;
  if (!sent || frame(sent) !== frame(sheet)) {
    const page = buildPage(fs.readFileSync(STARTER, "utf8"), sheet);
    // A page and a status can't go in one call (the API takes one or the other); a batch and a status can.
    try { const a = live({ html: page }); console.log(`pushed the whole page (${page.length} bytes${seen(a)}, ${took()})`); }
    catch (e) { console.error(`page push refused: ${why(e)}. Nothing is marked sent: push again`); return false; }
    fs.writeFileSync(sentFile, JSON.stringify(sheet));
    if (say) status(say);
    return firstSave(sheet, say);
  }
  const bs = batches(sent, sheet);
  if (!bs.length) { if (say) status(say); console.log("no cell changed since the last push"); return firstSave(sheet, say); }
  let done = 0, last = {};
  for (const [i, b] of bs.entries()) {
    const line = bs.length > 1 ? `${say || "Writing cells"} (${i + 1} of ${bs.length})` : say;
    try { last = live(Object.assign({ edits: [deltaEdit(b.tab, b.cells)] }, line ? { status: line.slice(0, 200) } : {})); done += Object.keys(b.cells).length; }
    catch (e) { console.error(`batch ${i + 1} refused: ${why(e)}`); return false; }
    const was = JSON.parse(fs.readFileSync(sentFile, "utf8")), t = was.tabs.find((x) => x.name === b.tab);
    t.cells = Object.assign(t.cells || {}, b.cells); for (const a of Object.keys(b.cells)) if (b.cells[a] === null) delete t.cells[a];
    fs.writeFileSync(sentFile, JSON.stringify(was));
  }
  console.log(`pushed ${done} cell${done === 1 ? "" : "s"} in ${bs.length} batch${bs.length === 1 ? "" : "es"}${seen(last)} (${took()})`);
  return firstSave(sheet, say);
}
// What's pushed (sent.json) and whether it's saved (published) are kept apart. Until the sheet has been saved once,
// every push tries the save again, so a later visitor sees it, and fails while it can't.
function firstSave(sheet, say) {
  if (fs.existsSync(pubFile)) return true;
  try { publish(sheet, say || "The sheet's tabs and headers"); console.log(`saved it, so a later visitor sees it too (${took()})`); return true; }
  catch (e) { console.error(`save refused: ${why(e)}. Open tabs have it, but it isn't saved yet: push again`); return false; }
}

if (cmd === "push") {
  const say = plain("status", rest[0]) || "";
  let sheet;
  try { sheet = assemble(DIR); } catch (e) { die(`push: ${e.message}`, 1); }
  rulesFirst(sheet, "push");
  if (!pushSheet(sheet, say)) process.exit(1);
  rulesAfter();
  process.exit(0);
}

if (cmd === "save") {
  const message = plain("message", rest[0]);
  if (!message) die("save: give a message: what this version is");
  const say = plain("status", rest[1]);
  let sheet;
  try { sheet = assemble(DIR); } catch (e) { die(`save: ${e.message}`, 1); }
  rulesFirst(sheet, "save");
  try { publish(sheet, message); } catch (e) { die(`save refused: ${why(e)}`, 1); }
  console.log(`saved: ${message} (${took()})`);
  // Open tabs get what changed since the last push: highlights, charts, last cells. If that fails, the version
  // is saved but people watching don't see it yet: say so, and fail, so push is run again.
  if (!pushSheet(sheet, say)) die("saved, but open tabs didn't get the last changes: run push", 1);
  process.exit(0);
}

if (cmd === "check") {
  let sheet;
  try { sheet = assemble(DIR); } catch (e) { die(`check: ${e.message}`, 1); }
  const E = engine(), { fails, formulas, cells, book } = checkSheet(sheet, E);
  for (const want of rest) {
    const bang = want.lastIndexOf("!"), tab = bang < 0 ? sheet.tabs[0].name : want.slice(0, bang).replace(/^'|'$/g, ""), a = want.slice(bang + 1).toUpperCase();
    const t = sheet.tabs.find((x) => x.name.toLowerCase() === tab.toLowerCase());
    const v = book.value(tab, a);
    console.log(`${tab}!${a} = ${E.fmtValue(v, E.cellFmt(t || {}, a, (book.raw[tab.toLowerCase()] || {})[a], book.input(tab, a)), sheet)}`);
  }
  console.log(`${sheet.tabs.length} tabs, ${cells} cells, ${formulas} formulas`);
  console.log(fails.length ? fails.slice(0, 40).join("\n") : "all pass: no error cells, every function known, no all-zero column");
  process.exit(fails.length ? 1 : 0);
}

die(`unknown command ${cmd || "(none)"}: start, push, save or check`);
