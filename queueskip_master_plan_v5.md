# QueueSkip: Plan (simple tools, real backend concepts)

A movie booking app. Users browse movies (cast, reviews, genres), pick a show, choose seats, pay (test mode), and get a QR ticket. The hard part is the backend: no double-booked seats, no double payments, and a server that holds up under load.

This replaces all earlier plans.

**Removed on purpose** (things that are hard to explain in an interview as a beginner): test files, `.http` files, Prettier, ESLint, CI pipelines, a monorepo with a shared package, a queue library, AWS. **Kept:** every backend concept, each one small enough that you can build it yourself and explain it.

## 1. Stack

| Part | Choice |
|---|---|
| Language | TypeScript (simple `tsconfig`, run with `tsx`) |
| Backend | Node.js, Express |
| Database | MongoDB with Mongoose, as a replica set (needed for transactions) |
| Redis | one instance: holds, cache, rate limiting, counters, locks |
| Load balancer | nginx in front of 3 copies of the API |
| Frontend | React with Vite |
| Local services | Docker Compose: MongoDB, Redis, nginx |

**Tools you use to check your work** (no test code): Postman to send requests, `mongosh` to look at the database, `redis-cli` to look at Redis, and `autocannon` (one terminal command, no file) to send many requests at once.

## 2. Features

**Core:** sign up and log in; movies with genres, cast and search; reviews and ratings; theatres, shows and the seat map; seat holds; orders and payment; QR tickets.

**Then:** coupons; genre recommendations; email verification; Google login.

**Backend concepts you will build** (section 3): caching, rate limiting, Bloom filter, write-behind caching, load balancing, atomic updates, transactions, idempotency, distributed lock, webhooks.

## 3. Backend concepts (the heart of the project)

Each row is one thing you can build, demo by hand, and explain in an interview.

| # | Concept | Where it is used | One-line explanation | Demo by hand |
|---|---|---|---|---|
| 1 | Authentication | login, JWT access token (15 min) plus refresh token in an httpOnly cookie, passwords hashed with bcrypt | the server never stores plain passwords; short-lived tokens limit damage if one leaks | wrong password gives 401; expired token gives 401 |
| 2 | Authorization | `requireAdmin` middleware | who you are is not the same as what you may do | normal user calling an admin route gets 403 |
| 3 | Indexes and pagination | unique email, text search on movies, `skip` and `limit` | an index lets MongoDB find a document without scanning the whole collection | `explain()` in `mongosh` shows an index scan |
| 4 | Race condition | two people taking the same seat | two requests read the same state at the same time and both act on it | the `autocannon` demo below |
| 5 | **Atomic update** | seat hold, order status, coupon use, rating totals | do check-and-change as one operation so nothing can slip in between | 50 parallel requests, exactly 1 wins |
| 6 | Redis with TTL | seat hold lasts 5 minutes, then disappears by itself | the hold cleans itself up even if the server crashes | `redis-cli TTL` counts down |
| 7 | **Transaction** | confirm payment: sell seats, mark order paid, create tickets, all or nothing | either every step happens or none does | break one step on purpose and see nothing saved |
| 8 | **Idempotency** | creating an order and paying | repeating the same request gives the same result, not a second order | send the same request twice with the same key |
| 9 | **Caching (cache-aside)** | movie details | look in Redis first; on a miss read MongoDB and save it in Redis for 60 seconds | second request is faster; `redis-cli GET movie:<id>` |
| 10 | **Rate limiting** | login 5 per minute, holds 10 per minute, coupons 10 per minute | stop abuse and brute-force guessing; counters live in Redis so all servers share them | `autocannon` shows 429 after the limit |
| 11 | **Bloom filter** | block random movie ids and coupon guesses before they reach MongoDB | a tiny structure that says "definitely not here" or "maybe here" | random ids never touch the database |
| 12 | **Write-behind caching** | movie view counts | add to a Redis counter now, write to MongoDB in a batch every 10 seconds | 100 views become 1 database write |
| 13 | **Load balancing** | nginx in front of 3 API copies | spread requests across servers; works because the API keeps no state in memory | kill one copy and traffic continues |
| 14 | Distributed lock | the "expire unpaid orders" job runs on 3 servers but must run once | `SET key NX EX`: only one server gets the lock | only one server logs the job |
| 15 | Webhook | payment provider tells your server "payment done" | never trust the browser; verify a signature, and process each event once | send the same webhook twice, nothing changes |

### 3.1 How the less obvious ones work

