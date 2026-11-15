#!/usr/bin/env node
// The repo's own tests (they never enter a version): node tests/run.js
// Node only, nothing to install. They run the starter's own engine, out of
// sheets/references/sheet-template.html, so they test the page people get.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const PAGE = fs.readFileSync(path.join(ROOT, "sheets/references/sheet-template.html"), "utf8");

function script(id) {
  const m = new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`).exec(PAGE);
  if (!m) throw new Error(`no <script id="${id}"> in the starter`);
  return m[1];
}
const ctx = vm.createContext({ module: {}, TextEncoder, Intl, Date, Math, JSON });
vm.runInContext(script("sheet-engine"), ctx);
const E = ctx.module.exports;
// Runs fn and stops it after ms: a test of something that used to hang fails instead of hanging the run.
function within(ms, fn) { ctx.__fn = fn; try { return vm.runInContext("__fn()", ctx, { timeout: ms }); } finally { delete ctx.__fn; } }

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e.message).split("\n").join("\n     ")}`); }
}

// A small book: an input tab with a space in its name, a log, and a summary over both.
function book() {
  return new E.Book({
    currency: "GBP", locale: "en-GB",
    tabs: [
      { name: "Q1 plan", cells: { A1: "Item", B1: "Cost", A2: "Rent", B2: 1200, A3: "Stock", B3: 800.5, A4: "Fees", B4: 0 } },
      { name: "Log", cells: {
        A1: "Date", B1: "Category", C1: "Amount", D1: "Done",
        A2: "2026-11-03", B2: "Stock", C2: 300, D2: true,
        A3: "2026-11-20", B3: "Rent", C3: 1200, D3: false,
        A4: "2026-12-01", B4: "Stock", C4: 50, D4: true } },
      { name: "Summary", cells: {
        A1: "2026-11-01",
        B1: "=SUM('Q1 plan'!B2:B4)",
        B2: "=SUMIFS(Log!C:C,Log!B:B,\"Stock\",Log!A:A,\">=\"&A1,Log!A:A,\"<\"&EDATE(A1,1))",
        B3: "=COUNTIFS(Log!B2:B200,\"<>Rent\")",
        B4: "=IF('Q1 plan'!B2>1000,\"over\",\"ok\")",
        B5: "=VLOOKUP(\"Stock\",'Q1 plan'!A2:B4,2,FALSE)",
        B6: "=EOMONTH(A1,0)",
        B7: "=ROUND(B1/3,2)",
        B8: "=SUMPRODUCT((Log!B2:B4=\"Stock\")*(Log!D2:D4=TRUE))",
        B9: "=B9+1",
        B10: "=C10", C10: "=B10",
        B11: "=MEDIANX(B1)",
        B12: "='Q1 plan'!B2/'Q1 plan'!B4",
        B13: "=Nowhere!A1",
        B14: "=IFERROR(B12,0)" } },
    ],
  });
}
const v = (a) => book().value("Summary", a);
const errOf = (x) => (x && typeof x === "object" && x.e) || null;

// --- formulas, through the starter's own engine ---
test("SUM over a quoted tab name with a space", () => assert.strictEqual(v("B1"), 2000.5));
test("SUMIFS between month bounds built with >= & and EDATE", () => assert.strictEqual(v("B2"), 300));
test("COUNTIFS with <> counts the blank rows past the data too, as Excel does", () => assert.strictEqual(v("B3"), 198));
test("IF compares across tabs and returns text", () => assert.strictEqual(v("B4"), "over"));
test("VLOOKUP exact match", () => assert.strictEqual(v("B5"), 800.5));
test("EOMONTH gives the month's last day", () => assert.strictEqual(E.fmtValue(v("B6"), "date", { locale: "en-GB" }), "30 Nov 2026"));
test("ROUND to 2 places", () => assert.strictEqual(v("B7"), 666.83));
test("SUMPRODUCT of two conditions", () => assert.strictEqual(v("B8"), 2));
test("a formula that refers to itself is #CYCLE!, not a hang", () => assert.strictEqual(errOf(v("B9")), "#CYCLE!"));
test("two formulas that refer to each other are #CYCLE!", () => assert.strictEqual(errOf(v("B10")), "#CYCLE!"));
test("an unknown function is #NAME?", () => assert.strictEqual(errOf(v("B11")), "#NAME?"));
test("division by zero is #DIV/0!, and IFERROR catches it", () => { assert.strictEqual(errOf(v("B12")), "#DIV/0!"); assert.strictEqual(v("B14"), 0); });
test("a missing tab is #REF!", () => assert.strictEqual(errOf(v("B13")), "#REF!"));
test("money format: currency sign, no decimals", () => assert.strictEqual(E.fmtValue(2000.5, "money", { locale: "en-GB", currency: "GBP" }), "£2,001"));
test("report lists every error cell", () => {
  const errs = JSON.parse(JSON.stringify(E.report(book()).errors));
  assert.deepStrictEqual(errs.sort(), ["Summary!B10 #CYCLE!", "Summary!B11 #NAME?", "Summary!B12 #DIV/0!", "Summary!B13 #REF!", "Summary!B9 #CYCLE!", "Summary!C10 #CYCLE!"].sort());
});

