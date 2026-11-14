#!/usr/bin/env node
// Every command the Sheets skill runs, so a person allows this one script. It talks to one space through
// the spacesheep CLI (the one on the PATH, else npx's copy, downloaded from npm the first time), and reads
// and writes only inside the folder given with -C.
//
//   node sheet.js -C <folder> start <link>          a status on the space at once; its id kept in .sheet/space.
//                                                   A space that already holds a sheet: its data in data.json.
//   node sheet.js -C <folder> start --new "<title>" a new space instead, from the starter.
//   node sheet.js -C <folder> push ["<status>"]     the sheet in data.json and cells/*.json, on every open tab:
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
// One live edit: the delta block, replaced on every open tab; the page's listener draws it.
const deltaEdit = (tab, cells) => ({ anchor: "sheet-delta", op: "replace",
  html: `<script type="application/json" id="sheet-delta" data-ss-id="sheet-delta">${scriptJson({ tab, cells, at: Date.now() })}</script>` });
// What isn't a cell: when it changes, the whole page goes again.
function frame(sheet) { const s = JSON.parse(JSON.stringify(sheet)); delete s.saved_at; (s.tabs || []).forEach((t) => delete t.cells); return JSON.stringify(s); }
// The cells that differ from what was sent, by tab, in batches of at most BATCH (null clears a cell).
function batches(sent, now) {
  const out = [];
  for (const t of now.tabs || []) {
    const was = ((sent.tabs || []).find((x) => x.name === t.name) || {}).cells || {}, is = t.cells || {}, diff = {};
    for (const a of Object.keys(is)) if (JSON.stringify(is[a]) !== JSON.stringify(was[a])) diff[a] = is[a];
    for (const a of Object.keys(was)) if (!(a in is)) diff[a] = null;
    const keys = Object.keys(diff);
    for (let i = 0; i < keys.length; i += BATCH) out.push({ tab: t.name, cells: Object.fromEntries(keys.slice(i, i + BATCH).map((a) => [a, diff[a]])) });
  }
  return out;
}
// data.json, then each cells/*.json in name order on top.
function assemble(dir) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { throw new Error(`${path.relative(dir, f)}: ${e.code === "ENOENT" ? "missing" : "not valid JSON: " + e.message}`); } };
  const sheet = read(path.join(dir, "data.json"));
  if (!Array.isArray(sheet.tabs) || !sheet.tabs.length) throw new Error("data.json: it needs \"tabs\", at least one");
  const cdir = path.join(dir, "cells");
  const files = fs.existsSync(cdir) ? fs.readdirSync(cdir).filter((f) => f.endsWith(".json")).sort() : [];
  for (const f of files) {
    const b = read(path.join(cdir, f));
    const tab = sheet.tabs.find((t) => t.name === b.tab);
    if (!tab) throw new Error(`cells/${f}: no tab named ${JSON.stringify(b.tab)} in data.json`);
    if (!b.cells || typeof b.cells !== "object") throw new Error(`cells/${f}: it needs "cells"`);
    tab.cells = Object.assign(tab.cells || {}, b.cells);
    for (const a of Object.keys(b.cells)) if (b.cells[a] === null) delete tab.cells[a];
  }
  return sheet;
}
function engine() {
  const m = /<script id="sheet-engine">([\s\S]*?)<\/script>/.exec(fs.readFileSync(STARTER, "utf8"));
  const box = { module: {}, TextEncoder, Intl, Date, Math, JSON };
  vm.runInNewContext(m[1], box);
  return box.module.exports;
}
module.exports = { buildPage, deltaEdit, batches, frame, assemble, scriptJson, escText, engine };
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
const sentFile = path.join(ST, "sent.json");
function publish(sheet, message) {
  const s = Object.assign({}, sheet, { saved_at: sheet.saved_at || new Date().toISOString().replace(/\.\d+Z$/, "Z") });
  fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(path.join(WORK, "index.html"), buildPage(fs.readFileSync(STARTER, "utf8"), s));
  run(["deploy", WORK, "--space", space, "-m", message]);
}

if (cmd === "start") {
  if (rest[0] === "--new") {
    if (space) die("start: this folder already has a space; use another folder for a new one");
    const sheet = { title: plain("title", rest[1]) || "Sheet", tabs: [{ name: "Sheet1", freeze: 1, cells: {} }] };
    fs.mkdirSync(WORK, { recursive: true });
    fs.writeFileSync(path.join(WORK, "index.html"), buildPage(fs.readFileSync(STARTER, "utf8"), sheet));
    const out = run(["deploy", WORK, "--title", sheet.title, "--emoji", "🧮", "--json"]);
    const j = JSON.parse(out.slice(out.indexOf("{")));
    space = (j.space || j).uuid || (j.space || j).id;
    if (!UUID.test(space || "")) die("start: the new space's id isn't in the answer", 1);
    fs.writeFileSync(path.join(ST, "space"), space);
    status("Setting up the sheet");
    console.log(`made a new space: ${(j.space || j).url || space}\nspace: ${space} (${took()})`);
    process.exit(0);
  }
  const link = plain("link", rest[0]);
  if (!link) die("start: give the space's link, or --new \"<title>\"");
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
  if (m && !fs.existsSync(path.join(DIR, "data.json"))) {
    const sheet = JSON.parse(m[1]);
    fs.writeFileSync(path.join(DIR, "data.json"), JSON.stringify(sheet, null, 1));
    fs.writeFileSync(sentFile, JSON.stringify(sheet));
    console.log("the space holds a sheet: its data is in data.json");
  } else console.log("the space holds no sheet yet: write data.json, then push");
  console.log(`space: ${space} (${took()})`);
  process.exit(0);
}