**Atomic seat hold (Redis Lua script).** A Lua script runs as one uninterrupted step in Redis. It checks every requested seat; if all are free it holds all of them for 5 minutes, otherwise it holds none.
```lua
-- KEYS = one key per seat, ARGV[1] = who holds it, ARGV[2] = seconds
for i = 1, #KEYS do
  if redis.call('EXISTS', KEYS[i]) == 1 then return 0 end
end
for i = 1, #KEYS do
  redis.call('SET', KEYS[i], ARGV[1], 'EX', ARGV[2])
end
return 1
```
Rule: **Redis is the fast gate, MongoDB is the final judge.** Redis decides who may try to buy; MongoDB makes sure a seat is never sold twice.

**Rate limiter (fixed window).** For each user (or IP) and route:
```
key = rl:login:<userOrIp>
SET key 0 EX 60 NX      // create the counter with a 60 second life if it does not exist
count = INCR key        // atomic add
if count > limit: respond 429
```
Weakness to mention: a burst at the edge of two windows can double the limit. The upgrade is a sliding window or a token bucket. If Redis is down: login is blocked (safe), browsing is allowed.

**Bloom filter (built on Redis bits).** A row of 1,000,000 bits, all zero. To add an id, run it through 3 hash functions and switch those 3 bits on. To check an id, hash it the same way: if **any** bit is off it is **definitely not** there; if all are on it is **maybe** there. It never forgets an id (no false "no"), but sometimes says "maybe" for something that is not there (about 2 percent at 100,000 ids). Use: `GET /api/movies/:id` checks the filter first, and a "definitely not" returns 404 without touching MongoDB. Fill it from the database when the server starts, and add each new id **before** saving the movie. Limitation: you cannot remove an id; rebuild it now and then.

**Write-behind view counter.**
```
on every movie view:   HINCRBY views:pending <movieId> 1
every 10 seconds:      RENAME views:pending views:flushing        (atomic, new views start a fresh hash)
                       read views:flushing, bulk-update MongoDB with $inc, delete views:flushing
```
If the server crashes you lose up to 10 seconds of view counts. That is fine for views and **never** acceptable for seats, orders or payments, which always go straight to MongoDB.

**Load balancing.** Run three copies of the API on ports 5001, 5002, 5003. nginx listens on 8080 and spreads requests:
```nginx
upstream queueSkipApi {
  least_conn;
  server host.docker.internal:5001;
  server host.docker.internal:5002;
  server host.docker.internal:5003;
}
server {
  listen 80;
  location / { proxy_pass http://queueSkipApi; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }
}
```
It works because the API is **stateless**: login state is in the JWT, holds and counters are in Redis, data is in MongoDB. Any copy can serve any request. Each copy adds an `X-Served-By` header so you can see the spread. (On Linux add `extra_hosts: ["host.docker.internal:host-gateway"]` to the nginx service.)

**Distributed lock.** Every copy runs a timer that expires unpaid orders. To make only one copy do the work: `SET lock:expireOrders <id> NX EX 55`. If it returns OK you hold the lock and run the job; otherwise skip.

**Idempotency.** The client sends an `Idempotency-Key` header. `Order` has a unique index on `(userId, idempotencyKey)`. A repeated request hits the duplicate-key error, and you return the order that already exists.

**Transaction (confirm payment).** Inside `session.withTransaction(...)`: mark seats `SOLD` where they are still `AVAILABLE` (if the number updated is wrong, abort), mark the order `PAID` where it is still `PENDING_PAYMENT`, create the tickets. A second identical webhook finds the order no longer `PENDING_PAYMENT` and does nothing.

## 4. How a booking works

1. The user picks seats. The Lua script holds them in Redis for 5 minutes.
2. The user creates an order (`PENDING_PAYMENT`, idempotency key). The hold is extended to 10 minutes. Seats are **not** sold yet.
3. The user pays. First a fake "pay" button; later Razorpay test mode calls your webhook.
4. The transaction sells the seats, marks the order `PAID`, creates the tickets, and the coupon use becomes final.
5. If the user takes too long, the Redis hold vanishes and the expiry job marks the order `EXPIRED`.
6. If two people somehow pay for the same seats, the second transaction fails and that payment is refunded.

## 5. Database (MongoDB collections)

MongoDB runs as a replica set so booking and payment confirmation can use transactions. Use Mongoose models. Store all timestamps in UTC and all money as integer paise (`priceMinor`, `totalMinor`, etc.). Lowercase and trim emails before saving.

### 5.1 Collection overview

