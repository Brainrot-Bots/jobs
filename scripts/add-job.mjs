/**
 * add-job.mjs — Add a job URL to jobs.json.
 *
 * Usage:
 *   node scripts/add-job.mjs --url <url> [--title "Job Title"]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const jobsFile = join(repoRoot, "jobs.json");

const args = process.argv.slice(2);
const urlIdx = args.indexOf("--url");
const titleIdx = args.indexOf("--title");

if (urlIdx === -1 || !args[urlIdx + 1]) {
  console.error("Usage: node scripts/add-job.mjs --url <url> [--title 'Job Title']");
  process.exit(1);
}

const url = args[urlIdx + 1];
const title = titleIdx !== -1 ? args[titleIdx + 1] : null;

const data = JSON.parse(readFileSync(jobsFile, "utf-8"));

if (data.jobs.some((j) => j.url === url)) {
  console.log("Job already exists in jobs.json");
  process.exit(0);
}

const entry = {
  url,
  ...(title && { title }),
  added: new Date().toISOString().slice(0, 10),
};

data.jobs.push(entry);
writeFileSync(jobsFile, JSON.stringify(data, null, 2) + "\n");
console.log(`Added: ${url}`);
