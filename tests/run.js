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
function engine() {
  const box = { module: {}, TextEncoder, Intl, Date, Math, JSON };
  vm.runInNewContext(script("sheet-engine"), box);
  return box.module.exports;
}
const E = engine();

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

// --- what the page's scripts may never do with cell data ---
test("the page's scripts never write HTML or run text as code", () => {
  const code = script("sheet-engine") + script("sheet-ui");
  const bad = /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*["'`]|setInterval\s*\(\s*["'`]/g;
  assert.deepStrictEqual(code.match(bad) || [], []);
});

if (fs.existsSync(path.join(__dirname, "live.js"))) require("./live.js")({ E, test, script, PAGE, ROOT });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
