/**
 * office-calc.mjs — Office attendance calculator
 *
 * Rules:
 *   - ≥4 hours in office = counts as 1 day
 *   - 8-week rolling average of weekly day counts must be ≥ target (default 3)
 *   - Optionally track daily hours to maintain a safe hourly average too
 *
 * Usage:
 *   node scripts/office-calc.mjs                          # interactive prompt
 *   node scripts/office-calc.mjs 3 4 2 3 4 3 2           # last 7 weeks (days) as args
 *   node scripts/office-calc.mjs 3 4 2 3 4 3 2 --target 4
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const WINDOW = 8;
const MIN_HOURS_PER_DAY = 4;   // minimum to count as a day
const SAFE_HOURS_PER_DAY = 7;  // target to be comfortably above minimum

function parseArgs() {
  const args = process.argv.slice(2);
  const targetIdx = args.indexOf("--target");
  const target = targetIdx !== -1 ? parseFloat(args[targetIdx + 1]) : 3;
  const weeks = args
    .filter((a, i) => a !== "--target" && !(targetIdx !== -1 && i === targetIdx + 1))
    .map(Number)
    .filter((n) => !isNaN(n));
  return { weeks, target };
}

function calcMinimum(pastWeeks, target, maxWindow = WINDOW) {
  const past = pastWeeks.slice(-(maxWindow - 1));
  const window = Math.min(maxWindow, past.length + 1);
  const relevant = past.slice(-(window - 1));
  const pastSum = relevant.reduce((a, b) => a + b, 0);
  const needed = target * window - pastSum;
  return {
    min: Math.max(0, Math.ceil(needed)),
    weeksUsed: relevant.length,
    pastSum,
    windowSize: window,
    target,
    past: relevant,
  };
}

function hoursAdvice(daysNeeded) {
  if (daysNeeded === 0) return null;
  const minTotal = daysNeeded * MIN_HOURS_PER_DAY;
  const safeTotal = daysNeeded * SAFE_HOURS_PER_DAY;
  return { daysNeeded, minTotal, safeTotal };
}

function display(result) {
  const { min, weeksUsed, pastSum, windowSize, target, past } = result;
  const projectedAvg = (pastSum + min) / windowSize;
  const hours = hoursAdvice(min);

  console.log("\n─────────────────────────────────────");
  console.log(`  Past ${weeksUsed} week${weeksUsed !== 1 ? "s" : ""}:   ${past.join(", ")} day${past.length !== 1 ? "s" : ""}`);
  console.log(`  Window:       ${windowSize} weeks`);
  console.log(`  Target avg:   ≥ ${target} days/week`);
  console.log("─────────────────────────────────────");

  if (min === 0) {
    const zeroAvg = (pastSum / windowSize).toFixed(2);
    console.log(`  ✅ Already at target — 0 days required this week`);
    console.log(`     Average with 0 days: ${zeroAvg}/week`);
  } else if (min > 5) {
    const fiveAvg = ((pastSum + 5) / windowSize).toFixed(2);
    console.log(`  ⚠️  Can't fully recover this week (need ${min} days, max 5)`);
    console.log(`     Go all 5 days → avg becomes ${fiveAvg}/week`);
  } else {
    console.log(`  📋 Minimum days this week:  ${min} day${min !== 1 ? "s" : ""}`);
    console.log(`     Projected avg:           ${projectedAvg.toFixed(2)} days/week`);
    if (hours) {
      console.log("");
      console.log(`  ⏱  Hours to hit minimum:   ${hours.minTotal}h total  (${MIN_HOURS_PER_DAY}h × ${min} days)`);
      console.log(`     Hours to be safe (${SAFE_HOURS_PER_DAY}h/day): ${hours.safeTotal}h total`);
    }
  }

  // Week breakdown
  console.log("\n  Week breakdown:");
  const allWeeks = [...past];
  while (allWeeks.length < windowSize - 1) allWeeks.unshift("—");
  allWeeks.forEach((d, i) => {
    const offset = allWeeks.length - i;
    const label = offset === 1 ? "last week" : `${offset}w ago`;
    const suffix = d === "—" ? "" : ` day${d !== 1 ? "s" : ""}`;
    console.log(`    ${label.padEnd(10)} ${d}${suffix}`);
  });
  const arrow = min > 5 ? `5 days max (need ${min})` : `${min}+ days  ← minimum`;
  console.log(`    ${"this week".padEnd(10)} ${arrow}`);
  console.log("─────────────────────────────────────\n");
}

async function interactiveMode() {
  const rl = readline.createInterface({ input, output });
  console.log("\nOffice Attendance Calculator");
  console.log(`Rules: ≥${MIN_HOURS_PER_DAY}h/day = 1 day · 8-week rolling average`);
  console.log("Enter days in office per week, oldest first. Press Enter to skip (0).\n");

  const weeks = [];
  for (let i = 7; i >= 1; i--) {
    const raw = await rl.question(`  ${i} week${i !== 1 ? "s" : ""} ago (days in office): `);
    if (raw.trim().toLowerCase() === "done" || raw.trim().toLowerCase() === "q") break;
    const val = parseInt(raw.trim(), 10);
    weeks.unshift(isNaN(val) ? 0 : val);
  }

  const targetRaw = await rl.question(`\n  Target days/week [3]: `);
  const target = parseFloat(targetRaw.trim()) || 3;
  rl.close();

  const result = calcMinimum(weeks, target);
  display(result);
}

const { weeks, target } = parseArgs();

if (weeks.length > 0) {
  const result = calcMinimum(weeks, target);
  display(result);
} else {
  await interactiveMode();
}
