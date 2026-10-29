# QUEUESKIP: COMPLETE MASTER PLAN v3

A full stack movie discovery and ticket booking platform. Users sign up (email with verification, or Google), explore movies with cast, reviews and recommendations, pick a showtime and seats, apply a coupon, pay, and get a QR ticket. Hot releases are protected by a fair waiting room, hence the name.

**This file replaces `queueskip_master_plan_v2.md`, `queueskip_architecture_addendum_v2_1.md` and `queueskip_style_guide_v2_2.md`.** Everything is merged here, adapted to your stack (TypeScript, Express, Mongoose, React) and your coding style. The old files remain useful only for their longer code templates.

Tags: **[DECIDED]** settled so you do not have to think about it, **[PLANNED]** not built yet. Reasons are in *italics*. Targets are goals to measure against, not results.

---

## 0. START HERE

1. Read sections 1 to 5 once (30 minutes). Do not read the rest yet.
2. Do the **Week 0 checklist** (section 17). It takes 2 to 3 days.
3. Then follow the **week-by-week plan** (section 17). Each week has tasks and an exit test. Do not start the next week until the exit test passes.
4. Keep this file open as the reference. Look up a section only when its week arrives.
5. After every week: update the status block (section 18), commit, and write one interview story in `docs/stories.md`.

*The most common way this kind of project fails is building features in parallel and finishing none. Finish slices in order.*

## 1. WHAT YOU ARE BUILDING

**Users**
- **Viewer:** browses movies, reads cast and reviews, gets recommendations, searches (including natural-language AI search), books seats, uses coupons, views tickets, writes reviews, keeps a watchlist.
- **Manager:** manages theatres, screens, shows and pricing, scans tickets at the door.
- **Admin:** manages the movie catalog, coupons and offers, moderates reviews.

**What makes it interview-worthy** (each one is measurable)
1. No double-booking when thousands chase the same seats (atomic updates, Redis plus MongoDB).
2. Safe payments: idempotent checkout, deduplicated webhooks, a late-payment refund path.
3. Distributed rate limiting that is exact across several API instances.
4. A load-balanced, stateless API that survives an instance being killed mid-test.
5. A fair waiting room that turns a traffic spike into a steady flow.
6. Caching done properly: cache-aside, write-behind for counters, Bloom filters against random-ID floods.
7. Real product depth: reviews, coupons, recommendations, AI search, Google sign-in, email verification.

**No real money.** Use the payment provider's **test mode** (Razorpay, since you are in India). *You get realistic webhooks and failures without legal or financial risk.*

## 2. SCOPE TIERS AND THE CUT ORDER

| Tier | Contents | Weeks |
|---|---|---|
| **Tier 1: Booking core** | auth, catalog, shows and seats, holds, orders, payments, tickets, rate limiting, load balancing, load tests, first AWS deploy | 1 to 8 |
| **Tier 2: Product depth** | email verification, Google OAuth, reviews, coupons, real-time seats, Bloom filters | 9 to 12 |
| **Tier 3: Smart features** | write-behind counters, recommendations, AI search, waiting room, polish | 13 to 16 |

Each tier ends with something demoable and deployed. **If you run out of time, cut in this order:** waiting room, AI natural-language search, personal recommendations, write-behind signal stream, manager UI (seed shows by script). **Never cut** holds, orders, payments, tickets, rate limiting, and the load-balanced seat-race test.

## 3. TECH STACK [DECIDED]

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript with ES modules (`import` and `export`), strict compiler settings, current Node LTS | Type safety across the backend, frontend and shared contracts |
| API | Express | matches your code |
| Database | MongoDB with Mongoose, run as a **replica set** | matches your repo and Weebspace. A replica set is required for transactions |
| Cache and critical state | Redis with `ioredis` | holds, queue, rate limits, counters, cache |
| Background jobs | BullMQ (on Redis) | one less service than SQS, retries and delayed jobs built in. SQS is an optional swap behind `queueClient.ts` at deploy time |
| Frontend | React with Vite, React Router, `fetch`, `react-hot-toast` | matches your pages. Create React App is deprecated, so use Vite. No extra data library: stay with `fetch`, `useState`, `useCallback` like your code |
| Auth | JWT access token (in memory) plus httpOnly refresh cookie, `argon2` for passwords, `google-auth-library` for Google | |
| Validation | manual early-return guards for small bodies, `zod` for big ones (orders, coupons, reviews) | |
| Email | `nodemailer`, Mailpit locally, SES on AWS | |
| Payments | Razorpay test mode, a tunnel (ngrok or cloudflared) for webhooks in development | webhooks need a public URL |
| QR | `qrcode` | |
| Tests | Vitest and `supertest` (`*.spec.ts`), k6 for load tests | Vitest handles TypeScript ES modules and uses the same `describe/it/expect` as Jest |
| Quality | Strict TypeScript checks, ESLint with `typescript-eslint`, Prettier (single quotes, semicolons, 2 spaces) | |
| Containers | Docker and Docker Compose, nginx locally as a load balancer | |
| Cloud | AWS: ECS Fargate, ALB, ElastiCache Redis, S3, CloudFront, SES, CloudWatch, Secrets Manager. MongoDB Atlas for the database | Atlas is simpler and more compatible than DocumentDB |
| CI/CD | GitHub Actions | |
| DSA practice | Java (separate from this project) | |

## 4. CLOSED DECISIONS

| Question | Answer |
|---|---|
| REST or action routes? | REST for everything new (`POST /api/watchlist`, `DELETE /api/watchlist/:movieId`) |
| API versioning | none, paths start with `/api/` like yours |
| Success body | the resource itself; lists return `{ movies, page, limit, total }`; actions return `{ message }` |
| Error body | `{ message }`, plus `code` when the frontend must branch (`SEAT_UNAVAILABLE`, `EMAIL_NOT_VERIFIED`, `RATE_LIMITED`, `HOLD_EXPIRED`, `COUPON_INVALID`) |
| Booleans | natural names as in your code: `inWatchlist`, `userWatched`, `showRatingModal`, `loading` |
| Contract names | defined once in `shared/contracts/` and used by backend, frontend and tests |
| Folder names | lowercase package folders (`backend`, `frontend`) as in your repo |
| DB field naming | camelCase (MongoDB handles it, no mapping layer) |
| Hold length | 5 minutes to choose seats; creating an order extends it once to a 10-minute payment window |
| Coupon stacking | one coupon per order, no stacking |
| Seat status storage | only `AVAILABLE` and `SOLD` in MongoDB; `HELD` exists only in Redis with a TTL |
| Seat-map stream | public Server-Sent Events (seat status is not sensitive) |
| Package count | not a monorepo-heavy setup: one root `package.json` with npm workspaces (`backend`, `frontend`, `shared`) |

## 5. ARCHITECTURE

```
React (Vite) ──► nginx / ALB ──► API replicas (Express) ──► MongoDB (replica set)
                                      │   │
                                      │   └──► Redis (critical state)   Redis (cache, Bloom)
                                      │
                                      ├──► BullMQ queues ──► Workers (email, tickets, outbox,
                                      │                      sweeper, flusher, bloom rebuild)
                                      ├──► Google OIDC
                                      ├──► Razorpay (test) ──webhook──► API
                                      └──► LLM / embeddings provider (timeout + fallback)

SSE ◄── Redis pub/sub ◄── seat changes
```

**Layers (imports only go downward)**
`controllers → services → accessors / models / clients`
- **Controller:** read the request, run early-return guards, call one service, shape the response. Same `try/catch` pattern as your code.
- **Service:** the rules (pricing, state machine, limits). No `req` or `res`.
- **Model:** the Mongoose schema. Simple reads can use it directly from a service.
- **Accessor:** the only place for operations that must be **atomic** (seat sale, coupon claim, status transition, Redis scripts). Named for the outcome it guards: `sellSeatsIfAvailable`.
- **Client:** wraps an external system with timeouts, retries and error mapping.

**Two Redis roles, kept apart.** *Mixing "must not lose" data with "may be evicted" data in one Redis is a classic outage.*