if (cmd === "push") {
  const say = plain("status", rest[0]) || "";
  let sheet;
  try { sheet = assemble(DIR); } catch (e) { die(`push: ${e.message}`, 1); }
  const sent = fs.existsSync(sentFile) ? JSON.parse(fs.readFileSync(sentFile, "utf8")) : null;
  if (!sent || frame(sent) !== frame(sheet)) {
    const page = buildPage(fs.readFileSync(STARTER, "utf8"), sheet);
    try { const a = live({ html: page }); console.log(`pushed the whole page (${page.length} bytes${seen(a)}, ${took()})`); }
    catch (e) { console.error(`page push refused: ${why(e)}`); }
    if (say) status(say);
    try { publish(sheet, say || "The sheet's tabs and headers"); console.log(`saved it, so a later visitor sees it too (${took()})`); }
    catch (e) { console.error(`save refused: ${why(e)}`); }
    fs.writeFileSync(sentFile, JSON.stringify(sheet));
    process.exit(0);
  }
  const bs = batches(sent, sheet);
  if (!bs.length) { if (say) status(say); console.log("no cell changed since the last push"); process.exit(0); }
  let done = 0, last = {};
  for (const [i, b] of bs.entries()) {
    const line = bs.length > 1 ? `${say || "Writing cells"} (${i + 1} of ${bs.length})` : say;
    try { last = live(Object.assign({ edits: [deltaEdit(b.tab, b.cells)] }, line ? { status: line.slice(0, 200) } : {})); done += Object.keys(b.cells).length; }
    catch (e) { console.error(`batch ${i + 1} refused: ${why(e)}`); process.exit(1); }
    const was = JSON.parse(fs.readFileSync(sentFile, "utf8")), t = was.tabs.find((x) => x.name === b.tab);
    t.cells = Object.assign(t.cells || {}, b.cells); for (const a of Object.keys(b.cells)) if (b.cells[a] === null) delete t.cells[a];
    fs.writeFileSync(sentFile, JSON.stringify(was));
  }
  console.log(`pushed ${done} cell${done === 1 ? "" : "s"} in ${bs.length} batch${bs.length === 1 ? "" : "es"}${seen(last)} (${took()})`);
  process.exit(0);
}

if (cmd === "save") {
  const message = plain("message", rest[0]);
  if (!message) die("save: give a message: what this version is");
  let sheet;
  try { sheet = assemble(DIR); } catch (e) { die(`save: ${e.message}`, 1); }
  try { publish(sheet, message); } catch (e) { die(`save refused: ${why(e)}`, 1); }
  fs.writeFileSync(sentFile, JSON.stringify(sheet));
  const say = plain("status", rest[1]);
  if (say) status(say);
  console.log(`saved: ${message} (${took()})`);
  process.exit(0);
}

if (cmd === "check") {
  let sheet;
  try { sheet = assemble(DIR); } catch (e) { die(`check: ${e.message}`, 1); }
  const E = engine(), book = new E.Book(sheet), names = new Set(E.NAMES);
  const fails = E.report(book).errors.map((e) => `error cell: ${e}`);
  let formulas = 0, cells = 0;
  for (const t of sheet.tabs) for (const [a, c] of Object.entries(t.cells || {})) {
    cells++;
    const f = typeof c === "string" ? c : c && typeof c.v === "string" ? c.v : "";
    if (!f.startsWith("=")) continue;
    formulas++;
    for (const m of f.matchAll(/([A-Za-z][A-Za-z0-9.]*)\s*\(/g)) if (!names.has(m[1].toUpperCase().replace(/^_XLFN\./, ""))) fails.push(`unknown function ${m[1]} in ${t.name}!${a}`);
  }
  for (const want of rest) {
    const bang = want.lastIndexOf("!"), tab = bang < 0 ? sheet.tabs[0].name : want.slice(0, bang).replace(/^'|'$/g, ""), a = want.slice(bang + 1).toUpperCase();
    const t = sheet.tabs.find((x) => x.name.toLowerCase() === tab.toLowerCase());
    const v = book.value(tab, a);
    console.log(`${tab}!${a} = ${E.fmtValue(v, E.cellFmt(t || {}, a, (book.raw[tab.toLowerCase()] || {})[a]), sheet)}`);
  }
  console.log(`${sheet.tabs.length} tabs, ${cells} cells, ${formulas} formulas`);
  console.log(fails.length ? fails.slice(0, 40).join("\n") : "all pass: no error cells, every function known");
  process.exit(fails.length ? 1 : 0);
}

die(`unknown command ${cmd || "(none)"}: start, push, save or check`);