| Collection | Purpose | Important indexes |
|---|---|---|
| User | Accounts, roles, login and verification | unique `email`; sparse unique `googleId` |
| Movie | Movie catalogue, cast, genres and rating totals | text index on `title` and `cast.name`; `(status, releaseDate)`; `genres` |
| Review | One review per user per movie | unique `(movieId, userId)`; `(movieId, createdAt)` |
| Watchlist | Movies saved by a user | unique `(userId, movieId)`; `(userId, createdAt)` |
| Theatre | Theatre details and screens | `(city, name)` |
| Show | A scheduled screening | `(movieId, startsAt)`; `(theatreId, startsAt)`; `(status, startsAt)` |
| ShowSeat | Durable seat inventory for a show | unique `(showId, row, number)`; `(showId, status)` |
| Order | Checkout, payment and booking state | unique `(userId, idempotencyKey)`; `(status, expiresAt)`; `(userId, createdAt)` |
| Ticket | Individual admission ticket | unique `ticketCode`; `(orderId)`; `(showId, seatLabel)` |
| Coupon | Discount rules and usage | unique `code`; `(active, validFrom, validTo)` |

### 5.2 Detailed model fields

**User**
- `_id`: ObjectId.
- `name`: string, required, trimmed.
- `email`: string, required, lowercase, trimmed.
- `passwordHash`: string; required for password accounts, never return it in API responses.
- `role`: enum `USER | ADMIN`, default `USER`.
- `tokenVersion`: number, default `0`; increment to invalidate existing refresh tokens if using token-version validation.
- `emailVerified`: boolean, default `false`.
- `verifyTokenHash`: string, optional; store a hash rather than the raw verification token.
- `verifyTokenExpiresAt`: Date, optional.
- `googleId`: string, optional.
- `createdAt`, `updatedAt`: timestamps.
- Indexes: unique `{ email: 1 }`; sparse unique `{ googleId: 1 }`.

**Movie**
- `_id`: ObjectId.
- `title`: string, required, trimmed.
- `synopsis`: string.
- `runtimeMin`: number, required, positive.
- `language`: string, required.
- `releaseDate`: Date.
- `status`: enum `UPCOMING | NOW_SHOWING | ENDED | ARCHIVED`.
- `genres`: string array.
- `cast`: array of `{ name: string, characterName?: string }`.
- `ratingSum`: number, default `0`; `ratingCount`: number, default `0`. These are maintained atomically when reviews are created, changed or deleted.
- `viewCount`: number, default `0`; updated by the write-behind counter.
- `posterUrl`, `trailerUrl`: optional strings.
- `createdAt`, `updatedAt`: timestamps.
- Indexes: text `{ title: 'text', 'cast.name': 'text' }`; `{ status: 1, releaseDate: 1 }`; `{ genres: 1 }`.

**Review**
- `_id`: ObjectId.
- `movieId`, `userId`: ObjectId references, required.
- `userName`: string snapshot for display.
- `rating`: number, required, integer from `1` to `5`.
- `body`: string, optional, maximum length enforced by validation.
- `createdAt`, `updatedAt`: timestamps.
- Indexes: unique `{ movieId: 1, userId: 1 }`; `{ movieId: 1, createdAt: -1 }`.
- Use an upsert for the user's review. When a rating changes, update `Movie.ratingSum` by the difference; do not increment `ratingCount` for an edit.

**Watchlist**
- `_id`: ObjectId.
- `userId`, `movieId`: ObjectId references, required.
- `createdAt`: Date.
- Indexes: unique `{ userId: 1, movieId: 1 }`; `{ userId: 1, createdAt: -1 }`.

**Theatre**
- `_id`: ObjectId.
- `name`: string, required.
- `city`: string, required, normalized for consistent filtering.
- `address`: string.
- `screens`: array of `{ name: string, rows: number, seatsPerRow: number }`.
- `active`: boolean, default `true`.
- `createdAt`, `updatedAt`: timestamps.
- Index: `{ city: 1, name: 1 }`.
- Treat a screen's layout as fixed once shows have been created for it; changing the layout must not silently change existing show seats.

**Show**
- `_id`: ObjectId.
- `movieId`, `theatreId`: ObjectId references, required.
- `screenName`: string, required; identifies a screen in the theatre.
- `startsAt`, `endsAt`: Date, required.
- `priceMinor`: integer, required, non-negative; amount in paise.
- `status`: enum `SCHEDULED | CANCELLED | COMPLETED`, default `SCHEDULED`.
- `createdAt`, `updatedAt`: timestamps.
- Indexes: `{ movieId: 1, startsAt: 1 }`; `{ theatreId: 1, startsAt: 1 }`; `{ status: 1, startsAt: 1 }`.
- Validate that the movie and theatre exist and are active before creating a show. Generate its `ShowSeat` documents from the selected screen layout.