| Role | Holds | Eviction |
|---|---|---|
| Critical state | seat holds, waiting room, rate limit buckets, idempotency locks, write-behind buffer, BullMQ queues | `noeviction` (fail loudly, never silently drop a hold) |
| Cache | movie pages, similar lists, trending, AI results, Bloom filters | `allkeys-lru` |

Locally, two Redis containers. On AWS, two separate setups. *Durability options differ by managed service and version, so check the current AWS documentation before depending on any persistence feature.*

## 6. REPOSITORY STRUCTURE

```
queueSkip/
├── backend/
│   ├── src/
│   │   ├── controllers/   authController.ts, movieController.ts, reviewController.ts, watchlistController.ts,
│   │   │                  showController.ts, holdController.ts, orderController.ts, couponController.ts,
│   │   │                  paymentController.ts, ticketController.ts, recommendationController.ts, adminController.ts
│   │   ├── routes/        authRoutes.ts, movieRoutes.ts, ... (one per controller)
│   │   ├── models/        User.ts, OAuthAccount.ts, EmailToken.ts, Movie.ts, Person.ts, Review.ts, Watchlist.ts,
│   │   │                  Theatre.ts, Screen.ts, Show.ts, ShowSeat.ts, Order.ts, Payment.ts, PaymentEvent.ts,
│   │   │                  Ticket.ts, Coupon.ts, CouponRedemption.ts, Offer.ts, Refund.ts, IdempotencyKey.ts,
│   │   │                  OutboxEvent.ts, UserMovieSignal.ts
│   │   ├── services/      authService.ts, holdService.ts, orderService.ts, orderStateMachine.ts, pricingService.ts,
│   │   │                  couponService.ts, reviewService.ts, recommendationService.ts, aiSearchService.ts
│   │   ├── accessors/     holdAccessor.ts, seatAccessor.ts, orderAccessor.ts, couponAccessor.ts, counterAccessor.ts
│   │   ├── clients/       googleOAuthClient.ts, paymentProviderClient.ts, emailClient.ts, queueClient.ts, llmClient.ts
│   │   ├── middleware/    auth.ts, requireRole.ts, requireVerifiedEmail.ts, rateLimiter.ts, idempotency.ts,
│   │   │                  requestId.ts, errorHandler.ts
│   │   ├── cache/         cacheAside.ts, writeBehindBuffer.ts, bloomFilter.ts
│   │   ├── workers/       ticketWorker.ts, emailWorker.ts, outboxPublisher.ts, holdSweeper.ts,
│   │   │                  writeBehindFlusher.ts, bloomRebuildJob.ts, reconciliationJob.ts, embeddingWorker.ts
│   │   ├── lua/           holdSeats.lua, releaseSeats.lua, tokenBucket.lua
│   │   ├── config/        env.ts, db.ts, redis.ts
│   │   ├── constants/     redisKeys.ts, limits.ts, statuses.ts
│   │   ├── utils/         hash.ts, pagination.ts, clock.ts
│   │   ├── app.ts         builds the Express app
│   │   ├── server.ts      starts the API
│   │   └── workerMain.ts  starts the worker process
│   ├── test/              app.spec.ts, authController.spec.ts, holdController.spec.ts,
│   │                      concurrency/ (seatRace.spec.ts, couponRace.spec.ts, webhookReplay.spec.ts), helpers/
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/         HomePage.tsx, MovieDetailPage.tsx, SearchPage.tsx, ShowtimesPage.tsx, SeatSelectionPage.tsx,
│   │   │                  CheckoutPage.tsx, MyTicketsPage.tsx, LoginPage.tsx, RegisterPage.tsx, VerifyEmailPage.tsx,
│   │   │                  WatchlistPage.tsx, AdminPage.tsx, ScannerPage.tsx
│   │   ├── components/    Navbar.tsx, MovieHeader.tsx, MovieSections.tsx, RatingModal.tsx, ReviewList.tsx, SeatMap.tsx,
│   │   │                  CouponInput.tsx, PriceBreakdown.tsx, RecommendationRow.tsx, AiSearchBox.tsx
│   │   ├── context/       AuthContext.tsx
│   │   ├── hooks/         useSeatStream.ts, useHoldTimer.ts, useDebounce.ts
│   │   ├── utils/         index.ts (exports baseURL), formatMoney.ts
│   │   └── App.tsx
│   └── package.json
├── shared/                contracts/ (shared TypeScript types), statuses.ts, errorCodes.ts
├── infra/                 CDK or Terraform
├── loadTests/             seatRace.js, couponRace.js, rateLimitBurst.js, bloomAttack.js, writeBehindFlood.js,
│                          failover.js, sseFanout.js, waitingRoom.js
├── docs/                  designDocs/, decisions/, runbooks/, stories.md
├── docker-compose.yml     mongo (replica set), redisCritical, redisCache, mailpit, nginx + 3 api replicas
└── package.json           workspaces: backend, frontend, shared
```

## 7. STYLE AND NAMING RULES [DECIDED]

1. **Files:** `<thing>Controller.ts`, `<thing>Routes.ts`, `<thing>Service.ts`, `<thing>Accessor.ts`, `<thing>Client.ts`. Middleware is plain camelCase (`auth.ts`). **Mongoose models are PascalCase singular** (`Watchlist.ts`, collection becomes `watchlists`). React pages and components use `.tsx`; hooks and other frontend files use `.ts`.
2. **Handlers:** verb plus noun, camelCase: `holdSeats`, `releaseHold`, `createOrder`, `applyCoupon`, `scanTicket`, `checkWatchlistStatus`. Controllers are named exports with explicit request/response types.
3. **Variables, functions, constants:** camelCase (`maxSeatsPerHold`). **Wire values** (statuses, roles, error codes) are UPPER_SNAKE strings exposed through a camelCase object: `orderStatus.pendingPayment === 'PENDING_PAYMENT'`.
4. **Environment variables** are UPPER_SNAKE in `.env` and read once in `config/env.ts` as camelCase (`env.mongoUri`).
5. **Request context** from `auth.ts`: `req.userId`, `req.userRole`, `req.isEmailVerified`, declared in Express request types.
6. **Controller pattern:** one `try/catch`; guards that each return early with one message; then the service call; then the response. Log as `console.error('Hold seats error:', error)`; answer `500` with `'Server error'`; never return `error.message` to the client.
7. **Messages:** plain sentences, capitalised, no trailing full stop: `'Movie ID is required'`, `'Invalid movie ID format'`.
8. **Contract names are defined once** (`shared/contracts/`). One name per concept everywhere. *Your own watchlist code showed the bug this prevents: the backend sent `isInWatchlist` while the page read `inWatchlist`.*
9. **Formatting:** single quotes, semicolons, 2 spaces (`.prettierrc`: `{ "singleQuote": true, "semi": true, "tabWidth": 2 }`).
10. **URLs** are lowercase kebab-case; query params camelCase (`?pageSize=20`).
11. **Redis keys:** camelCase words joined by `:`, hash tag around the show id (`hold:{showId}:{seatId}`), all defined in `constants/redisKeys.ts`.

**Controller template (copy for every new handler):**

```ts
import type { Request, Response } from 'express';

type AuthenticatedRequest = Request & { userId: string };

export const holdSeats = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { showId, seatIds } = req.body;

    if (!showId || !Array.isArray(seatIds) || seatIds.length === 0) {
      return res.status(400).json({ message: 'Show ID and seat IDs are required' });
    }

    if (!mongoose.Types.ObjectId.isValid(showId)) {
      return res.status(400).json({ message: 'Invalid show ID format' });
    }

    const result = await holdSeatsForUser({ userId, showId, seatIds });

    if (!result.held) {
      return res.status(409).json({ code: 'SEAT_UNAVAILABLE', message: 'One or more seats are no longer available' });
    }

    res.status(201).json({ holdId: result.holdId, expiresAt: result.expiresAt });
  } catch (error) {
    console.error('Hold seats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
```

## 8. GLOBAL CONVENTIONS

