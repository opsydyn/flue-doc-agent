# FastCheck Post-Mortem: UrlChecker Property Tests

Date: 2026-05-02  
File under test: `agents/doc-freshness/src/UrlChecker.ts`  
Property test file: `agents/doc-freshness/src/__tests__/UrlChecker.property.ts`

---

## Finding 1 — Invalid URL bypasses mock, escapes to HttpClient URL validator

**Seed:** `-797948773`  
**Path:** `0:0`  
**Shrunk:** 1 time  
**Counterexample:** `[100, ""]`

### What happened

Property "status code passthrough" used `FastCheck.string()` as the URL arbitrary. FastCheck
generated the empty string `""`. `HttpClient.make` validates the URL with `UrlParams.makeUrl`
*before* invoking the mock handler. Parsing `""` as a URL throws, producing an
`InvalidUrlError` wrapped in `HttpClientError`, which then flowed through `Effect.mapError`
into a `UrlCheckError` — a failure, not the expected `String(status)` success.

### Error chain

```
HttpClientRequest.head("") →
  UrlParams.makeUrl("") → TypeError: "" cannot be parsed as a URL →
  HttpClientError({ reason: InvalidUrlError }) →
  Effect.mapError → UrlCheckError { url: "" } →
  property assertion: result !== "100" → FAIL
```

### Fix

Replace `FastCheck.string()` with `FastCheck.webUrl()` so the arbitrary only generates
structurally valid URLs. The property is correctly scoped to *valid* URL inputs.

```diff
- FastCheck.string(),
+ FastCheck.webUrl(),
```

### Lesson

`HttpClient.make` is not a pure pass-through — it validates the URL before reaching the
handler. Any property that mocks the HTTP layer must still supply valid URLs or it is
testing the URL parser, not the service.

---

## Finding 2 — `new Response(null, { status })` throws on informational status codes

**Seed:** `-1307630316`  
**Path:** `0:0:0:0:0:0:0:0:0`  
**Shrunk:** 8 times  
**Counterexample:** `[100, "http://a.aa"]`

### What happened

After fixing Finding 1, the status code arbitrary was `FastCheck.integer({ min: 100, max: 599 })`.
FastCheck generated status `100`. The mock layer constructs:

```ts
HttpClientResponse.fromWeb(req, new Response(null, { status: 100 }))
```

The Web `Response` constructor enforces: status must be `101` or in the range `[200, 599]`.
Status `100` (Continue) is not a valid constructor argument, so it throws a `RangeError`
synchronously inside `Effect.succeed(...)`, crashing the fiber.

```
new Response(null, { status: 100 }) →
  RangeError: The status provided (100) must be 101 or in the range of [200, 599]
```

FastCheck shrunk the counterexample 8 times from the initially failing input down to the
minimal `[100, "http://a.aa"]`.

### Fix

Constrain the status arbitrary to the range the Web `Response` constructor actually accepts:

```diff
- FastCheck.integer({ min: 100, max: 599 }),
+ FastCheck.integer({ min: 200, max: 599 }),
```

### Lesson

`HttpClientResponse.fromWeb` delegates to the Web platform's `Response` constructor, which
has its own validity constraints independent of the HTTP spec. Mock layers that use
`fromWeb` must stay within `[200, 599]` (or `101`). The property's domain must match the
*implementation's* valid input space, not just the conceptual HTTP status code space.

---

## Summary

| # | Seed | Counterexample | Root cause | Fix |
| --- | --- | --- | --- | --- |
| 1 | `-797948773` | `[100, ""]` | `HttpClient.make` validates URLs before mock runs | Use `FastCheck.webUrl()` |
| 2 | `-1307630316` | `[100, "http://a.aa"]` | `new Response(status: 100)` throws (Web API constraint) | Status range `200–599` |