**ShowSeat**
- `_id`: ObjectId.
- `showId`: ObjectId reference, required.
- `row`: string, required (for example `A`).
- `number`: number, required (seat number within the row).
- `status`: enum `AVAILABLE | SOLD`, default `AVAILABLE`.
- `orderId`: ObjectId reference, optional; set when the seat is sold.
- `createdAt`, `updatedAt`: timestamps.
- Indexes: unique `{ showId: 1, row: 1, number: 1 }`; `{ showId: 1, status: 1 }`.
- Temporary holds are **not** stored here. They exist only in Redis. MongoDB changes a seat to `SOLD` only during successful payment confirmation.

**Order**
- `_id`: ObjectId.
- `userId`, `showId`: ObjectId references, required.
- `seats`: array of `{ showSeatId: ObjectId, seatLabel: string, priceMinor: number }`.
- `totalMinor`: integer, required; calculated by the server.
- `discountMinor`: integer, default `0`.
- `couponCode`: string, optional snapshot of the applied coupon.
- `status`: enum `PENDING_PAYMENT | PAID | CANCELLED | EXPIRED | REFUND_PENDING | REFUNDED | PAYMENT_FAILED`.
- `expiresAt`: Date, required for pending orders.
- `idempotencyKey`: string, required for create-order requests.
- `paymentProvider`: string, optional (for example `RAZORPAY` or `TEST`).
- `paymentReference`: string, optional provider payment/order reference.
- `createdAt`, `updatedAt`: timestamps.
- Indexes: unique `{ userId: 1, idempotencyKey: 1 }`; `{ status: 1, expiresAt: 1 }`; `{ userId: 1, createdAt: -1 }`.
- Never trust client-supplied prices, totals, discounts, ownership or status. Recalculate the order from database records.

**Ticket**
- `_id`: ObjectId.
- `orderId`, `showId`: ObjectId references, required.
- `userId`: ObjectId reference, required, to support ownership checks.
- `showSeatId`: ObjectId reference, required.
- `seatLabel`: string, required.
- `ticketCode`: random, unguessable unique string used to create/verify the QR payload.
- `usedAt`: Date, optional; null means not yet redeemed.
- `createdAt`: Date.
- Indexes: unique `{ ticketCode: 1 }`; `{ orderId: 1 }`; `{ showId: 1, seatLabel: 1 }`.
- QR data should contain an opaque ticket code, not personal details or payment secrets. Ticket scanning must atomically mark a valid unused ticket as used.

**Coupon**
- `_id`: ObjectId.
- `code`: string, required, uppercase and trimmed.
- `type`: enum `PERCENT | FIXED`.
- `value`: number, required; percentage points for `PERCENT`, paise for `FIXED`.
- `validFrom`, `validTo`: Date, required.
- `maxUses`: number, required.
- `usedCount`: number, default `0`.
- `usedBy`: ObjectId array of users, if the rule is one redemption per user.
- `active`: boolean, default `true`.
- Optional constraints: `minOrderMinor`, `maxDiscountMinor`.
- `createdAt`, `updatedAt`: timestamps.
- Indexes: unique `{ code: 1 }`; `{ active: 1, validFrom: 1, validTo: 1 }`.
- Validate dates, usage limits, per-user eligibility and discount caps on the server.

### 5.3 Relationships

- One `User` can create many `Review`, `Watchlist`, `Order` and `Ticket` records.
- One `Movie` can have many `Review` and `Show` records.
- One `Theatre` can have many `Show` records.
- One `Show` has many `ShowSeat`, `Order` and `Ticket` records.
- One `Order` contains one or more seats and produces one `Ticket` per booked seat after payment succeeds.
- A `Coupon` may be referenced by many orders; its usage is finalized only after successful payment.

### 5.4 Atomic coupon use

Do not permanently consume a coupon when the user merely applies it to a pending order. Validate it and calculate the discount during checkout. Increment its usage and record the user in the same successful-payment transaction that marks the order paid. Enforce the maximum usage with a conditional atomic update, for example:

```js
Coupon.findOneAndUpdate(
  {
    code,
    active: true,
    usedBy: { $ne: userId },
    $expr: { $lt: ['$usedCount', '$maxUses'] }
  },
  { $inc: { usedCount: 1 }, $addToSet: { usedBy: userId } },
  { new: true, session }
);
```

If the update returns `null`, the coupon is no longer eligible and the payment-confirmation flow must handle that outcome consistently (for example, abort and refund rather than silently applying an invalid discount).