- **Status codes:** 400 validation, 401 not authenticated, 403 not allowed (including `EMAIL_NOT_VERIFIED`), 404 missing, 409 conflict (seat taken, state clash, duplicate), 410 hold expired, 422 business rule failed (coupon invalid), 429 rate limited, 503 dependency down.
- **Pagination on every list:** `?page=1&limit=20`, maximum 100. Response `{ movies, page, limit, total }` (key named after the resource).
- **Idempotency:** the `Idempotency-Key` header is required on `POST /api/orders` and `POST /api/orders/:id/pay`. Same key and same body returns the original response; same key with a different body returns 422.
- **Money:** integers in the smallest unit (`priceMinor`, paise) plus a currency code. Never floats.
- **Time:** UTC. The server decides hold and order expiry, never the client's clock.
- **Config:** `config/env.ts` validates every environment variable at startup and fails fast.
- **Request ids:** every request gets an id (`requestId.ts`), logged and returned in `X-Request-Id`.
- **Secrets:** `.env` is git-ignored; commit only `.env.example`. JWT secrets are 32+ random characters.
- **User text** (reviews, bios) is stored as plain text and rendered as text.
- **Wrong ids:** every `:id` path parameter is checked with `mongoose.Types.ObjectId.isValid` before any query.

## 9. DATA MODEL (Mongoose collections)

Indexes are listed as `unique` or `index`. Embed what is read together; keep separate what grows or is queried alone.

```
User            name, email (unique), emailVerified, passwordHash (null for Google-only), role USER|MANAGER|ADMIN,
                tokenVersion, createdAt
OAuthAccount    userId, provider, providerUserId (Google "sub"), email      unique(provider, providerUserId)
EmailToken      userId, type VERIFY|RESET, tokenHash (unique), expiresAt (TTL index), usedAt

Movie           title, synopsis, runtimeMin, language, releaseDate, certification, posterUrl, trailerUrl, status,
                genres [String], cast [{ personId, name, characterName, billingOrder }], crew [{ personId, name, job }],
                ratingSum, ratingCount, ratingAvg, viewCount, embedding [Number], embeddingModel
                indexes: text(title, synopsis), (status, releaseDate), genres
Person          name, bio, photoUrl
Review          movieId, userId, rating 1-10, title, body, helpfulCount, verifiedViewer, createdAt   unique(movieId, userId)
ReviewVote      reviewId, userId                                            unique(reviewId, userId)
Watchlist       userId, movieId, createdAt                                  unique(userId, movieId)
UserMovieSignal userId, movieId, type, weight, createdAt                    index(userId, createdAt)

Theatre         managerId, name, city, address
Screen          theatreId, name, layout { sections: [{ name, rows, seatsPerRow, tier }] }
Show            movieId, screenId, theatreId, startsAt, endsAt, status, highDemand, priceTiers [{ tier, priceMinor }]
                indexes: (movieId, startsAt), (theatreId, startsAt)
ShowSeat        showId, section, row, number, tier, priceMinor, status AVAILABLE|SOLD, orderId
                unique(showId, section, row, number); index(showId, status)

Order           userId, showId, status, items [{ showSeatId, priceMinor }], subtotalMinor, feeMinor, discountMinor,
                totalMinor, currency, couponId, holdId, expiresAt, history [{ from, to, reason, at }], createdAt
                index(userId, createdAt)
Payment         orderId, provider, providerRef (unique), status, amountMinor, createdAt
PaymentEvent    providerEventId (unique), payload, processedAt              (webhook dedupe)
Refund          orderId, paymentId, status, amountMinor
Ticket          orderId, showSeatId, qrToken, usedAt                        unique(orderId, showSeatId)
Coupon          code (unique), type PERCENT|FLAT, value, maxDiscountMinor, minOrderMinor, validFrom, validTo,
                maxTotalUses, usedCount, maxUsesPerUser, firstBookingOnly, rules { movieIds, theatreIds, days },
                enabled, ownerTheatreId
CouponRedemption couponId, userId, orderId, status RESERVED|COMMITTED|RELEASED   unique(couponId, orderId)
Offer           title, description, couponId, rules, validFrom, validTo

IdempotencyKey  userId, key, endpoint, requestHash, response, createdAt (TTL 24h)   unique(userId, key, endpoint)
OutboxEvent     type, payload, createdAt, publishedAt                       (TTL after published)
```

Use TTL indexes for `EmailToken`, `IdempotencyKey` and published `OutboxEvent`: MongoDB deletes them for you.

## 10. FEATURE SPECIFICATIONS

### 10.1 Auth, email verification, Google sign-in

```
POST /api/auth/register          { name, email, password }
POST /api/auth/login             { email, password }
POST /api/auth/logout
POST /api/auth/refresh
GET  /api/auth/me
POST /api/auth/verify-email      { token }
POST /api/auth/resend-verification   { email }      generic response
POST /api/auth/forgot-password       { email }      generic response
POST /api/auth/reset-password        { token, newPassword }
GET  /api/auth/google            redirect to Google
GET  /api/auth/google/callback   Google redirects here
```

**Sessions**
- Short-lived access token (about 15 minutes) kept in memory in `AuthContext` and sent as `Authorization: Bearer`. Long-lived refresh token in an httpOnly, sameSite cookie. On page load the app calls `/api/auth/refresh` to restore the session.
- Tokens carry `tokenVersion`, checked against the database. Logout, password change and reset bump it and end every session.
- JWT verification pins `algorithms: ['HS256']`. Passwords use `argon2`. `ADMIN` and `MANAGER` can never be self-registered; the first admin comes from `ADMIN_EMAIL`.

**Email verification**
- Register creates the user with `emailVerified: false`, a random 32-byte token (only its **SHA-256 hash** stored, 24-hour expiry, single use), and enqueues an email job.
- The email link opens a frontend page that calls `POST /verify-email`. *A link that changes state on GET can be triggered by mail scanners and link previews.*
- Unverified users can browse but cannot hold seats, book, or review: `403` with `code: 'EMAIL_NOT_VERIFIED'` (the page offers "resend email").
- `resend-verification` and `forgot-password` always return the same message whether or not the email exists. *This prevents account enumeration.* Rate limit both (3 per hour per email and IP). Reset tokens expire in 30 minutes and bump `tokenVersion`.
- Email is sent by a worker, never inside the request.

**Google OAuth (OpenID Connect, authorization code flow with PKCE)**
1. `GET /auth/google`: create `state`, `nonce` and a PKCE `code_verifier`, keep them in a short-lived signed httpOnly cookie, redirect to Google with scopes `openid email profile`.
2. Callback: check `state`, exchange the `code` **on the server** with the client secret, then **validate the ID token** (signature, `iss`, `aud` equals your client id, `exp`, `nonce`).
3. Require `email_verified: true` in the token.
4. Find the person by **Google `sub`** through `OAuthAccount`, never by email alone (emails can change).
   - New identity and no account with that email: create a user with `emailVerified: true` and no password.
   - A **verified** local account has the same email: link the Google identity to it.
   - An **unverified** local account has the same email: link it, **delete its password hash and bump `tokenVersion`**. *This blocks pre-hijacking, where an attacker registers with a victim's email before the victim signs in with Google.*
5. Issue your own refresh cookie and redirect to the frontend. Redirect URIs are exact matches in the Google Cloud console; use separate OAuth clients for dev and production. Never log tokens, codes or the client secret.

### 10.2 Movie catalog, cast, search

```
GET   /api/movies?genre=&language=&status=NOW_SHOWING|UPCOMING&sort=&page=&limit=
GET   /api/movies/:id                details, top 10 cast, genres, rating summary
GET   /api/movies/:id/cast           full cast and crew
GET   /api/people/:id                bio and filmography
GET   /api/genres
GET   /api/search?q=                 titles, people, genres (MongoDB $text index)
POST  /api/movies                    ADMIN
PATCH /api/movies/:id                ADMIN
PUT   /api/movies/:id/cast           ADMIN (replace cast with billing order)
```

- **Data:** seed with fictional or sample movies. If you use a public data source, read its terms and follow its attribution rules. Use placeholder posters on any public demo. Never host copyrighted posters or trailers.
- Movie detail and list responses are cached (cache-aside, section 12.7).
- Bloom filter protects `GET /movies/:id` from random ids (section 12.5).

### 10.3 Watchlist

```
GET    /api/watchlist
POST   /api/watchlist                 { movieId }
DELETE /api/watchlist/:movieId
GET    /api/watchlist/:movieId/status   → { inWatchlist: true | false }
```

