# GP-V4

Modular monolith for **XAU/USD analysis and trading**: Biquiti market data → analysis
engines → confluence → strong-candle strategy → Novita AI review → risk gate →
persistence/notification → mode-dependent execution.

Default mode is `ANALYSIS_ONLY`: the system analyses, scores, and reports setups but
**never originates an order**.

## Status

Phase 1 (foundation) and Phase 2 (vertical slice) are complete; Phase 3 (safety) and
Phase 4 (modes/replay/backtest) are implemented. Live broker execution is intentionally
**not** wired — the venue contract is external (see `TODO` below). All external
integrations are behind boundaries with injected transport, so the whole graph runs and
tests without any credentials.

## Requirements

- Node.js ≥ 22
- npm

## Commands

```bash
npm install         # install dependencies
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest run
npm run build       # compile to dist/
npm run dev         # tsx src/index.ts (dev entrypoint)
npm start           # node dist/index.js (built entrypoint)
```

## Architecture

```
src/
  config/       AppConfig schema + env source (zod-validated, versioned overrides)
  core/         domain types, event bus, logger with secret redaction, error taxonomy
  marketdata/   provider boundary, candle cache, validation, Biquiti adapter
    biquiti/    field-mapped parser + HTTP adapter (endpoint/field names are config)
    replay/     in-memory fixture source for deterministic replay/backtest
  strategies/   analysis engines + confluence + strong-candle strategy + setup store
    engines/    structure (swings/BOS), liquidity (equal levels/sweeps), price-action
  ai/           Novita provider, context builder, budget guard, circuit breaker,
                response cache, AI router, replay provider/recorder
  risk/         risk engine (lot sizing, verdicts), kill switch (L1/L2/L3)
  persistence/  repository boundary, Supabase implementation, null repository
  telegram/     notifier (sendMessage via injected fetch, no-op when disabled)
  safety/       idempotency guard, reconciliation service
  execution/    broker-side SL/TP protection boundary (simulated impl)
  scanner/      symbol×timeframe scan loop with bar-close triggers
  backtest/     deterministic backtest runner, spread/slippage model, trade lifecycle
  replay/       drives the live pipeline over fixtures with a virtual clock
  pipeline/     trading pipeline, signal/plan builders, buildApp composition root
  index.ts      entrypoint: load config → build graph → run scan loop
```

### Data flow (per closed bar)

```
Scanner → CandleCache → ConfluenceEngine(structure+liquidity+price-action)
        → StrongCandleStrategy → AiRouter (Novita; can only block/downgrade)
        → RiskEngine (lot size + verdict) → mode handling
```

Key invariants:

- **Closed bars only.** Strategies never see partial bars; `validateCandleSeries` rejects
  future-closing bars and misaligned timestamps.
- **No lookahead.** Replay and backtest expose only bars whose `closeTime <= asOf`.
- **AI cannot size.** Lot size and risk amount are computed solely by the risk engine.
- **Idempotent.** Setup ids and the idempotency guard de-duplicate bars across restarts.
- **Fail-safe.** Provider/AI/persistence failures degrade gracefully and never halt the
  pipeline; the kill switch (L2/L3) blocks new entries.

## Modes

`GP_MODE` selects behavior: `ANALYSIS_ONLY` (default), `MANUAL_CONFIRMATION`,
`AUTO_TRADING`, `PAPER_TRADING`, `REPLAY`, `BACKTEST`. Simulated modes apply the
spread/slippage/latency model to fills. `AUTO_TRADING` surfaces a candidate but leaves
order routing to an execution layer that is not yet wired.

## Configuration

Copy `.env.example` to `.env` and fill values. Config is validated at startup; missing
optional integrations degrade to no-ops (Biquiti → scanner warnings, Supabase → null
repo, Telegram → silent, Novita → AI failures degraded to `AI_BLOCKED`).

## Tests

129 tests across config, market data, strategy engines, confluence, AI router/cache/
breaker, risk, persistence/telegram, safety, backtest, replay, and the end-to-end
pipeline. Run with `npm test`.

## TODO / blocked on external information

- **Biquiti API contract** — endpoint paths, field names, auth header format, symbol map.
  All configurable via env; the parser assumes a configurable field map.
- **Novita** — base URL, model id, and pricing constants for accurate cost estimation.
- **Supabase** — project URL + service key, and the SQL schema (tables `setups`,
  `ai_decisions`, `trades`).
- **Telegram** — bot token and chat id.
- **Live broker venue** — order routing, position state, and server-side SL/TP
  (the `BrokerProtection` boundary is implemented for simulated modes only).
- **Reconciliation** — the live-venue leg is a stub until the broker contract is known.