### 5.5 Redis-only temporary holds

There is intentionally no MongoDB `Hold` collection in the first version. Redis keys represent temporary holds and expire automatically. MongoDB `ShowSeat.status` remains `AVAILABLE` until the payment transaction changes it to `SOLD`. Redis is the fast gate; MongoDB is the durable source of truth.

## 6. Folders

```
queueSkip/
├── backend/
│   ├── src/
│   │   ├── models/        User.ts, Movie.ts, Review.ts, Watchlist.ts, Theatre.ts, Show.ts, ShowSeat.ts, Order.ts, Ticket.ts, Coupon.ts
│   │   ├── controllers/   authController.ts, movieController.ts, reviewController.ts, showController.ts,
│   │   │                  holdController.ts, orderController.ts, couponController.ts, webhookController.ts
│   │   ├── routes/        authRoutes.ts, movieRoutes.ts, ...
│   │   ├── services/      holdService.ts, orderService.ts, pricingService.ts, recommendationService.ts
│   │   ├── middleware/    auth.ts, requireAdmin.ts, rateLimiter.ts, errorHandler.ts
│   │   ├── cache/         movieCache.ts, bloomFilter.ts, viewCounter.ts
│   │   ├── jobs/          expireOrders.ts, flushViews.ts
│   │   ├── lua/           holdSeats.lua
│   │   ├── config/        env.ts, db.ts, redis.ts
│   │   ├── utils/
│   │   ├── app.ts
│   │   └── server.ts
│   ├── scripts/           seed.ts
│   └── package.json
├── frontend/              pages/, components/, context/, hooks/, utils/
├── nginx/                 nginx.conf
├── docker-compose.yml
└── README.md              setup steps and the API list
```

## 7. Code style (same as your repo)

- Files: `holdController.ts`, `holdRoutes.ts`. Models and React components are PascalCase. Everything else camelCase.
- Controllers are named exports with a verb and a noun: `holdSeats`, `createOrder`, `applyCoupon`.
- Every controller: one `try/catch`, early-return checks, `res.status(400).json({ message: '...' })`, log as `console.error('Hold seats error:', error)`, answer 500 with `'Server error'`.
- `req.userId` is set by the auth middleware.
- Return the resource directly; errors are `{ message }` plus a `code` when the frontend must react (`SEAT_UNAVAILABLE`, `RATE_LIMITED`).
- One name per field, used the same in backend and frontend (for example always `inWatchlist`).
- Use single quotes and semicolons by habit; no formatter needed.

## 8. Steps

### Week 0: setup (5 steps, we do these together)
1. Check Node, npm, Git, Docker. Install Postman.
2. Create the folder and the Git repo.
3. Backend: `npm init`, install packages, a simple `tsconfig`.
4. `docker-compose.yml` with MongoDB (replica set) and Redis.
5. A `/health` route that connects to MongoDB and Redis.

**Done when:** `/health` says both are connected.

### Backend (one feature at a time: model, then controller, routes, then check by hand)

| Week | Build | Concepts | Done when |
|---|---|---|---|
| 1 | User, register, login, refresh, logout, roles | 1, 2 | wrong password fails; a normal user gets 403 on an admin route |
| 2 | Movies with genres and cast, list, detail, search, seed data | 3 | search works; invalid id gives 400; `explain()` shows an index scan |
| 3 | Reviews, ratings, watchlist | 5 (`$inc`) | a second review by one user updates, not duplicates; totals match |
| 4 | Theatres, shows, seat map | 3 | a show creates the right number of seats |
| 5 | Seat holds (Lua), release, expiry job with lock | 4, 5, 6, 14 | `autocannon` demo: exactly 1 winner |
| 6 | Orders, idempotency, fake pay, transaction, tickets with QR | 7, 8 | a repeated request gives the same order; a paid order has tickets and `SOLD` seats |
| 7 | Coupons, genre recommendations | 5 | a coupon with 1 use works for exactly one user |
| 8 | Redis caching for movie details, rate limiting | 9, 10 | second movie request is cached; login gets 429 after 5 tries |
| 9 | Email verification, Google login | 1 | unverified users cannot book |
| 10 | Bloom filter, write-behind view counts | 11, 12 | random ids never reach MongoDB; 100 views make 1 database write |
| 11 | 3 API copies behind nginx | 13 | kill one copy and requests still succeed; the seat race still has 1 winner |
| 12 | Payment webhook with Razorpay test mode (optional) | 15 | the same webhook twice changes nothing |

### Frontend (after the backend)