Adding is an upsert on the unique `(userId, movieId)`. Removing returns 404 when nothing was deleted (`deletedCount === 0`). Adding also records a recommendation signal.

### 10.4 Reviews and ratings

```
GET    /api/movies/:id/reviews?sort=recent|helpful|rating&page=&limit=
PUT    /api/movies/:id/reviews/me      { rating, title?, body }     create or update
DELETE /api/movies/:id/reviews/me
POST   /api/reviews/:id/helpful        toggle
POST   /api/reviews/:id/report         { reason }
```

- **One review per user per movie** (unique index); PUT is an upsert. Duplicate-key error `11000` becomes 409.
- Needs a verified email. A **"verified viewer"** badge is computed (a CONFIRMED order for a past show of that movie), never self-declared.
- **Aggregates are atomic:** `Movie.updateOne({ _id }, { $inc: { ratingSum: delta, ratingCount: n } })`, and `ratingAvg` is derived. Never read, change and save. A nightly job recomputes from the source reviews to repair drift.
- Length limits, rate limits, plain text only. Reports go to an admin queue.

### 10.5 Theatres, screens, shows, seat map

```
GET  /api/theatres?city=
POST /api/theatres                          MANAGER
POST /api/theatres/:id/screens              MANAGER   { name, layout }
POST /api/shows                             MANAGER   { movieId, screenId, startsAt, priceTiers }
GET  /api/movies/:id/shows?city=&date=      grouped by theatre
GET  /api/shows/:id
GET  /api/shows/:id/seats                   seat map with live status
GET  /api/shows/:id/stream                  SSE (section 10.9)
POST /api/shows/:id/cancel                  owner, triggers refunds
POST /api/shows/:id/scan                    MANAGER or STAFF  { qrToken }
```

- Creating a show **generates one `ShowSeat` per seat** from the screen layout, with its tier and price. Layout and prices freeze after the first order. Overlapping shows on a screen return `409`.
- `GET /seats` merges MongoDB (`SOLD`) with Redis (held) into `AVAILABLE | HELD | SOLD`. Cache the static layout, never the status.

### 10.6 Seat holds (core problem 1)

```
POST   /api/holds           { showId, seatIds }   → { holdId, expiresAt }
DELETE /api/holds/:holdId
```

**Rule: Redis is the fast gate, MongoDB is the final judge.**
- Maximum seats per hold (for example 6), maximum active holds per user, verified email required.
- One **Lua script** checks all requested seats and sets them all, or none. *A loop of `SET NX` calls from Node can leave a half-held group.*
- Keys `hold:{showId}:{seatId}` hold `holdId:userId` with a 5-minute TTL. Also `holdSet:{showId}:{holdId}` and `userHolds:{userId}`.
- Release uses compare-and-delete in Lua. *User A's expired hold must never delete user B's new hold.*
- Every change publishes to `chan:show:{showId}` for live updates.
- If Redis is down, holds are disabled (browsing still works) and the API returns 503. Seats are never sold without the database check.

### 10.7 Orders, pricing, coupons (core problem 2)

```
POST   /api/orders                  { holdId, couponCode? }    Idempotency-Key required
GET    /api/orders
GET    /api/orders/:id
POST   /api/orders/:id/coupon       { code }
DELETE /api/orders/:id/coupon
POST   /api/orders/:id/pay          Idempotency-Key required → payment session
POST   /api/orders/:id/cancel
```

**State machine**
```
PENDING_PAYMENT ──paid──► PAID ──tickets issued──► CONFIRMED
      │                    │
      ├─expired────► EXPIRED          CONFIRMED ──cancel──► REFUND_PENDING ──► REFUNDED
      ├─cancelled──► CANCELLED
      └─failed─────► FAILED (seats released)
```
- All transitions go through `orderStateMachine.ts`. Each is a conditional update (`findOneAndUpdate({ _id, status: expected }, ...)`), so two racing events cannot both win. A `null` result means someone else already moved it.
- **Price is recomputed on the server:** seat prices plus convenience fee minus coupon discount (capped, never below zero). The order stores a price snapshot. Never trust a price from the client.
- Creating an order extends the hold once to the payment window and sets `order.expiresAt`.
- **Selling seats** runs in one MongoDB transaction: `ShowSeat.updateMany({ showId, _id: { $in }, status: 'AVAILABLE' }, { $set: { status: 'SOLD', orderId } }, { session })`. If `modifiedCount` does not equal the seat count, abort and return 409.
- **Coupon rules** (checked when applied and again at order creation): exists and enabled, inside its validity window, minimum order met, movie/theatre/day rules match, per-user and global limits not exceeded, first-booking rule satisfied, one coupon per order.
- **Atomic coupon claim:**
  ```js
  Coupon.findOneAndUpdate(
    { _id: couponId, enabled: true, $expr: { $lt: ['$usedCount', '$maxTotalUses'] } },
    { $inc: { usedCount: 1 } },
    { new: true, session }
  );
  ```
  `null` means no uses left. A redemption is **RESERVED** when applied, **COMMITTED** on `PAID`, and **RELEASED** (`usedCount` decremented) on `EXPIRED`, `CANCELLED` or `FAILED`, inside the same transition function so it cannot be forgotten.
- Rate limit coupon attempts and return the same generic error for unknown and invalid codes. *Otherwise attackers can guess valid codes.*
- `GET /api/offers` returns display offers (for example "20% off Tuesday shows"). Auto-applied offers go through the same pricing function.

### 10.8 Payments, tickets, entry scanning

```
POST /api/webhooks/payments           provider to server, signature verified, no user auth
GET  /api/orders/:id/tickets
GET  /api/tickets/:id                 own ticket with QR payload
```

- Create a payment session for the order total with the order id as reference and a short expiry.
- **Verify the webhook signature** on the raw body. **Dedupe** by the provider's event id (`PaymentEvent`, unique): providers deliver at least once and out of order.
- In one transaction: payment `SUCCEEDED`, order `PENDING_PAYMENT → PAID`, and an `OutboxEvent` inserted. **Never trust the browser redirect** as proof of payment.
- **Late payment:** the user pays after the hold expired. Try to re-sell the same seats with the conditional update. If free, confirm. If someone else took them, **refund automatically** and notify. Write an explicit test.
- **Transactional outbox:** a publisher moves unpublished outbox rows to the BullMQ queue and marks them published. *This keeps "order is PAID" and "ticket job queued" from drifting if the process crashes between the two.*
- **Ticket worker:** consumes `order.paid`, creates one ticket per seat (unique `(orderId, showSeatId)` makes it idempotent), signs a QR token (JWT with `ticketId`, `showId`, expiry), renders the QR, sends the email.
- **Scan:** verify the signature, then `Ticket.findOneAndUpdate({ _id, usedAt: null }, { $set: { usedAt: new Date() } })`. `null` means a duplicate scan. *One atomic statement prevents two doors admitting the same ticket.*
- **Show cancellation:** all paid orders move to `REFUND_PENDING` with one refund job each, retried with backoff and a failed-jobs set.

### 10.9 Real-time seat updates

```
GET /api/shows/:id/stream      Server-Sent Events
```
- Every seat change publishes `{ seatId, status }` to Redis. Each API replica subscribes and pushes to its own connected clients. *No replica has to know about the others.*
- Batch updates and push every 100 to 250 ms. Send a heartbeat comment every 15 to 30 seconds. On reconnect the client refetches full seat status. The stream is a hint; the server stays the authority when a user tries to hold.

### 10.10 Recommendations

```
GET  /api/movies/:id/similar
GET  /api/me/recommendations
GET  /api/recommendations/trending?city=
```

- **Level 1, genre similarity:** Jaccard overlap of genres plus small bonuses for shared language, director and lead cast, then popularity. Cached per movie for hours.
- **Level 2, personal taste:** signals (booked = strong, rated high = strong, rated low = negative, watchlisted = medium, viewed = weak) with time decay build a genre affinity vector per user. Score = `0.5 * genre affinity + 0.3 * similarity to liked movies + 0.2 * popularity`. Exclude booked movies. Re-rank for diversity so the top 10 is not one genre.
- **Cold start:** new users and new movies fall back to trending and genre results. Say so in the README.
- A worker refreshes profiles and caches each user's top results in Redis.
- **Evaluate it:** hold out each seeded user's last booking and measure hit-rate@10 against a popularity baseline. Synthetic seed data limits what the result proves, so say that too.

