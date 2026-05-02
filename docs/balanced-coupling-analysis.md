# Balanced Coupling Analysis — doc-freshness agent

Framework: [Balanced Coupling model](https://skills.sh/vladikk/modularity/balanced-coupling) (Vlad Khononov)  
Level of abstraction: module level — within `agents/doc-freshness/`

---

## Dimensions recap

| Dimension | What it measures |
| --- | --- |
| **Integration strength** | How much shared knowledge — Intrusive > Functional > Model > Contract |
| **Distance** | Cost of co-evolving — same file < same package < external package < different org |
| **Volatility** | Probability of needing to change — Core subdomain > Supporting > Generic |

**Balance rule:** `MODULARITY = STRENGTH XOR DISTANCE`  
**With pragmatism:** `BALANCE = (STRENGTH XOR DISTANCE) OR NOT VOLATILITY`

---

## Component map

```
                        ┌─────────────────────────┐
                        │    doc-freshness.ts      │  ← agent handler (core)
                        └────────┬────────┬────────┘
                                 │        │
               ┌─────────────────┘        └──────────────────┐
               ▼                                             ▼
  ┌────────────────────┐                        ┌────────────────────┐
  │   UrlChecker.ts    │                        │    @flue/sdk        │
  │  (Effect service)  │                        │  (agent framework) │
  └────────┬───────────┘                        └────────────────────┘
           │
    ┌──────┴────────┐
    ▼               ▼
effect/unstable  FetchHttpClient
    /http/*         .layer
```

---

## Coupling assessments

### 1. `doc-freshness.ts` → `UrlChecker` ✅ Balanced by low volatility

| | |
| --- | --- |
| **Strength** | Contract — handler only sees the `UrlChecker` tag and `UrlCheckerDefault` layer. `UrlCheckError` isn't even imported; it's caught by its string tag `"UrlCheckError"` at runtime. |
| **Distance** | Low — sibling directories within the same package. |
| **Volatility** | Low — `check(url: string) => Effect<string, UrlCheckError>` is a stable, narrow interface. |
| **Verdict** | Low strength + low distance = low cohesion by the matrix alone, but **low volatility resolves it**. `BALANCE = (false XOR false) OR NOT false = true`. |

The catch-by-string-tag is worth noting: it's a deliberate choice to keep the handler free of `UrlChecker`'s internal error type. If `UrlCheckError` is renamed, the test suite catches it before the handler needs updating.

---

### 2. `doc-freshness.ts` → `@flue/sdk` ✅ Loose coupling

| | |
| --- | --- |
| **Strength** | Contract — only published interfaces (`FlueContext`, `ToolDef`, `Type`) from the SDK's stable public API. |
| **Distance** | High — external package, separate team, experimental ("APIs may change"). |
| **Volatility** | Medium-high — Flue is explicitly "experimental, APIs may change". |
| **Verdict** | Low strength + high distance = **Loose Coupling**. The volatility risk is real, but integration strength is low enough that framework changes require updating the thin handler only, not the business logic. |

---

### 3. `UrlChecker.ts` → `effect/unstable/http/*` ⚠️ Contained tight coupling

| | |
| --- | --- |
| **Strength** | Model — direct use of Effect's HTTP domain model: `HttpClient.HttpClient` (service tag), `HttpClientRequest.head()`, `HttpClientError.HttpClientError`, `HttpClientError.TransportError`. These are Effect's internal types, not a published integration contract. |
| **Distance** | High — external package. |
| **Volatility** | **High** — the import path says it plainly: `effect/unstable/http`. This is a core subdomain of the HTTP abstraction layer under active development. |
| **Verdict** | High strength + high distance + high volatility = **Tight Coupling (unbalanced)**. |

**Why it's acceptable:** `UrlChecker` is deliberately structured as an **anti-corruption layer** — a DDD pattern that absorbs a high-volatility external dependency and exposes only a stable domain interface to the rest of the codebase. The unbalanced coupling is *contained* to this single file. When `effect/unstable/http` stabilises and renames, there is one change point.

This is correct design: the complexity is real, it's just fully enclosed.

---

### 4. Test files → `effect/unstable/http/*` ✅ Resolved — single change point restored

| | |
| --- | --- |
| **Strength** | Contract — both test files import only `mockHttpLayer`, `networkErrorLayer`, `runCheck` from `src/__tests__/mock-layers.ts`. No direct `effect/unstable/http` imports in test files. |
| **Distance** | Low — same package (`src/__tests__/`). |
| **Volatility** | Low — stable test-helper interface. |
| **Verdict** | Low strength + low distance = **High cohesion**. |

`mock-layers.ts` is now the **sole import point** for `effect/unstable/http` in test code, mirroring the anti-corruption layer design of `UrlChecker.ts` in production code. When Effect's HTTP API changes, only two files need updating: `UrlChecker.ts` and `mock-layers.ts`.

```
UrlChecker.test.ts ──┐
                      ├── import mock-layers.ts only
UrlChecker.property.ts ──┘
                      ↓
               mock-layers.ts ── single import of effect/unstable/http
```

---

### 5. Tests → `UrlChecker` (via `UrlCheckerLayer`) ✅ High cohesion

| | |
| --- | --- |
| **Strength** | Functional — tests know `UrlChecker`'s internal wiring (that it depends on `HttpClient.HttpClient`). They substitute it via `UrlCheckerLayer.pipe(Layer.provide(mockHttpLayer))`. |
| **Distance** | Low — same package. |
| **Volatility** | Medium — if the service's internal dependencies change, tests change too. |
| **Verdict** | Medium-high strength + low distance = **High Cohesion**. Balanced. This is the intended relationship between a service and its unit tests. |

The deliberate split between `UrlCheckerLayer` (pure, testable) and `UrlCheckerDefault` (production-wired) is what makes this cohesion healthy rather than fragile — the tests aren't reaching into implementation details via reflection; they're using a published seam.

---

## Summary

| Coupling | Strength | Distance | Volatility | Verdict |
| --- | --- | --- | --- | --- |
| `doc-freshness` → `UrlChecker` | Contract | Low | Low | ✅ Balanced (volatility) |
| `doc-freshness` → `@flue/sdk` | Contract | High | Med-High | ✅ Loose coupling |
| `UrlChecker` → `effect/unstable/http` | Model | High | High | ⚠️ Tight — contained in ACL |
| Tests → `effect/unstable/http` | Contract | Low | Low | ✅ Contained in mock-layers.ts |
| Tests → `UrlChecker` (layer) | Functional | Low | Medium | ✅ High cohesion |

All coupling assessments are now in balance. No outstanding action items.