| Week | Build |
|---|---|
| 13 | Vite setup, `AuthContext`, login and register, home page, movie detail |
| 14 | Reviews, search, showtimes |
| 15 | Seat map, hold timer, checkout, tickets |
| 16 | Loading, empty and error states, phone layout, README, short demo video |

**If you run short on time, cut in this order:** week 12, Google login, week 11 (keep a 2-copy demo), week 10.

## 9. Checking your work by hand

- **After every write, look at the database** (`mongosh`), and at Redis (`redis-cli`) for holds, counters and cache.
- **For each step, try three things:** the normal case, one wrong input, and someone else's data.
- **Race demo (50 requests at once, no files):**
```bash
npx autocannon -c 50 -a 50 -m POST \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -b '{"showId":"<id>","seatIds":["<seatId>"]}' http://localhost:5000/api/holds
```
  Expect exactly one 2xx and 49 conflicts (409). Run it a few times after changing holds or orders.
- **Rate limit demo:** the same command against `/api/auth/login` with `-a 10`; expect 429 after the 5th.
- **Load balancer demo:** `for i in 1 2 3 4 5 6; do curl -si localhost:8080/health | grep X-Served-By; done`.
- **Cache demo:** open the same movie twice; `redis-cli TTL movie:<id>`.

## 10. API (complete route specification)

Base URL: `http://localhost:5000/api`. All request and response bodies use JSON unless noted. Protected routes require `Authorization: Bearer <accessToken>`. The refresh token is sent in and returned through an httpOnly cookie; never put it in JSON or local storage.

### 10.1 API conventions

- IDs in path parameters are MongoDB ObjectIds. Validate them before querying; return `400` for malformed IDs.
- Use `401` when authentication is missing or invalid, `403` when the user lacks permission, `404` when a resource is not found, `409` for booking conflicts, `422` for validly shaped but invalid business input, `429` for rate limits, and `500` for unexpected errors.
- List endpoints use `page` and `limit` query parameters and return `{ items, page, limit, total, totalPages }`.
- Return resources directly. Error bodies use `{ "message": "...", "code": "..." }` when the frontend needs a stable code.
- Never trust client-supplied `userId`, role, seat status, payment status, prices, totals, discount amounts or ticket ownership.
- Use an `Idempotency-Key` header for `POST /orders`. A retry with the same user and key returns the already-created order.
- Use integer paise for all monetary fields.

### 10.2 Authentication

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | Public | Create an account |
| POST | `/auth/login` | Public | Verify credentials and issue tokens |
| POST | `/auth/refresh` | Refresh cookie | Rotate/refresh access credentials |
| POST | `/auth/logout` | Refresh cookie | Clear/invalidate refresh credentials |
| GET | `/auth/me` | User | Get the current user's safe profile |
| POST | `/auth/verify-email` | Public | Verify email using a token |
| POST | `/auth/resend-verification` | User | Send a new verification email |
| GET | `/auth/google` | Public | Start Google OAuth |
| GET | `/auth/google/callback` | OAuth callback | Complete Google OAuth |

Example register request:
```json
{
  "name": "Dhanraj",
  "email": "user@example.com",
  "password": "StrongPassword123"
}
```
Example successful response (`201`):
```json
{
  "user": {
    "id": "USER_OBJECT_ID",
    "name": "Dhanraj",
    "email": "user@example.com",
    "role": "USER",
    "emailVerified": false
  },
  "message": "User registered"
}
```
Login accepts `{ "email": "user@example.com", "password": "..." }`. Return a safe user object and set the refresh token as an httpOnly, secure-in-production, same-site cookie. Access token is returned for the client to use as a bearer token. Do not return `passwordHash`, verification-token hashes or refresh tokens.

### 10.3 Movies and search

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/movies` | Public | Browse movies; filters `status`, `genre`, `language`, `page`, `limit` |
| GET | `/movies/:id` | Public | Movie details (cache-aside) |
| GET | `/movies/:id/similar` | Public | Similar movies, initially based on shared genres |
| GET | `/search?q=&page=&limit=` | Public | Search title and cast |
| POST | `/admin/movies` | Admin | Create a movie |
| PATCH | `/admin/movies/:id` | Admin | Update movie details |
| DELETE | `/admin/movies/:id` | Admin | Archive a movie; do not hard-delete records referenced by bookings |

Example movie creation:
```json
{
  "title": "Example Movie",
  "synopsis": "A short description",
  "runtimeMin": 132,
  "language": "English",
  "releaseDate": "2026-12-01T00:00:00.000Z",
  "status": "UPCOMING",
  "genres": ["Action", "Sci-Fi"],
  "cast": [
    { "name": "Actor One", "characterName": "Hero" }
  ]
}
```

### 10.4 Reviews and watchlist

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/movies/:id/reviews?page=&limit=` | Public | List reviews for a movie |
| PUT | `/movies/:id/reviews/me` | User | Create or update the current user's review |
| DELETE | `/movies/:id/reviews/me` | User | Delete the current user's review |
| GET | `/watchlist?page=&limit=` | User | Get the current user's watchlist |
| POST | `/watchlist` | User | Add a movie to the watchlist |
| DELETE | `/watchlist/:movieId` | User | Remove a movie from the watchlist |