### 10.11 AI features

*Principle: AI enhances the catalog, it never replaces it. Every result is a real movie id from your database.*

- **Embeddings:** a worker embeds each movie (title, synopsis, genres, top cast) and stores the vector with the model name and version. For a catalog of a few thousand movies, compute cosine similarity in Node and cache the result; use Atlas Vector Search only if you want it.
- **Natural-language search** `POST /api/search/ai { query }`: the model returns JSON only (`genres`, `languages`, `maxRuntime`, `yearRange`, `moodText`). **Validate it with zod.** Run a MongoDB filter, then rank by vector similarity to `moodText`. Optionally return a one-line reason built from catalog fields only.
- **Fallback:** on timeout (about 3 seconds), error or invalid JSON, run normal keyword search. The feature degrades, it never breaks.
- **Controls:** cache by normalized query, rate limit per user, a daily token budget, log tokens and estimated cost. Treat the user's text as data, never as instructions. Send no personal data (names, emails) in prompts. Never execute anything the model returns.
- **"Because you watched X"** explanations are templated from signals, not generated.

### 10.12 Waiting room (core problem 3)

```
POST /api/shows/:id/queue/join
GET  /api/shows/:id/queue/status     → { position, etaSeconds, admitted }
```
- Redis sorted set `queue:{showId}` scored by join time; position is `ZRANK`. A scheduler admits a fixed number per second and issues a short-lived signed **admission token**. Only token holders may call the hold endpoint for a `highDemand` show.
- Fairness: one entry per user, rate-limited joins, drop users who stop polling. Show position and a rough ETA, never a promise. *This turns an uncontrolled spike into a steady flow, which is backpressure.*

### 10.13 Admin and manager

```
POST/PATCH /api/admin/coupons, GET /api/admin/coupons, GET /api/admin/coupons/:id/stats
GET /api/admin/reviews/reported, PATCH /api/admin/reviews/:id      (hide or restore)
GET /api/admin/stats
```
A manager UI for shows is optional: seed shows by script if time is short.

## 11. FRONTEND PLAN

**Rules:** access token only in `AuthContext` memory, never `localStorage`. Requests use `credentials: 'include'`. On 401 call refresh once, retry, otherwise go to `/login`; never loop. Show `EMAIL_NOT_VERIFIED` with a "resend email" action. Send an `Idempotency-Key` (one UUID per checkout attempt) on order and pay calls. Countdown uses the server's `expiresAt`. Seat selection is optimistic and rolls back on 409. Accessible seat map (keyboard, text labels, not colour alone). Skeletons, empty states and error states everywhere.

| Step | Pages and components |
|---|---|
| 1 | Vite setup, `AuthContext`, `Navbar`, router, `utils/index.ts` |
| 2 | `LoginPage`, `RegisterPage`, "check your email" and `VerifyEmailPage`, Continue with Google |
| 3 | `HomePage`: now showing, upcoming, offers, genre rows |
| 4 | `MovieDetailPage`: `MovieHeader`, `MovieSections`, cast strip, rating summary, watchlist button, "more like this" |
| 5 | Reviews: `ReviewList`, `RatingModal`, helpful vote, report |
| 6 | `SearchPage` with filters, `AiSearchBox` |
| 7 | `ShowtimesPage` by theatre and date |
| 8 | `SeatSelectionPage` with `SeatMap`, `useSeatStream`, waiting room screen |
| 9 | Hold flow with `useHoldTimer` |
| 10 | `CheckoutPage`: `CouponInput`, `PriceBreakdown`, payment (test mode), result and failure states |
| 11 | `MyTicketsPage` (QR), order history, `WatchlistPage`, profile |
| 12 | `AdminPage`, `ScannerPage` |

Each page is built against the real API with loading, empty and error states, readable on a phone.

## 12. SCALE CONCEPTS

### 12.1 Redis key catalog (all keys, kept in `constants/redisKeys.ts`)

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `hold:{showId}:{seatId}` | string `holdId:userId` | 300 s | seat hold |
| `holdSet:{showId}:{holdId}` | set | 300 s | seats of a hold |
| `userHolds:{userId}` | set | 300 s | max active holds |
| `rl:{policy}:{identifier}` | hash | 2x refill time | token bucket |
| `queue:{showId}` | sorted set | until show end | waiting room |
| `admit:{showId}:{userId}` | string | 600 s | admission token |
| `idem:{userId}:{key}` | string | 24 h | in-flight idempotency lock |
| `movie:{id}` | JSON | 60 s | cache-aside |
| `similar:{id}` | JSON | 6 h | similar list |
| `recs:{userId}` | JSON | 1 h | personal recommendations |
| `trending:{city}` | sorted set | 10 min | most booked |
| `aiSearch:{queryHash}` | JSON | 1 h | AI search cache |
| `bloom:{name}` | bitmap | rebuilt nightly | Bloom filters |
| `wb:viewCounts:{bucket}` | hash | flushed | write-behind counters |
| `wb:signals` | stream | trimmed | write-behind signals |
| `chan:show:{showId}` | pub/sub | n/a | live seat updates |

Every key has a TTL unless it is explicitly flushed or rebuilt. Never use `KEYS *`; use `SCAN`. All keys one Lua script touches share a hash tag so they sit in one cluster slot.

### 12.2 Atomic updates

**Rule: never read a value, change it in application code, then write it back.** Push the read-modify-write into one atomic operation where the data lives.

| Operation | Mechanism | Invariant |
|---|---|---|
| Hold seats | Redis Lua, all or none | nobody holds a seat twice, no half-held group |
| Release hold | Lua compare-and-delete | an expired hold never deletes another user's hold |
| Sell seats | `updateMany` with `status: 'AVAILABLE'` in a transaction, `modifiedCount` checked | a seat is sold at most once |
| Order transition | `findOneAndUpdate({ _id, status: expected })` | racing events cannot both win |
| Claim coupon use | `findOneAndUpdate` with `$expr` on `usedCount` | the last use goes to one person |
| Rating totals | `$inc` | no lost update |
| Rate limit | Lua token bucket | exact across replicas |
| Idempotency | `SET NX EX`, then a unique index | a double click creates one order |
| Scan ticket | `findOneAndUpdate({ _id, usedAt: null })` | one admission per ticket |
| Claim a job | `findOneAndUpdate({ status: 'PENDING' }, { $set: { status: 'PROCESSING' } })` | two workers never take one job |
| Counter | `HINCRBY` | exact counts without locks |

Rules: name accessor methods for the guarded outcome; **check the result every time** (`modifiedCount`, a `null` return, a script return value); multi-document changes use one transaction; every row above gets a concurrency test (200 parallel requests, then assert the invariant).

**Lua scripts**

`lua/holdSeats.lua`:
```lua
-- KEYS: one key per seat (same hash slot). ARGV[1] = holdValue, ARGV[2] = ttlSeconds
for i = 1, #KEYS do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    return { 0, i }
  end
end
for i = 1, #KEYS do
  redis.call('SET', KEYS[i], ARGV[1], 'EX', ARGV[2])
end
return { 1, 0 }
```

`lua/releaseSeats.lua`:
```lua
-- KEYS: seat keys. ARGV[1] = holdValue
local released = 0
for i = 1, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then
    redis.call('DEL', KEYS[i])
    released = released + 1
  end
end
return released
```

`lua/tokenBucket.lua`:
```lua
-- KEYS[1] = bucket key. ARGV[1] = capacity, ARGV[2] = refillPerSecond, ARGV[3] = cost
local t = redis.call('TIME')
local nowMs = t[1] * 1000 + math.floor(t[2] / 1000)
local data = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = capacity; ts = nowMs end
local elapsed = math.max(0, nowMs - ts)
tokens = math.min(capacity, tokens + (elapsed / 1000) * refill)
local allowed = 0
local retryAfterMs = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryAfterMs = math.ceil(((cost - tokens) / refill) * 1000)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', nowMs)
redis.call('PEXPIRE', KEYS[1], math.ceil((capacity / refill) * 1000) * 2)
return { allowed, math.floor(tokens), retryAfterMs }
```

