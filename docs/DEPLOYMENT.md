# Deployment Options

## Recommended Path

For this project, the best deployment sequence is:

1. local dry-run and paper mode on your development machine
2. single-node always-on worker on a small VPS
3. tiny-size live mode after review of logs, paper performance, and kill-switch behavior

Best default choice:

- deploy the first real worker on a small VPS from Hetzner or DigitalOcean

Why this is the best fit for v1:

- the service is a long-running loop, not a bursty request app
- SQLite and JSONL logging are simplest on a single machine
- easier debugging, lower platform complexity, and predictable cost
- process supervision is straightforward with `systemd`, Docker Compose, or a process manager

## Option 1: VPS

Recommended for v1 and first live deployment.

Suggested stack:

- Ubuntu 24.04
- Python virtualenv or Docker
- `systemd` service or Docker Compose
- reverse proxy only if exposing dashboards or admin endpoints
- encrypted `.env` handling through provider secrets, `sops`, or manual host management

Pros:

- best control over network, logs, and local state
- stable for long-running workers
- easiest fit for SQLite journaling
- straightforward restarts and backups

Cons:

- more host management than managed platforms

## Option 2: Fly.io

Good if you want simpler managed deployment while still running a long-lived process.

Recommended use:

- paper-trading worker
- dashboard or operator API

Pros:

- simpler than raw VPS
- easy deployment flow
- good for small persistent services

Cons:

- persistent disk sizing and region planning matter
- still more opinionated than a simple VPS

## Option 3: Railway or Render

Useful for operator APIs, dashboards, or non-critical research services.

Good fit:

- read-only market scanners
- report generation
- operator UI

Not ideal as the first live trading runtime because:

- background worker behavior and persistent local state are less predictable than on VPS
- SQLite usage is usually a weaker fit

## Option 4: Kubernetes

Not recommended for v1.

Use only if:

- you later split the system into independent services
- you need separate research, execution, and reporting workers
- you move from SQLite to PostgreSQL and object storage

For the first version this adds too much operational surface area.

## Option 5: Serverless

Not recommended for the main trading loop.

Avoid for:

- order management loops
- timed exits
- continuous market monitoring

Possible use later:

- report generation
- periodic reconciliation
- webhook processing

## Deployment Split Recommendation

If the project grows, split deployment like this:

- trading worker on VPS
- optional operator API on Fly.io or Railway
- optional dashboard on Vercel or static hosting

Do not separate them for v1 unless there is a clear operational reason.

## Operational Requirements

Wherever the worker runs, require:

- process supervision and automatic restart
- system clock synchronization
- structured logs
- SQLite backup strategy
- JSONL log rotation
- alerting on kill-switch activation
- alerting on repeated auth or execution failures
- environment-specific config for paper vs live mode

## Best Initial Deployment

Best overall recommendation for this project:

- local development
- paper-trade on a small VPS
- tiny-size live on the same VPS after review

This gives the lowest operational complexity while the strategy and execution controls are still being validated.
