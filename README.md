# jobs

Brainrot Creations job posting tracker — automatically checks if job URLs are still open by looking for the Apply button, and sends a GitHub Issue notification when a posting closes.

## How it works

1. Add job URLs to `jobs.json` with a `url`, `message`, and `schedule` field
2. GitHub Actions runs hourly — each job is checked according to its own schedule (`hourly`, `daily`, or `weekly`)
3. Open = Apply button found · Closed = 404/410 or "no longer available" language · Unknown = neither detected
4. When a job transitions **open → closed**, a GitHub Issue is automatically created
5. README is updated after each run with the latest job status table

## jobs.json format

```json
{
  "jobs": [
    {
      "url": "https://www.google.com/about/careers/applications/jobs/results/...",
      "message": "Note about why you're tracking this role",
      "schedule": "daily"
    }
  ]
}
```

`schedule` options: `hourly`, `daily`, `weekly`

## Add a job

Edit `jobs.json` directly and push, or:

```bash
node scripts/add-job.mjs --url "https://..."
```

## Manual check

```bash
node scripts/check-jobs.mjs            # respects per-job schedule windows
node scripts/check-jobs.mjs --force    # checks everything regardless of schedule
```

## Supported companies

Auto-detected from URL: Google, Meta, Microsoft, Apple, Amazon, Netflix, OpenAI, Anthropic, Stripe, LinkedIn — plus any Greenhouse, Lever, Workday, or Ashby ATS link.

## Tracked Jobs

| Job | Company | Location | Status | Last Checked | Notes |
|-----|---------|----------|--------|-------------|-------|
| [Manufacturing Structural Test Development Engineer](https://www.google.com/about/careers/applications/jobs/results/82087125486314182-manufacturing-structural-test-development-engineer) | Google | — | ✅ Open | 2026-08-10 | Google structural test engineer role — example entry |