Review request:
```json
{
  "rating": 5,
  "body": "Really enjoyed it."
}
```
Watchlist request:
```json
{
  "movieId": "MOVIE_OBJECT_ID"
}
```
A user can have only one review and one watchlist entry per movie. Repeated watchlist additions should return the existing entry or a clear conflict response without creating duplicates.

### 10.5 Theatres, shows and seats

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/theatres?city=` | Public | List active theatres in a city |
| GET | `/theatres/:id` | Public | Theatre details and screens |
| GET | `/movies/:id/shows?city=&date=` | Public | Showtimes for a movie |
| GET | `/shows/:id` | Public | Show details |
| GET | `/shows/:id/seats` | Public | Seat map and durable seat status |
| POST | `/admin/theatres` | Admin | Create a theatre and screen layouts |
| PATCH | `/admin/theatres/:id` | Admin | Update theatre details |
| POST | `/admin/shows` | Admin | Create a show and generate its `ShowSeat` records |
| PATCH | `/admin/shows/:id` | Admin | Update/cancel a show subject to booking rules |

Create-show request:
```json
{
  "movieId": "MOVIE_OBJECT_ID",
  "theatreId": "THEATRE_OBJECT_ID",
  "screenName": "Screen 1",
  "startsAt": "2026-12-01T14:30:00.000Z",
  "endsAt": "2026-12-01T16:42:00.000Z",
  "priceMinor": 25000
}
```
The seat-map response should include each seat's `id`, `row`, `number`, `status`, and a derived `held` flag. The server derives `held` from Redis; do not save temporary holds in MongoDB.

### 10.6 Seat holds

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/holds` | User | Atomically hold all requested seats in Redis |
| DELETE | `/holds/:holdId` | User | Release the current user's hold |

Create-hold request:
```json
{
  "showId": "SHOW_OBJECT_ID",
  "seatIds": ["SEAT_OBJECT_ID_1", "SEAT_OBJECT_ID_2"]
}
```
Successful response (`201`):
```json
{
  "holdId": "HOLD_ID",
  "showId": "SHOW_OBJECT_ID",
  "seatIds": ["SEAT_OBJECT_ID_1", "SEAT_OBJECT_ID_2"],
  "expiresAt": "2026-12-01T14:35:00.000Z"
}
```
If any seat is already sold or held, hold none of the requested seats and return `409` with code `SEAT_UNAVAILABLE`. The hold ID must be bound to the authenticated user and show. Release must not allow a user to release another user's hold.

### 10.7 Orders and checkout

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/orders` | User | Create a pending order from a valid hold |
| GET | `/orders` | User | List the current user's orders |
| GET | `/orders/:id` | Owner/Admin | Get order details |
| POST | `/orders/:id/coupon` | Owner | Validate/apply a coupon to the pending order |
| DELETE | `/orders/:id/coupon` | Owner | Remove the coupon from the pending order |
| POST | `/orders/:id/pay` | Owner | Start test-mode/provider payment |
| POST | `/orders/:id/cancel` | Owner | Cancel an eligible pending order |
| GET | `/orders/:id/tickets` | Owner/Admin | List tickets generated for the order |

Create-order request:
```json
{
  "showId": "SHOW_OBJECT_ID",
  "holdId": "HOLD_ID"
}
```
Header: `Idempotency-Key: <unique-client-generated-key>`

The server verifies that the hold belongs to the user, matches the show, has not expired, and contains the requested seats. It calculates the total using database prices, creates a `PENDING_PAYMENT` order and extends the Redis hold according to the checkout timeout. Repeating the same request with the same key returns the same order.

Coupon request:
```json
{
  "code": "MOVIE10"
}
```
The server validates the coupon and returns the recalculated amount. Coupon usage is not permanently consumed until successful payment confirmation.

### 10.8 Tickets and QR scanning

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/tickets/:id` | Owner/Admin | Get one ticket |
| POST | `/shows/:id/scan` | Admin/staff | Validate and redeem a ticket QR code |