### 12.3 Rate limiting

**Layers:** edge (CloudFront and AWS WAF rate rules) → load balancer (timeouts, body size) → **application (Redis token bucket, this section)** → business caps (seats per order, holds per user, coupon attempts).

**Middleware** (`middleware/rateLimiter.ts`) exports `createRateLimiter({ name, capacity, refillPerSecond, failOpen, getIdentifier })` and ready-made limiters (`loginLimiter`, `holdLimiter`, ...). It calls the Lua script once per request, sets `X-RateLimit-Limit` and `X-RateLimit-Remaining`, and on rejection sets `Retry-After` and answers `429` with `code: 'RATE_LIMITED'`. Attach limiters per route in the routes file. Identify by user id when logged in, otherwise by IP. Behind a balancer, set `app.set('trust proxy', hops)` so `req.ip` is the client.

| Endpoint group | Key | Limit | If Redis is down |
|---|---|---|---|
| Login | IP | 5 per minute | **fail closed** |
| Register | IP | 3 per hour | fail closed |
| Resend verification, forgot password | email and IP | 3 per hour | fail closed |
| Coupon apply | user and IP | 10 per minute | fail closed |
| Create hold | user | 10 per minute | fail open (low in-process cap) |
| Waiting room join | user and show | 1 per show | fail open |
| Search | IP | 60 per minute | fail open |
| AI search | user | 5 per minute plus daily token budget | **fail closed** (costs money) |
| Review write | user | 10 per hour | fail open |
| Whole API | IP | 300 per minute | fail open |

*Security and cost endpoints fail closed; browsing fails open. Be ready to defend that split.*

**Tests:** 1,000 concurrent requests against a limit of 100 allow exactly 100; refill allows the right amount after waiting; two replicas share one limit; Redis stopped, login fails closed and browsing fails open; every limited route has a test that sends limit + 1 requests and expects 429.

### 12.4 Load balancing

- **Principle:** API replicas are stateless. All state lives in MongoDB and Redis. No in-memory sessions, no local-disk uploads, no per-replica counters.
- **Local:** nginx with `least_conn` in front of 3 API containers. Add an `X-Served-By` header so you can see the spread. The seat-stream location sets `proxy_buffering off` and a long `proxy_read_timeout`. Kill one replica mid-test and show the error rate stays low. Note: the MongoDB replica set member name must be resolvable by every client; run the API on the host in early weeks, and record this in `docs/decisions/`.
- **AWS:** Application Load Balancer across at least two Availability Zones, health check on `/readyz` (database and Redis reachable), minimum 2 tasks, autoscaling on requests per target and CPU. Try round robin and **least outstanding requests**, and keep the one that measures better. No sticky sessions. Deregistration delay matches the app's graceful-shutdown time (finish in-flight requests, then exit). Raise the ALB idle timeout above the SSE heartbeat.
- **Retries:** only idempotent requests are retried. Orders and payments are safe to retry because of the `Idempotency-Key`.
- **Tests:** even spread over 3 replicas; failover with one replica killed; rolling deploy with zero dropped requests; scale-out under load; and the **5,000 users versus 200 seats** test passing through the balancer with 3 replicas.

### 12.5 Bloom filters

A Bloom filter answers "have I seen this value?" in very little memory. **"Definitely not" is always right. "Maybe" can be wrong.** *Rule: trust a "no" and skip the database; a "maybe" always falls through to the real check.*

| Use | Contains | Saves |
|---|---|---|
| Cache-penetration shield for `GET /movies/:id`, `/people/:id`, `/shows/:id` | all valid ids | random or attacker-chosen ids never reach MongoDB |
| Coupon code pre-check | all existing codes | brute-force guessing never hits the database |
| Webhook dedupe first pass | processed provider event ids | most duplicates rejected before a query (the unique index is still the truth) |

Do **not** use one for "is this email registered?" (account enumeration).

**Sizing:** `m = -(n × ln p) / (ln 2)²` bits, `k = (m / n) × ln 2` hashes. One million ids at 1% needs about 9.6 bits each, roughly 1.2 MB and 7 hashes.

**Build order:** (1) your own filter on Redis bitmaps (`SETBIT`, `GETBIT`, double hashing); (2) the RedisBloom module if you want it, but **module support differs by managed service and version, so check current AWS documentation**; (3) an in-process filter for tiny sets.

**Lifecycle rules:** no deletes (a deleted id stays "maybe" until the nightly rebuild, which is safe); rebuild nightly into a new key and swap with `RENAME`; **add to the filter before the create commits** so a new record can never get a false "no"; an empty or cold filter answers "maybe" for everything; track the real false-positive rate against your target.

**Tests:** seed 100,000 ids and probe with 1,000,000 random ones (zero false negatives, false-positive rate near target, database queries avoided); `bloomAttack.js` floods random ids and compares database query rate with and without the filter; create-then-read race never returns a false 404.

### 12.6 Write-behind caching

Write to Redis now, flush to MongoDB later in batches.

| Strategy | Use here |
|---|---|
| Cache-aside | movie detail, similar lists, trending, AI results |
| Write-through | small reference data (genres, offers) |
| **Write-behind** | view counts, click and watchlist signals, last-seen timestamps |

**Never** use write-behind for seats, orders, payments, coupons or ticket scans. Those use atomic database updates.

**Counter pattern:** the API runs `HINCRBY wb:viewCounts:{bucket} {movieId} 1`. Every few seconds the flusher does an atomic `RENAME` of a closed bucket to `wb:processing:{bucket}` (no increment is lost between read and clear), inserts a unique `batchId` marker first (so a retried flush skips batches already applied), then writes `Movie.bulkWrite([{ updateOne: { ..., update: { $inc: { viewCount: delta } } } }])`, then deletes the processing key. A leftover processing key is retried after a crash.

**Signal pattern (optional):** `XADD wb:signals` from the API; a consumer group reads batches, inserts into `UserMovieSignal` idempotently, and acknowledges. Unacknowledged entries are retried; poison entries go to a dead-letter stream. Flush on whichever comes first: N entries or T seconds.

**Trade-offs to state honestly:** if Redis loses the buffer before a flush, those counts are lost (bounded by the flush interval); the database is behind by up to one interval; only commutative operations (increments, inserts) can be batched; cap the buffer and alert if the flusher falls behind. Displayed counts are `databaseValue + pendingDelta` or a few seconds stale, whichever you document.

**Tests and metrics:** `writeBehindFlood.js` sends 20,000 views per second for 60 seconds and reports the reduction in database writes; a crash test kills the flusher mid-batch and asserts the final count equals requests sent (no loss, no double count); a Redis restart test measures the real loss window.

### 12.7 Caching summary

Cache-aside for movie list, detail, similar, trending and AI results with the TTLs in the key catalog; invalidate on admin update. Cache static seat layout for a long time; **never cache seat status** beyond a second or two. Measure hit ratio and latency before and after, and report the numbers.

## 13. SECURITY CHECKLIST

