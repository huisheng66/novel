# 2026-05-15 Token Version Deploy And Load Test

## Target

- Deploy the token-limited admin/front-end version to the Ubuntu test server.
- Run load tests through the Nginx entry.
- Record issues found during the test and the optimization applied.

## Server

- IP: `192.168.159.130`
- SSH user: `huisheng`
- Deploy directory: `/home/huisheng/codexnovel-deploy-test`
- App port: `3008`
- Nginx entry: `http://192.168.159.130/`
- Admin: `http://192.168.159.130/admin/login`
- Admin password: `admin123`
- Load-test token: `servertesttoken`

## Deploy Command

```bash
sudo ADMIN_PASSWORD='admin123' DB_PASSWORD='000000' PORT=3008 DB_CONNECTION_LIMIT=20 PUBLIC_CACHE_TTL_MS=10000 PAGE_VIEW_BATCH_SIZE=100 PAGE_VIEW_FLUSH_INTERVAL_MS=1000 bash scripts/deploy-ubuntu.sh
```

## Deployment Result

- Script exit code: `0`
- `codexnovel` systemd service: `active`
- App health check: `http://127.0.0.1:3008/healthz` -> `200`
- External Nginx health check: `http://192.168.159.130/healthz` -> `200`
- Admin token page: `200`, contains `servertesttoken`
- Public page without token: `403`
- Public page with token: `200`
- Static CSS through Nginx: `Cache-Control: max-age=604800`, `Content-Encoding: gzip`
- HTML cache check: first request `X-Cache: MISS`, second request `X-Cache: HIT`

## Issue Found

- Testing `http://127.0.0.1/` on the server hit an old default Nginx site named `novel`.
- That old site proxies to unused port `3000`, so localhost Nginx checks returned `502`.
- The real external entry with `Host: 192.168.159.130` correctly hits this app on port `3008`.
- Existing Nginx warning remains: `conflicting server name "192.168.159.130" on 0.0.0.0:80`.

## Optimization Applied

- Added a 5-second in-memory cache for active access-token validation.
- Admin token create/enable/disable/delete now clears the access-token cache.
- Reason: after token enforcement, each public request had an extra `access_tokens` lookup. The short cache keeps permission changes responsive while reducing repeated database reads under load.

## Load Test Before Token-Cache Optimization

| Scenario | Concurrency | Duration | RPS | P50 | P95 | P99 | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/healthz` | 100 | 10s | 3034.70 | 30.60ms | 49.41ms | 60.51ms | 0 |
| `/?token=servertesttoken` | 100 | 15s | 1167.62 | 73.28ms | 130.69ms | 156.36ms | 0 |
| `/novel/1/4?token=servertesttoken` | 100 | 15s | 1956.54 | 50.09ms | 57.92ms | 66.23ms | 0 |
| `/?token=servertesttoken` | 200 | 15s | 1222.00 | 149.96ms | 219.35ms | 266.43ms | 0 |
| `/novel/1/4?token=servertesttoken` | 200 | 15s | 1678.93 | 111.19ms | 171.82ms | 199.56ms | 0 |
| `/` without token | 100 | 5s | 3617.87 | 25.38ms | 34.56ms | 87.54ms | 0 |

## Load Test After Token-Cache Optimization

| Scenario | Concurrency | Duration | RPS | P50 | P95 | P99 | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/?token=servertesttoken` | 100 | 15s | 1667.40 | 54.89ms | 78.50ms | 308.96ms | 0 |
| `/novel/1/4?token=servertesttoken` | 100 | 15s | 2746.73 | 35.71ms | 48.61ms | 55.18ms | 0 |
| `/?token=servertesttoken` | 200 | 15s | 1493.74 | 120.99ms | 188.81ms | 295.44ms | 0 |
| `/novel/1/4?token=servertesttoken` | 200 | 15s | 2593.66 | 71.08ms | 103.47ms | 109.43ms | 0 |
| `/novel/1/4?token=servertesttoken` | 300 | 10s | 1965.08 | 150.80ms | 169.32ms | 185.29ms | 0 |

## Server State After Tests

- Node service memory: about `43.7M` current, `109.2M` peak.
- MySQL `Threads_connected`: `16`.
- MySQL `max_connections`: `151`.
- `DB_CONNECTION_LIMIT`: `20`.
- `page_views` total rows after this run: `328449`.
- Token `servertesttoken` total views after this run: `240203`.

Token IP breakdown:

| IP | Total Views | Last 5 Minutes |
| --- | ---: | ---: |
| `192.168.159.1` | 240206 | 148899 |
| `::ffff:127.0.0.1` | 1 | 1 |

## Conclusion

- Deployment is usable through `http://192.168.159.130/`.
- Token enforcement is active and statistics are recorded by token/IP.
- The token validation cache materially improved throughput with zero errors in the tested scenarios.
- Remaining server cleanup: remove or change the old default `novel` Nginx site if localhost-based checks must also point to this app.
