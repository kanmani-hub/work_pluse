# WorkPulse HR — Node.js + Redis Microservice Architecture

This microservice acts as the high-throughput, low-latency companion service for the WorkPulse HR platform. It offloads compute-heavy and real-time operations from PostgreSQL/Supabase, providing sub-millisecond caching, rate-limiting, distributed locks, and geospatial buffering.

---

## 🏛️ Architecture Overview

```
                      +-----------------------------+
                      | React 19 Frontend / Android |
                      +--------------+--------------+
                                     |
              +----------------------+----------------------+
              |                                             |
              v (Heavy Reads / GPS Pings / Punches)         v (Standard CRUD)
+-----------------------------+               +-----------------------------+
|   Node.js Microservice      |               |     Supabase / PostgreSQL   |
|   (Express + TypeScript)    |               |                             |
+--------------+--------------+               +--------------+--------------+
               |                                             ^
               | Redis Protocol                              | Periodic Batch
               v                                             | Flush
+-----------------------------+                              |
|   Redis 7 In-Memory Store   |------------------------------+
|  (Cache, ZSETs, Locks, GEO) |
+-----------------------------+
```

---

## 🚀 Key Modules & Capabilities

### 1. Redis Cache Layer (`src/redis/cacheService.ts`)
- **Pattern**: Cache-aside (`getOrSet`).
- **Use Cases**:
  - Daily Deduction & Net Payroll Impact Reports (`/api/payroll/daily-report`).
  - Organization settings, offices, shift templates, departments.
- **Invalidation**:
  - Selective pattern invalidation via `delByPattern("cache:payroll:daily:YYYY-MM-DD:*")` when attendance is modified or overtime is approved.
  - Non-blocking Redis `SCAN` cursor iteration.
- **Telemetry**: Hit/miss counters, memory usage, key counts at `/api/cache/stats`.

### 2. Distributed Mutex Lock (`src/redis/lockService.ts`)
- **Algorithm**: `SET resource_key token NX PX ttlMs` with atomic Lua script token release:
  ```lua
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
  ```
- **Use Cases**:
  - **Double-punch prevention**: Prevents concurrent race conditions when mobile users tap "Clock In" repeatedly.
  - **Batch payroll locks**: Prevents multiple HR admins from calculating month-end payroll simultaneously.

### 3. Sliding-Window Rate Limiter (`src/redis/rateLimiter.ts`)
- **Algorithm**: Redis Sorted Set (`ZSET`) sliding-window log.
- **Atomic Pipeline**: `ZREMRANGEBYSCORE` -> `ZCARD` -> `ZADD` -> `EXPIRE`.
- **Headers**: Returns `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.
- **Fault-Tolerant**: Fails open with header `X-RateLimit-Degraded: true` if Redis is temporarily offline.

### 4. Geospatial GPS Tracking Buffer (`src/redis/geoService.ts`, `src/services/trackingBufferService.ts`)
- **Ingestion**: Pings are stored in-memory using `GEOADD` and companion hashes (`HSET`).
- **Queries**: Live dashboard queries use `GEORADIUS` / `GEOPOS` without querying PostgreSQL.
- **Persistence**: Pings are pushed to Redis list `queue:gps_breadcrumbs` and flushed in bulk micro-batches (50 items / 15s) to Supabase, saving database IOPS and connection slots.

---

## 📡 API Endpoints Reference

| Method | Endpoint | Description | Redis Mechanism |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Service & Redis health status | `PING` latency test |
| `GET` | `/api/health/redis` | Dedicated Redis ping check | `PING` |
| `GET` | `/api/cache/stats` | Cache hit/miss/memory metrics | In-memory counters + `DBSIZE` |
| `POST` | `/api/cache/invalidate` | Invalidate keys by pattern | `SCAN` + `UNLINK` |
| `POST` | `/api/cache/flush` | Flush all application cache keys | `SCAN` prefix flush |
| `GET` | `/api/payroll/daily-report` | Daily payroll deduction report | `GET` / `SETEX` (600s TTL) |
| `POST` | `/api/payroll/invalidate` | Invalidate cached date | `SCAN` + `DEL` |
| `POST` | `/api/attendance/punch` | Rate-limited & locked clock-in | Mutex `SET NX` + `ZSET` limiter |
| `POST` | `/api/tracking/ping` | Ingest live GPS coordinate | `GEOADD` + Queue push |
| `GET` | `/api/tracking/employee/:id` | Get employee's real-time coords | `GEOPOS` + Hash lookup |
| `GET` | `/api/tracking/nearby` | Find employees within radius | `GEORADIUS` / `GEOSEARCH` |
| `POST` | `/api/tracking/flush` | Manually flush GPS breadcrumbs | `LPOP` batch to PostgreSQL |

---

## 🛠️ Getting Started

### 1. Run Redis with Docker
```bash
docker run -d --name workpulse-redis -p 6379:6379 redis:7-alpine
```
Or start the full stack via Docker Compose:
```bash
docker compose up -d
```

### 2. Run the Microservice in Development Mode
```bash
cd server
npm install
npm run dev
```

### 3. Run Unit & Integration Tests
```bash
cd server
npm test
```

### 4. Build for Production
```bash
cd server
npm run build
npm start
```


## Security hardening (2026-10-22)

- **Roles come from the database.** A bearer token is verified with Supabase, then the role and employee id
  are read from `profiles` → `roles` (same source as the database's `get_auth_role()`). `user_metadata` is
  never used: users can edit it themselves. Requires `SUPABASE_SERVICE_ROLE_KEY`; without it, tokens are
  treated as unauthenticated (fail closed).
- **Test tokens** (`dev-admin-token`, `dev-employee-token`) work only in automated tests, or with
  `NODE_ENV=development` **and** `ALLOW_DEV_TOKENS=true`.
- **CORS** allows only the origins in `CORS_ORIGIN`.
- **Rate limiting** keys on the verified user (or `req.ip`, which honours `X-Forwarded-For` only when
  `TRUST_PROXY` is set).
- **`POST /api/attendance/punch` returns 501 and writes nothing.** Clock-in/out must go through the WorkPulse
  app, which applies shift, geofence, face-verification and automatic-break rules that this service does
  not implement. (Before, it wrote non-existent columns with the service key, bypassing those safeguards.)
- **GPS buffer** writes to `employee_location_history` (history only; it never changes the live location
  that drives automatic breaks). Failed batches are retried in order; after 5 attempts they move to the
  `queue:gps_breadcrumbs:dead` list. Without a database nothing is popped.
- **Payroll daily report** uses `attendance.attendance_date`, `salary_structures` effective on the date and
  the payroll section of `app_settings`; database errors are returned, not cached.
- Tests: `npm test` (the 5 live tests need a Redis at `REDIS_URL`).