- Passwords hashed (argon2); JWT algorithm pinned; httpOnly sameSite refresh cookie; CORS allow-list; `helmet`; request size limits.
- Email and reset tokens: random, hashed at rest, expiring, single use; generic responses against enumeration.
- OAuth: `state`, `nonce`, PKCE, server-side code exchange, ID token validation, `email_verified` required, exact redirect URIs, link by `sub`, the pre-hijacking rule.
- Verify webhook signatures on the raw body. Parameterised queries only: never build a MongoDB filter from raw request objects (strip or reject `$` operators, for example with `express-mongo-sanitize` or explicit field picking).
- Authorization lives in services and is tested per role (user A cannot read, pay or cancel user B's order).
- QR tokens are signed and checked on scan. User text is rendered as text.
- No personal data in AI prompts; model output validated; budgets and timeouts.
- Never log passwords, tokens, codes, secrets or card data (you never touch card data: the provider hosts the payment page).
- Account deletion and data export for users.

## 14. TESTING STRATEGY

- **Unit:** pure logic (`orderStateMachine`, `pricingService`, coupon rules, recommendation scoring).
- **Integration:** real MongoDB replica set and Redis from Docker Compose, through `supertest`. Every write endpoint has a test that **reads the database afterwards**.
- **Concurrency** (`backend/test/concurrency/`): seat race, coupon race, webhook replay, double-click pay, scan race.
- **Contract:** frontend and backend read field names from `shared/contracts/`.
- **Load** (`loadTests/`, k6): see section 15.
- CI runs ESLint, Prettier check and the test suite on every pull request using Docker Compose.

## 15. LOAD TESTS (record your real numbers)

1. **Headline:** 5,000 virtual users compete for 200 seats through the balancer with 3 replicas. Exactly 200 sold, zero double bookings, every loser gets a clean 409.
2. **Coupon race:** 1,000 users, a coupon with 50 uses, exactly 50 redemptions.
3. **Rate limit burst:** exact allow counts shared across replicas.
4. **Hold expiry:** 1,000 holds expire, seats return, the sweeper finds nothing to repair.
5. **Duplicate payments:** the same webhook replayed 50 times produces one `PAID` transition; the same `Idempotency-Key` 20 times produces one order.
6. **Bloom attack:** random-id flood with and without the filter.
7. **Write-behind flood:** database writes with and without buffering, plus the crash test.
8. **Failover:** kill a replica mid-run; rolling deploy under traffic.
9. **Redis down mid-run:** no seat sold twice, graceful degradation.
10. **SSE fan-out:** 5,000 clients on one show, measure update delay.
11. **Waiting room:** 10,000 joins, verify drain rate and fairness.
12. **AI search under load** with the model stubbed slow or failing: the fallback keeps p95 acceptable.

**Targets (goals):** p95 hold latency under 100 ms at 1,000 requests per second on a small instance; zero invariant violations in every concurrency test. For each test, write down the first bottleneck you found and what you changed.

## 16. OBSERVABILITY AND DEPLOYMENT

**Metrics:** requests per second, status counts, p50/p95/p99 per endpoint, active holds, hold conflicts, orders by status, coupon redemptions and rejections, webhook lag, queue depth, failed jobs, cache hit ratio, Bloom false-positive rate, write-behind buffer age, SSE connections, AI fallback rate and cost per request. Use `prom-client` locally and CloudWatch on AWS. **Alarms:** 5xx rate, p99 latency, failed-jobs count, webhook failures, Redis connection errors, email bounce rate.

**AWS layout**
```
Route 53 → CloudFront → S3 (React build)
                      → ALB → ECS Fargate: API (N tasks)
                              ECS Fargate: workers (email, tickets, outbox, sweeper, flusher, bloom rebuild, embeddings)
MongoDB Atlas · ElastiCache Redis (critical) · ElastiCache Redis (cache) · SES · CloudWatch · Secrets Manager
GitHub Actions: lint, test, build image, deploy
```
Set an AWS Budget alert before creating anything, and tear down costly resources when you are not demoing. SES starts in sandbox mode, so plan for the access request. Infrastructure as code (CDK or Terraform) is a strong bonus. API and worker are separate services so they scale independently.

## 17. WEEK-BY-WEEK SCHEDULE (16 weeks, alongside DSA)

**Daily rhythm:** 1 to 2 LeetCode problems in Java every day, one mock interview or system design question per weekend, one STAR story added to `docs/stories.md` each week. Work one slice at a time; commit small (`feat(holds): add holdSeats Lua script`); one pull request per slice, even if you review it yourself.

### Week 0: setup (2 to 3 days, before anything else)
- Install Node LTS, Docker, Git, VS Code, k6, `mongosh`. Create accounts: GitHub, Google Cloud (OAuth), Razorpay (test), AWS (set the budget alert), MongoDB Atlas.
- Create the repo with the structure in section 6 (empty folders get a `.gitkeep`). npm workspaces, strict TypeScript, ESLint, Prettier, `.env.example`, `.gitignore`.
- `docker-compose.yml`: MongoDB as a single-node replica set, two Redis containers, Mailpit. Confirm you can connect from `mongosh` and run a transaction.
- Write a one-page design doc: the problem, the three core problems (holds, orders, waiting room), the stack. Put it in `docs/designDocs/overview.md`.
- GitHub Actions workflow runs lint, strict TypeScript checks, tests and the frontend build.
- **Exit:** `docker compose up` starts the data stores, `npm test` and `npm run typecheck` pass, CI is green.

### Week 1: foundation and auth
- Express app: `app.ts`, `server.ts`, `config/env.ts` (validated), MongoDB and Redis connections, `requestId`, `errorHandler`, `/healthz` and `/readyz`.
- `User` model; register, login, refresh, logout, me; `auth.ts` middleware (`req.userId`, `req.userRole`); `tokenVersion`.
- Vite frontend: `AuthContext`, `Navbar`, `LoginPage`, `RegisterPage`, session restore through refresh.
- **Exit:** register, log in, refresh the page and stay signed in, log out everywhere, all through the UI; auth tests read the database afterward.

### Week 2: catalog, search, watchlist
- Models `Movie`, `Person`, `Watchlist`; seed script with about 50 fictional movies, cast and genres.
- List with filters and pagination, detail, cast, genres, `$text` search; Redis cache-aside for list and detail; watchlist endpoints with `{ inWatchlist }` status.
- Frontend: `HomePage`, `MovieDetailPage` (`MovieHeader`, `MovieSections`, cast), `SearchPage`, watchlist button.
- **Exit:** browse, search, open a movie, add and remove from the watchlist; cache hit ratio visible in logs.

### Week 3: theatres, shows, seat map
- Models `Theatre`, `Screen`, `Show`, `ShowSeat`; manager role; show creation generates seats; overlap check; `GET /movies/:id/shows`, `GET /shows/:id/seats` merged with Redis holds.
- Frontend: `ShowtimesPage` and a read-only `SeatMap`.
- **Exit:** pick a movie, see showtimes by theatre, see a seat map with sold seats.

### Week 4: seat holds (core problem 1)
- `constants/redisKeys.ts`, Lua scripts, `holdAccessor`, `holdService`, hold and release endpoints, per-user limits, `holdSweeper`.
- Frontend: seat selection, hold call, `useHoldTimer` countdown, release on leave.
- Concurrency test: 50 then 200 users on one seat, exactly one succeeds; half-held-group test; expired-hold-cannot-delete-others test.
- **Exit:** the seat-race test passes; design doc `docs/designDocs/holdSystem.md` written.

### Week 5: orders and the state machine (core problem 2)
- `Order` model, `orderStateMachine`, `pricingService` (server-side), `idempotency` middleware, create order (extends the hold), sell seats in a transaction, expiry job, cancel.
- Tests: double-click create order, two racing transitions, seat sold twice attempt, Redis killed mid-checkout.
- **Exit:** a held seat becomes an order and then `SOLD`; duplicate requests produce one order; all verified by database reads.

### Week 6: payments and tickets
- Razorpay test mode: payment session, webhook with signature check and dedupe, late-payment handling, outbox and publisher, BullMQ queues, `ticketWorker` (QR), `emailWorker` (Mailpit), scan endpoint.
- Frontend: `CheckoutPage` and `MyTicketsPage`.
- **Exit:** the full booking flow works end to end in the browser, a replayed webhook changes nothing, a late payment gets confirmed or refunded.

### Week 7: rate limiting, load balancing, first load tests
- `rateLimiter.ts` and the token bucket; apply the policy table; limiter tests for every route.
- nginx plus 3 API replicas in Compose; `X-Served-By`; failover test.
- k6: seat race through the balancer, rate limit burst.
- **Exit:** the 5,000-users-for-200-seats test sells exactly 200 through 3 replicas; killing a replica barely moves the error rate.

### Week 8: first AWS deploy (Tier 1 complete)
- Dockerfiles, GitHub Actions deploy, ECS services for API and workers, ALB with `/readyz` health checks, Atlas, ElastiCache, S3 and CloudFront for the frontend, secrets, CloudWatch dashboards and alarms.
- Smoke test the live site; run the seat race against it.
- **Exit:** a public URL where you can book a ticket (test payment), with a README and architecture diagram. Tag `v1-tier1`.

### Week 9: email verification, password reset, Google OAuth
- `EmailToken`, verification and reset flows, resend limits, `requireVerifiedEmail` on holds, orders and reviews, generic responses.
- `OAuthAccount`, Google flow with PKCE, `state`, `nonce`, ID token checks, the three linking rules including pre-hijacking.
- Frontend: check-your-email page, verify page, Continue with Google, resend action.
- **Exit:** tests for verified/unverified access, enumeration-safe responses, and the pre-hijacking scenario.

### Week 10: reviews and ratings
- `Review`, `ReviewVote`; one review per user (unique index); atomic aggregates; verified-viewer badge; report and basic moderation; nightly recompute job.
- Frontend: `ReviewList`, `RatingModal`, helpful vote.
- **Exit:** two simultaneous reviews update the totals correctly; duplicate review returns 409.

### Week 11: coupons and offers
- `Coupon`, `CouponRedemption`, `Offer`; apply and remove; validation rules; atomic claim; reserve, commit, release in the state machine; admin coupon CRUD and stats.
- Frontend: `CouponInput`, `PriceBreakdown`, offers on the home page.
- **Exit:** the coupon race test gives exactly N redemptions; expired and cancelled orders release their coupon use.

### Week 12: real-time seats and Bloom filters
- SSE endpoint, Redis pub/sub fan-out across replicas, batching, heartbeats; `useSeatStream`.
- Bloom filter on Redis bitmaps, nightly rebuild, add-before-commit rule, shield for movie ids and coupon codes.
- **Exit:** two browsers see each other's holds live; `bloomAttack.js` shows the database queries avoided. Tag `v2-tier2`.

### Week 13: write-behind, trending, recommendations
- Write-behind view counters with the `RENAME` handoff and idempotent flush; optional signal stream; trending; genre similarity; user signals and taste profile; evaluation script against the popularity baseline.
- Frontend: `RecommendationRow` on the home page and movie detail.
- **Exit:** the flood test shows the database write reduction; crash test shows no loss and no double count; hit-rate numbers recorded.

### Week 14: AI features
- Embedding worker, similarity, natural-language search with zod validation, fallback, caching, rate limit and daily budget, cost logging; `AiSearchBox`.
- **Exit:** the search works, degrades cleanly when the model is slow or invalid, and you have numbers for fallback rate and cost per 1,000 queries.

### Week 15: waiting room, abuse control, manager UI
- Waiting room with admission tokens and drain rate; `reconciliationJob`; failure drills (Redis down, slow payment provider, worker crash, duplicate webhook, double-click pay); runbooks; minimal manager and scanner UI.
- **Exit:** the 10,000-join waiting room test; every drill documented in `docs/runbooks/`.

### Week 16: hardening, numbers, story
- Run the whole load test list on AWS; tune ALB, autoscaling and cache TTLs; fix the top bottleneck; update dashboards.
- README with architecture diagram, setup steps and results; 3-minute demo video; fill in the resume line and the stories file. Tag `v3-final`.
- **Exit:** every number in section 20 is real.

**If you fall behind:** apply the cut order in section 2, and keep the weeks you cut as "future work" in the README.

## 18. STATUS BLOCK (update after every slice; mark done only when its Definition of Done is met)

```
Week 0  setup                          ✅     Week 9   email verification + Google    ⏳
Week 1  foundation + auth              ⏳     Week 10  reviews + ratings              ⏳
Week 2  catalog + search + watchlist   ⏳     Week 11  coupons + offers               ⏳
Week 3  theatres + shows + seat map    ⏳     Week 12  real-time seats + Bloom        ⏳
Week 4  seat holds                     ⏳     Week 13  write-behind + recommendations ⏳
Week 5  orders + state machine         ⏳     Week 14  AI features                    ⏳
Week 6  payments + tickets             ⏳     Week 15  waiting room + abuse control   ⏳
Week 7  rate limit + load balancing    ⏳     Week 16  hardening + numbers + story    ⏳
Week 8  first AWS deploy               ⏳
```

## 19. DEFINITION OF DONE

**Backend slice**
1. Controller follows the template: guards, one service call, `try/catch`, `'<Action> error:'` log, generic 500.
2. Pagination and indexes where it is a list.
3. Ownership and role rules tested, including "user A cannot touch user B's data".
4. At least one happy-path and one failure-path integration test, and **every write test reads the database afterwards**.
5. The result of every write is checked (`modifiedCount`, `deletedCount`, `null` from `findOneAndUpdate`) and mapped to 404 or 409.
6. Response field names come from `shared/contracts/`; the type returned matches the contract (a boolean is a boolean, not an array).
7. State changes go through the state machine and write `history`.
8. Any read-modify-write is replaced by an atomic operation, named for the outcome it guards.
9. Any new Redis key is in `constants/redisKeys.ts` with a TTL and a purpose.
10. Any new public endpoint has a rate-limit policy with a stated fail-open or fail-closed choice, and a test.
11. New environment variables are in `config/env.ts` and `.env.example`.
12. Strict TypeScript checks, ESLint and Prettier pass in CI.
13. Concurrency-critical slices have a parallel test (200 requests) that passes through the load balancer with several replicas.
14. A write-behind candidate states in one line why losing a few seconds of it is acceptable.

**Frontend step:** works against the real API; loading, empty and error states; messages from `message`; works on a phone; one component or hook test where logic exists.

## 20. RESUME LINE AND INTERVIEW STORIES

**Resume line (fill in real numbers)**
> Built QueueSkip, a full stack movie ticketing platform (TypeScript, React, Node.js, Express, MongoDB, Redis, BullMQ) on AWS. Atomic Redis hold system with MongoDB transactions as the source of truth prevented double-booking with 5,000 concurrent buyers for 200 seats across 3 load-balanced replicas; idempotent checkout, deduplicated payment webhooks and a transactional outbox; atomic coupon redemption under races; distributed Lua token-bucket rate limiting; Bloom-filter shield cutting random-ID database queries by X%; write-behind counters cutting database writes by Y%; Google OIDC sign-in with email verification and pre-hijacking protection; hybrid genre and embedding recommendations with LLM search and a non-AI fallback; p95 hold latency <X> ms at <N> requests per second.

**Stories to prepare (STAR)**, mapped to Amazon's Leadership Principles:
- The double-booking bug you reproduced first and then fixed (Dive Deep, Ownership).
- Why holds live in Redis but the final decision lives in MongoDB (Are Right, A Lot; Invent and Simplify).
- The late-payment edge case and the refund fallback (Customer Obsession).
- The coupon last-use race and the conditional update (Dive Deep).
- Why you identify Google users by `sub`, and the pre-hijacking case (Insist on the Highest Standards).
- Why login fails closed on Redis loss but browsing fails open (Bias for Action, Are Right).
- Why a Bloom-filter "no" is trusted and a "maybe" is not, and the create-then-read race.
- Why write-behind is fine for view counts and forbidden for seats, orders and coupons.
- What broke when you first ran the seat race through several replicas and how you fixed it.
- How you evaluated recommendations against a baseline and what did not work (Earn Trust: honest negative results).
- The bottleneck each load test found first and how you removed it (Deliver Results).

## 21. RISKS AND SCOPE DECISIONS

- **Scope creep is the main risk.** Follow the weekly order and the cut list. A deployed, load-tested Tier 1 beats an unfinished everything.
- **No real payments, ever.** Test mode only; say so in the README.
- **Content rights:** fictional or sample data, placeholder posters, no copyrighted images or trailers on any public demo.
- **AI cost and safety:** budgets, caching, fallbacks and output validation are required, not optional.
- **Managed-service differences:** Redis module support, persistence options and cluster behaviour differ by AWS service and version. Check the current documentation before committing.
- **Email:** SES starts in sandbox; request production access early.
- **Refunds:** keep the policy simple (full refund before a cut-off, none after) and decide whether a refunded order returns its coupon use.
- **Out of scope:** food ordering, resale, dynamic pricing, multi-currency, native mobile apps, a free-form seat map editor (generated grids only). List them as future work.
- **Do not add a concept without a number.** Each scale concept ships with a measurement: queries avoided, writes reduced, errors during failover, limit accuracy. Without the number it reads as a buzzword.
- **Be able to explain every line.** Interviewers will ask.

## 22. WORKING RULE

Finish the current vertical slice, test it, understand it, then continue. No new feature starts while the previous slice has a failing test or an unresolved item. Update the status block, commit, and write the week's story before you move on.