// --- a chart's axes: readable at a phone's width, round steps, no labels on top of each other ---
const GB = { locale: "en-GB", currency: "GBP" };
const width7 = (s) => s.length * 7; // about system-ui at 12 px
const monthsOf = (y, n) => Array.from({ length: n }, (_, i) => { const v = E.serial(y + Math.floor(i / 12), i % 12 + 1, 1); return { v, fmt: "month", text: E.fmtValue(v, "month", GB) }; });
// Each label drawn, where the page draws it: none may touch the next (4 px apart in a row, 12 px apart angled).
function assertApart(ax, what) {
  const xs = ax.labels.map((s, i) => ({ s, x: ax.left + ax.gap * i + ax.gap / 2 })).filter((_, i) => ax.show[i]);
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1], b = xs[i], space = ax.angle ? (b.x - a.x) * Math.SQRT1_2 : b.x - a.x - (width7(a.s) + width7(b.s)) / 2;
    assert.ok(space >= (ax.angle ? 12 : 4), `${what}: "${a.s}" and "${b.s}" are ${space.toFixed(1)} px apart`);
  }
  assert.ok(ax.show[0], `${what}: the first label shows`);
}
test("a chart's value axis steps are round: £0, £500, £1,000, £1,500, not quarters of the biggest bar", () => {
  const ax = E.chartAxes({ labels: monthsOf(2026, 12), max: 1362, fmt: "money", title: "Revenue by month, 2026", series: ["Revenue"], width: 760, measure: width7, data: GB });
  assert.deepStrictEqual(Array.from(ax.ticks, (t) => t.text), ["£0", "£500", "£1,000", "£1,500"]);
  assert.strictEqual(ax.top, 1500);
  const pct = E.chartAxes({ labels: [], max: 0.83, fmt: "pct", width: 760, measure: width7, data: GB });
  assert.deepStrictEqual(Array.from(pct.ticks, (t) => t.text), ["0%", "20%", "40%", "60%", "80%", "100%"]);
  const few = E.chartAxes({ labels: [], max: 3, fmt: "int", width: 760, measure: width7, data: GB });
  assert.deepStrictEqual(Array.from(few.ticks, (t) => t.text), ["0", "1", "2", "3"]); // whole numbers stay whole
});
test("twelve months say Jan … Dec when the title names their year, and fit in a row at 1280 and thin to every other on a phone", () => {
  const o = { labels: monthsOf(2026, 12), max: 1362, fmt: "money", title: "Revenue by month, 2026", series: ["Revenue"], measure: width7, data: GB };
  const wide = E.chartAxes(Object.assign({ width: 860 }, o)), phone = E.chartAxes(Object.assign({ width: 358 }, o));
  assert.deepStrictEqual(wide.labels, ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]);
  assert.deepStrictEqual([wide.every, wide.angle], [1, 0]);
  assert.deepStrictEqual([phone.every, phone.angle], [2, 0]);
  assertApart(wide, "1280"); assertApart(phone, "390");
  assert.strictEqual(phone.key, false); // the title names the only series
});
test("months keep their year when the title doesn't name it, or they span two years, and still never touch", () => {
  const noYear = E.chartAxes({ labels: monthsOf(2026, 12), max: 900, fmt: "money", title: "Revenue by month", width: 358, measure: width7, data: GB });
  assert.strictEqual(noYear.labels[0], "Jan 2026");
  assertApart(noYear, "no year in the title");
  const two = E.chartAxes({ labels: monthsOf(2025, 18), max: 900, fmt: "money", title: "Revenue, 2025", width: 860, measure: width7, data: GB });
  assert.strictEqual(two.labels[12], "Jan 2026");
  assertApart(two, "two years");
});
test("category names are angled so each still shows on a phone, and thinned only when even angled ones can't fit", () => {
  const names = ["House Espresso", "Brazil Cerrado", "Colombia Huila", "Ethiopia Yirgacheffe", "Swiss Water Decaf"].map((s) => ({ v: s, fmt: null, text: s }));
  const phone = E.chartAxes({ labels: names, max: 4200, fmt: "money", title: "Revenue by product", series: ["Revenue", "Orders"], width: 358, measure: width7, data: GB });
  assert.strictEqual(phone.angle, 45);
  assert.deepStrictEqual(phone.show, [true, true, true, true, true]);
  assert.strictEqual(phone.labels[3], "Ethiopia Yi…");
  assert.ok(phone.left - phone.labels.reduce((m, s) => Math.max(m, width7(s)), 0) * Math.SQRT1_2 + phone.gap / 2 >= 0, "the first angled label starts inside the chart");
  assert.strictEqual(phone.key, true); // two series need their key
  const wide = E.chartAxes({ labels: names, max: 4200, fmt: "money", title: "Revenue by product", width: 860, measure: width7, data: GB });
  assert.deepStrictEqual([wide.angle, wide.labels[3]], [0, "Ethiopia Yirgacheffe"]); // room for the whole name in a row
  assertApart(wide, "names at 1280");
  const many = Array.from({ length: 40 }, (_, i) => ({ v: "Branch " + (i + 1), fmt: null, text: "Branch " + (i + 1) }));
  const crowded = E.chartAxes({ labels: many, max: 10, fmt: "int", width: 358, measure: width7, data: GB });
  assert.ok(crowded.every > 1); assertApart(crowded, "40 names");
  const days = Array.from({ length: 60 }, (_, i) => { const v = E.serial(2026, 11, 1) + i; return { v, fmt: "date", text: E.fmtValue(v, "date", GB) }; });
  assertApart(E.chartAxes({ labels: days, max: 10, fmt: "int", width: 358, measure: width7, data: GB }), "60 days");
});
test("a chart's axes come out whole for any values a sheet can hold", () => {
  const vals = [0, -5, 1e-9, 0.5, 7, 1362, 1e15, 1e308, NaN];
  for (const max of vals) for (const fmt of ["money", "money2", "int", "num", "pct", "pct1", "nope"]) for (const width of [260, 358, 860]) {
    const ax = E.chartAxes({ labels: [{ v: { e: "#REF!" }, fmt: null, text: "#REF!" }, { v: null, fmt: null, text: "" }, { v: 46000, fmt: "month", text: "x" }], max, fmt, width, measure: width7, data: GB });
    assert.ok(ax.ticks.length >= 2 && ax.ticks.length <= 12 && ax.ticks.every((t) => isFinite(t.v) && typeof t.text === "string"), `${max} ${fmt}`);
    assert.ok(ax.top > 0 && isFinite(ax.top) && ax.every >= 1 && ax.height > ax.plot, `${max} ${fmt} ${width}`);
  }
});

// --- what the page's scripts may never do with cell data ---
test("the page's scripts never write HTML or run text as code", () => {
  const code = script("sheet-engine") + script("sheet-ui");
  const bad = /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*["'`]|setInterval\s*\(\s*["'`]/g;
  assert.deepStrictEqual(code.match(bad) || [], []);
});

if (fs.existsSync(path.join(__dirname, "live.js"))) require("./live.js")({ E, test, script, PAGE, ROOT });
require("./hostile.js")({ E, test, script, within, ROOT });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