Scan request:
```json
{
  "ticketCode": "OPAQUE_RANDOM_TICKET_CODE"
}
```
A successful scan atomically sets `usedAt` and returns the ticket/show/seat summary. A ticket that is invalid, belongs to another show, or has already been used must not be redeemed again. Return `409` for an already-used ticket.

### 10.9 Coupons and offers

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/offers` | Public | List currently active public offers |
| POST | `/admin/coupons` | Admin | Create a coupon |
| PATCH | `/admin/coupons/:id` | Admin | Update coupon rules |
| DELETE | `/admin/coupons/:id` | Admin | Deactivate a coupon |

Coupon creation request:
```json
{
  "code": "MOVIE10",
  "type": "PERCENT",
  "value": 10,
  "validFrom": "2026-11-01T00:00:00.000Z",
  "validTo": "2026-12-31T23:59:59.000Z",
  "maxUses": 100,
  "minOrderMinor": 10000,
  "maxDiscountMinor": 5000
}
```

### 10.10 Payment webhook

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/webhooks/payments` | Provider signature | Receive payment-provider events |

The webhook is not authenticated with the user's access token. Verify the provider signature against the raw request body before processing. Record/deduplicate provider event IDs so retries are safe. In one MongoDB transaction, confirm the order is still eligible, conditionally change every ordered seat from `AVAILABLE` to `SOLD`, mark the order `PAID`, create one ticket per seat, and finalize coupon usage. If any seat cannot be sold, abort the transaction and initiate a refund/compensation path. A duplicate event must not create duplicate tickets or charge/confirm twice.

### 10.11 Health and readiness

| Method | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | Public | Basic process health and `X-Served-By` instance header |
| GET | `/ready` | Internal/public in local development | Check MongoDB and Redis connectivity |

`/health` confirms that the process is alive. `/ready` confirms required dependencies are reachable. Do not expose credentials, connection strings or sensitive infrastructure details in either response.

### 10.12 Route-to-controller guide

| Route group | Controller file | Main service/model use |
|---|---|---|
| Auth | `authController.ts` | `User`, authentication utilities |
| Movies/search | `movieController.ts` | `Movie`, `movieCache`, `bloomFilter` |
| Reviews | `reviewController.ts` | `Review`, `Movie` |
| Watchlist | `watchlistController.ts` | `Watchlist`, `Movie` |
| Theatres/shows | `showController.ts` | `Theatre`, `Show`, `ShowSeat` |
| Holds | `holdController.ts` | `holdService`, Redis, `ShowSeat` validation |
| Orders | `orderController.ts` | `Order`, `orderService`, `pricingService` |
| Coupons/offers | `couponController.ts` | `Coupon`, `pricingService` |
| Tickets/scanning | `ticketController.ts` | `Ticket` |
| Payment webhook | `webhookController.ts` | `Order`, `ShowSeat`, `Ticket`, `Coupon` |

Write each endpoint into the README as you build it: method, path, authentication, request example, success response, and expected error codes.

## 11. Interview questions this plan prepares you for

- How do you stop two people booking the same seat? (Redis Lua hold, then conditional update in a MongoDB transaction)
- Why both Redis and MongoDB? (Redis is fast and self-expiring; MongoDB is durable and is the final judge)
- What if the payment confirmation arrives twice? (the order is no longer `PENDING_PAYMENT`, so the second one does nothing)
- What if the user clicks "create order" twice? (unique idempotency key)
- How does rate limiting work across several servers? (counters live in Redis, not in server memory)
- What is a Bloom filter, and why can it say "maybe" but never a wrong "no"?
- Why is write-behind fine for view counts but not for payments?
- What happens if Redis goes down? (holds return 503 and nothing is sold without them; cache and Bloom filter are skipped; login is blocked, browsing continues)
- How does load balancing work with login tokens? (the API is stateless: the JWT carries the identity)
- Why store money as whole numbers? Why a replica set for transactions? Why an index?

## 12. Resume line

> Built QueueSkip, a movie ticket booking app (React, TypeScript, Node.js, Express, MongoDB, Redis, nginx). Atomic Redis seat holds with MongoDB transactions prevent double-booking under concurrent requests; idempotent checkout and payment webhooks; Redis-backed rate limiting, cache-aside caching, Bloom filter and write-behind view counters; three load-balanced API instances; Google sign-in with email verification.

## 13. Rule

Finish one feature, check it by hand, look at the database, then move on. Do not start the next thing while the current one is half done.