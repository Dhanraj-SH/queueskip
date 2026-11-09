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
-- KEYS = one key per seat, ARGV[1] = the hold id, ARGV[2] = seconds
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

| Collection | Key fields | Important indexes |
|---|---|---|
| User | name, email, passwordHash, role (`USER` or `ADMIN`), tokenVersion, emailVerified, verifyTokenHash, googleId | unique email |
| Movie | title, synopsis, runtimeMin, language, releaseDate, status, genres[], cast[{ name, characterName }], ratingSum, ratingCount, viewCount | text on title and cast names; (status, releaseDate); genres |
| Review | movieId, userId, userName, rating, body | unique (movieId, userId) |
| Watchlist | userId, movieId | unique (userId, movieId) |
| Theatre | name, city, screens[{ name, rows, seatsPerRow }] | city |
| Show | movieId, theatreId, screenName, startsAt, priceMinor | (movieId, startsAt) |
| ShowSeat | showId, row, number, status (`AVAILABLE` or `SOLD`), orderId | unique (showId, row, number) |
| Order | userId, showId, seats[], totalMinor, discountMinor, couponCode, status, expiresAt, idempotencyKey | unique (userId, idempotencyKey); (status, expiresAt) |
| Ticket | orderId, showId, seatLabel, ticketCode, usedAt | unique ticketCode |
| Coupon | code, type, value, validFrom, validTo, maxUses, usedCount, usedBy[] | unique code |

Money is whole numbers (paise). A seat being "held" exists only in Redis. Emails are lowercased before saving.

**Atomic coupon use:**
```js
Coupon.findOneAndUpdate(
  { code, usedBy: { $ne: userId }, $expr: { $lt: ['$usedCount', '$maxUses'] } },
  { $inc: { usedCount: 1 }, $push: { usedBy: userId } }
);   // null means: used up, or this user already used it
```

## 6. Folders

```
queueSkip/
├── backend/
│   ├── src/
│   │   ├── models/        User.ts, Movie.ts, Review.ts, Watchlist.ts, Theatre.ts, Show.ts, ShowSeat.ts, Order.ts, Ticket.ts, Coupon.ts
│   │   ├── controllers/   authController.ts, movieController.ts, reviewController.ts, watchlistController.ts, showController.ts,
│   │   │                  holdController.ts, orderController.ts, webhookController.ts, couponController.ts,
│   │   │                  recommendationController.ts, adminController.ts
│   │   ├── routes/        authRoutes.ts, movieRoutes.ts, watchlistRoutes.ts, showRoutes.ts, holdRoutes.ts, orderRoutes.ts,
│   │   │                  webhookRoutes.ts, offerRoutes.ts, meRoutes.ts, adminRoutes.ts
│   │   ├── services/      holdService.ts, orderService.ts, pricingService.ts, recommendationService.ts   (added as you need them)
│   │   ├── middleware/    auth.ts, requireAdmin.ts, requireVerified.ts, rateLimiter.ts, errorHandler.ts
│   │   ├── cache/         movieCache.ts, bloomFilter.ts, viewCounter.ts      (Weeks 8 and 10)
│   │   ├── jobs/          expireOrders.ts, flushViews.ts                      (Weeks 5 and 10)
│   │   ├── lua/           holdSeats.lua, releaseSeats.lua, index.ts
│   │   ├── config/        env.ts, db.ts, redis.ts
│   │   ├── utils/         constants.ts, redisKeys.ts, tokens.ts
│   │   ├── types/         express.d.ts
│   │   ├── app.ts
│   │   └── server.ts
│   ├── scripts/           seed.ts
│   ├── .env               (never commit)   .env.example
│   ├── package.json
│   └── tsconfig.json
├── frontend/              pages/, components/, context/, hooks/, utils/
├── nginx/                 nginx.conf                                          (Week 11)
├── docker-compose.yml
├── .gitignore
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
3. Backend: `npm init`, install the packages (section 13.1), add `tsconfig.json` (13.3) and `.env` (13.4).
4. `docker-compose.yml` with MongoDB (replica set) and Redis (13.5).
5. Copy the starter files (sections 14, 17, 18) and the `User` model (15), start the server, and open `/health`. Every other route already exists and answers `501 Not built yet`; you replace one stub at a time.

**Done when:** `/health` says `mongo: true` and `redis: true`, and `GET /api/movies` answers 501.

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

## 10. API

The full list, with who may call each route, the rate limit and the handler name, is in **section 16**. The route files themselves are in section 16 too.

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

# PART 2: REFERENCE (copy these as you reach each step)

Everything in this part was compiled with TypeScript and the app was run against a real Redis to check the routes, the middleware, the Lua scripts and the rate limiter (see section 24 for exactly what was and was not checked).

## 13. Setup files

### 13.1 Packages
Run inside `backend/`:
```bash
npm install express mongoose ioredis jsonwebtoken bcryptjs cookie-parser cors dotenv qrcode nodemailer google-auth-library
npm install -D typescript tsx @types/node @types/express @types/jsonwebtoken @types/cookie-parser @types/cors @types/qrcode @types/nodemailer
```
`bcryptjs` is used instead of `bcrypt` because it needs no native build, so it installs everywhere. The code was checked with Express 5, Mongoose 9, ioredis 6 and TypeScript 7. Newer versions of the same packages should work too.

### 13.2 `package.json` scripts
```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "start": "tsx src/server.ts",
  "seed": "tsx scripts/seed.ts"
}
```

### 13.3 `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src", "scripts"]
}
```
Do not add `"moduleResolution": "node"`: TypeScript 7 removed it and the compiler will refuse to run.

### 13.4 `.env.example` (copy to `.env`)
```
# Copy to backend/.env and fill in the two secrets. Never commit .env.
PORT=5000
INSTANCE_NAME=api1
CLIENT_URL=http://localhost:5173
TRUST_PROXY=0

# Single-node replica set from docker-compose (transactions need a replica set)
MONGO_URI=mongodb://localhost:27017/queueSkip?replicaSet=rs0
REDIS_URL=redis://localhost:6379

# Generate each one with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

# Later weeks
GOOGLE_CLIENT_ID=
RAZORPAY_WEBHOOK_SECRET=
```

### 13.5 `docker-compose.yml`
```yaml
services:
  mongo:
    image: mongo:7
    command: ['--replSet', 'rs0', '--bind_ip_all']
    ports:
      - '27017:27017'
    volumes:
      - mongoData:/data/db
    healthcheck:
      # starts the one-member replica set the first time it runs
      test:
        [
          'CMD-SHELL',
          "echo \"try { rs.status() } catch (err) { rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]}) }\" | mongosh --port 27017 --quiet",
        ]
      interval: 5s
      timeout: 10s
      retries: 20
      start_period: 10s

  redis:
    image: redis:7
    command: ['redis-server', '--maxmemory-policy', 'noeviction']
    ports:
      - '6379:6379'

  # Add this in Week 11 (the load balancer)
  # nginx:
  #   image: nginx:stable
  #   ports:
  #     - '8080:80'
  #   volumes:
  #     - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
  #   extra_hosts:
  #     - 'host.docker.internal:host-gateway'

volumes:
  mongoData:
```
Start it with `docker compose up -d`. MongoDB must stay a replica set, or transactions will fail. Run the API on your own machine (`npm run dev`), not inside Docker.

### 13.6 `nginx/nginx.conf` (Week 11)
```nginx
upstream queueSkipApi {
  least_conn;
  server host.docker.internal:5001;
  server host.docker.internal:5002;
  server host.docker.internal:5003;
}

server {
  listen 80;

  location / {
    proxy_pass http://queueSkipApi;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Host $host;
  }
}
```
Run three copies of the API, each with its own port and name (command-line values win over `.env`):
```bash
PORT=5001 INSTANCE_NAME=a TRUST_PROXY=1 npm run dev
PORT=5002 INSTANCE_NAME=b TRUST_PROXY=1 npm run dev
PORT=5003 INSTANCE_NAME=c TRUST_PROXY=1 npm run dev
```
Then call `http://localhost:8080`. The `X-Served-By` header shows which copy answered.

### 13.7 `.gitignore`
```
node_modules/
.env
dist/
```

## 14. Constants, config and Lua scripts

**`src/utils/constants.ts`**
```ts
export const userRoles = ['USER', 'ADMIN'] as const;
export const movieStatuses = ['UPCOMING', 'NOW_SHOWING', 'ENDED'] as const;
export const showStatuses = ['SCHEDULED', 'CANCELLED'] as const;
export const seatStatuses = ['AVAILABLE', 'SOLD'] as const;
export const orderStatuses = ['PENDING_PAYMENT', 'PAID', 'EXPIRED', 'CANCELLED', 'REFUNDED'] as const;
export const couponTypes = ['PERCENT', 'FLAT'] as const;

export const holdSeconds = 300; // 5 minutes to choose seats
export const paymentWindowSeconds = 600; // creating an order extends the hold to 10 minutes
export const maxSeatsPerHold = 6;
export const defaultPageSize = 20;
export const maxPageSize = 100;
```

**`src/utils/redisKeys.ts`**
```ts
// Every Redis key is built here, so you can see all of them in one place.
export const redisKeys = {
  hold: (showId: string, seatId: string) => `hold:${showId}:${seatId}`,
  holdInfo: (holdId: string) => `holdInfo:${holdId}`,
  userHold: (userId: string, showId: string) => `userHold:${userId}:${showId}`,
  rateLimit: (name: string, who: string) => `rl:${name}:${who}`,
  movie: (movieId: string) => `movie:${movieId}`,
  similar: (movieId: string) => `similar:${movieId}`,
  bloomMovies: 'bloom:movies',
  bloomCoupons: 'bloom:coupons',
  viewsPending: 'views:pending',
  viewsFlushing: 'views:flushing',
  lock: (name: string) => `lock:${name}`,
};
```

**`src/utils/tokens.ts`**
```ts
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';

export type TokenPayload = { userId: string; role: string; tokenVersion: number };

export const signAccessToken = (payload: TokenPayload) =>
  jwt.sign(payload, env.jwtAccessSecret, { expiresIn: '15m' });

export const signRefreshToken = (payload: TokenPayload) =>
  jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: '7d' });

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, env.jwtAccessSecret, { algorithms: ['HS256'] }) as TokenPayload;

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, env.jwtRefreshSecret, { algorithms: ['HS256'] }) as TokenPayload;

// Random token for email verification links. Only its hash is saved in the database.
export const randomToken = () => crypto.randomBytes(32).toString('hex');
export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
```

**`src/types/express.d.ts`**
```ts
// Tells TypeScript that the auth middleware adds these two fields to every request.
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: string;
    }
  }
}

export {};
```

**`src/config/env.ts`**
```ts
import dotenv from 'dotenv';

dotenv.config();

const required = ['MONGO_URI', 'REDIS_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

// The rest of the code reads this object, never process.env directly.
export const env = {
  port: Number(process.env.PORT) || 5000,
  instanceName: process.env.INSTANCE_NAME || 'api',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  isProduction: process.env.NODE_ENV === 'production',
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  mongoUri: process.env.MONGO_URI as string,
  redisUrl: process.env.REDIS_URL as string,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET as string,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET as string,
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
};
```

**`src/config/db.ts`**
```ts
import mongoose from 'mongoose';
import { env } from './env';

export const connectDb = async () => {
  await mongoose.connect(env.mongoUri);
  console.log('MongoDB connected');
};

export const isDbReady = () => mongoose.connection.readyState === 1;
```

**`src/config/redis.ts`**
```ts
import Redis from 'ioredis';
import { env } from './env';

// enableOfflineQueue: false makes a command fail at once when Redis is down, instead of
// waiting for it to come back. Without this, every request would hang while Redis is away.
export const redis = new Redis(env.redisUrl, { enableOfflineQueue: false });

redis.on('error', (error) => {
  console.error('Redis error:', error.message);
});

// Use at server start, before anything that needs Redis (Bloom filters, jobs).
export const waitForRedis = () =>
  new Promise<void>((resolve) => {
    if (redis.status === 'ready') return resolve();
    redis.once('ready', () => resolve());
  });
```

**`src/lua/holdSeats.lua`**
```lua
-- KEYS = one key per seat, ARGV[1] = the hold id, ARGV[2] = seconds to hold
-- Redis runs the whole script as one step, so nobody can slip in between the check and the set.
for i = 1, #KEYS do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    return 0
  end
end
for i = 1, #KEYS do
  redis.call('SET', KEYS[i], ARGV[1], 'EX', ARGV[2])
end
return 1
```

**`src/lua/releaseSeats.lua`**
```lua
-- KEYS = seat keys, ARGV[1] = the hold id
-- Delete a seat key only if it still belongs to this hold (an expired hold must never
-- delete a newer hold on the same seat).
local released = 0
for i = 1, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then
    redis.call('DEL', KEYS[i])
    released = released + 1
  end
end
return released
```

**`src/lua/index.ts`**
```ts
import fs from 'fs';
import path from 'path';

const load = (fileName: string) => fs.readFileSync(path.join(__dirname, fileName), 'utf8');

export const holdSeatsScript = load('holdSeats.lua');
export const releaseSeatsScript = load('releaseSeats.lua');

// How to call one: redis.eval(holdSeatsScript, seatKeys.length, ...seatKeys, holdId, 300)
```


## 15. Database models (Mongoose)

Add each model in the week shown. The unique and compound indexes are what protect you from duplicates, so look at them when you read each file.

| Model | Add in | Indexes and why |
|---|---|---|
| User | Week 0 / 1 | unique `email` (no two accounts per email); unique sparse `googleId` (Google accounts only) |
| Movie | Week 2 | text on `title` and `cast.name` (search); `(status, releaseDate)` (home page); `(genres, status)` (genre rows) |
| Review | Week 3 | unique `(movieId, userId)` (one review per user per movie); `(movieId, createdAt)` (newest first) |
| Watchlist | Week 3 | unique `(userId, movieId)`; `(userId, createdAt)` |
| Theatre | Week 4 | `city` |
| Show | Week 4 | `(movieId, startsAt)` (showtimes); `(theatreId, screenName, startsAt)` (overlap check) |
| ShowSeat | Week 4 | unique `(showId, row, number)` (no duplicate seats); `(showId, status)` (seat map) |
| Order | Week 6 | unique `(userId, idempotencyKey)` (double click); `(userId, createdAt)` (my orders); `(status, expiresAt)` (expiry job) |
| Ticket | Week 6 | unique `ticketCode`; `orderId`; `(userId, createdAt)` |
| Coupon | Week 7 | unique `code` |

Run `db.<collection>.getIndexes()` in `mongosh` after the first request to a model; Mongoose creates the indexes automatically in development.

**`src/models/User.ts`**
```ts
import { Schema, model } from 'mongoose';
import { userRoles } from '../utils/constants';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null }, // null for Google-only accounts
    role: { type: String, enum: userRoles, default: 'USER' },
    tokenVersion: { type: Number, default: 0 }, // logout adds 1, which ends old refresh tokens
    emailVerified: { type: Boolean, default: false },
    verifyTokenHash: { type: String, default: null },
    verifyTokenExpires: { type: Date, default: null },
    googleId: { type: String }, // leave it unset for normal accounts (see the index below)
  },
  { timestamps: true }
);

// sparse: accounts without a googleId are left out of this index, so they do not clash
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });

export default model('User', userSchema);
```

**`src/models/Movie.ts`**
```ts
import { Schema, model } from 'mongoose';
import { movieStatuses } from '../utils/constants';

const castSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    characterName: { type: String, default: '' },
  },
  { _id: false }
);

const movieSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    synopsis: { type: String, default: '', maxlength: 3000 },
    runtimeMin: { type: Number, required: true, min: 1 },
    language: { type: String, required: true, lowercase: true, trim: true }, // 'hi', 'en'
    releaseDate: { type: Date, required: true },
    status: { type: String, enum: movieStatuses, default: 'UPCOMING' },
    posterUrl: { type: String, default: '' },
    genres: { type: [String], default: [] }, // for example ['Action', 'Thriller']
    cast: { type: [castSchema], default: [] },
    ratingSum: { type: Number, default: 0 }, // average = ratingSum / ratingCount
    ratingCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 }, // updated in batches (write-behind)
  },
  { timestamps: true }
);

movieSchema.index({ title: 'text', 'cast.name': 'text' }, { weights: { title: 10, 'cast.name': 5 } });
movieSchema.index({ status: 1, releaseDate: -1 });
movieSchema.index({ genres: 1, status: 1 });

export default model('Movie', movieSchema);
```

**`src/models/Review.ts`**
```ts
import { Schema, model } from 'mongoose';

const reviewSchema = new Schema(
  {
    movieId: { type: Schema.Types.ObjectId, ref: 'Movie', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true }, // copy of the name, so lists need no join
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 10,
      validate: { validator: Number.isInteger, message: 'Rating must be a whole number' },
    },
    body: { type: String, default: '', maxlength: 2000 },
  },
  { timestamps: true }
);

reviewSchema.index({ movieId: 1, userId: 1 }, { unique: true }); // one review per user per movie
reviewSchema.index({ movieId: 1, createdAt: -1 });

export default model('Review', reviewSchema);
```

**`src/models/Watchlist.ts`**
```ts
import { Schema, model } from 'mongoose';

const watchlistSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    movieId: { type: Schema.Types.ObjectId, ref: 'Movie', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

watchlistSchema.index({ userId: 1, movieId: 1 }, { unique: true });
watchlistSchema.index({ userId: 1, createdAt: -1 });

export default model('Watchlist', watchlistSchema);
```

**`src/models/Theatre.ts`**
```ts
import { Schema, model } from 'mongoose';

const screenSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    rows: { type: Number, required: true, min: 1, max: 26 }, // rows are lettered A, B, C ...
    seatsPerRow: { type: Number, required: true, min: 1, max: 40 },
  },
  { _id: false }
);

const theatreSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    city: { type: String, required: true, lowercase: true, trim: true },
    address: { type: String, default: '' },
    screens: { type: [screenSchema], default: [] },
  },
  { timestamps: true }
);

theatreSchema.index({ city: 1 });

export default model('Theatre', theatreSchema);
```

**`src/models/Show.ts`**
```ts
import { Schema, model } from 'mongoose';
import { showStatuses } from '../utils/constants';

const showSchema = new Schema(
  {
    movieId: { type: Schema.Types.ObjectId, ref: 'Movie', required: true },
    theatreId: { type: Schema.Types.ObjectId, ref: 'Theatre', required: true },
    screenName: { type: String, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    priceMinor: { type: Number, required: true, min: 0 }, // price per seat in paise
    status: { type: String, enum: showStatuses, default: 'SCHEDULED' },
    seatsTotal: { type: Number, required: true, min: 1 },
    seatsSold: { type: Number, default: 0 },
  },
  { timestamps: true }
);

showSchema.index({ movieId: 1, startsAt: 1 }); // showtimes for a movie
showSchema.index({ theatreId: 1, screenName: 1, startsAt: 1 }); // overlap check

export default model('Show', showSchema);
```

**`src/models/ShowSeat.ts`**
```ts
import { Schema, model } from 'mongoose';
import { seatStatuses } from '../utils/constants';

// One document per seat per show. A seat that is only "held" is NOT stored here: holds live in Redis.
const showSeatSchema = new Schema(
  {
    showId: { type: Schema.Types.ObjectId, ref: 'Show', required: true },
    row: { type: String, required: true }, // 'A'
    number: { type: Number, required: true }, // 5
    label: { type: String, required: true }, // 'A5'
    status: { type: String, enum: seatStatuses, default: 'AVAILABLE' },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  },
  { timestamps: true }
);

showSeatSchema.index({ showId: 1, row: 1, number: 1 }, { unique: true }); // no duplicate seats
showSeatSchema.index({ showId: 1, status: 1 });

export default model('ShowSeat', showSeatSchema);
```

**`src/models/Order.ts`**
```ts
import { Schema, model } from 'mongoose';
import { orderStatuses } from '../utils/constants';

const orderSeatSchema = new Schema(
  {
    showSeatId: { type: Schema.Types.ObjectId, ref: 'ShowSeat', required: true },
    label: { type: String, required: true },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    showId: { type: Schema.Types.ObjectId, ref: 'Show', required: true },
    // Copies taken at purchase time, so history stays correct if a movie is renamed later
    movieTitle: { type: String, required: true },
    theatreName: { type: String, required: true },
    startsAt: { type: Date, required: true },
    seats: { type: [orderSeatSchema], required: true },
    subtotalMinor: { type: Number, required: true, min: 0 },
    discountMinor: { type: Number, default: 0, min: 0 },
    totalMinor: { type: Number, required: true, min: 0 }, // subtotal minus discount
    couponCode: { type: String, default: null },
    status: { type: String, enum: orderStatuses, default: 'PENDING_PAYMENT' },
    expiresAt: { type: Date, required: true }, // end of the payment window
    holdId: { type: String, required: true }, // the Redis hold this order came from
    idempotencyKey: { type: String, required: true },
    paymentRef: { type: String, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true }); // stops a second order on double click
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, expiresAt: 1 }); // the job that expires unpaid orders

export default model('Order', orderSchema);
```

**`src/models/Ticket.ts`**
```ts
import { Schema, model } from 'mongoose';

const ticketSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    showId: { type: Schema.Types.ObjectId, ref: 'Show', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    seatLabel: { type: String, required: true },
    ticketCode: { type: String, required: true, unique: true }, // goes into the QR code
    usedAt: { type: Date, default: null }, // set when scanned at the door
  },
  { timestamps: true }
);

ticketSchema.index({ orderId: 1 });
ticketSchema.index({ userId: 1, createdAt: -1 });

export default model('Ticket', ticketSchema);
```

**`src/models/Coupon.ts`**
```ts
import { Schema, model } from 'mongoose';
import { couponTypes } from '../utils/constants';

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    type: { type: String, enum: couponTypes, required: true },
    value: { type: Number, required: true, min: 1 }, // 1 to 100 for PERCENT, paise for FLAT
    maxDiscountMinor: { type: Number, default: null }, // cap for PERCENT coupons
    minOrderMinor: { type: Number, default: 0 },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    maxUses: { type: Number, required: true, min: 1 },
    usedCount: { type: Number, default: 0 },
    usedBy: { type: [Schema.Types.ObjectId], default: [] }, // one use per user
    isPublic: { type: Boolean, default: false }, // shown on the offers page
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default model('Coupon', couponSchema);
```


## 16. Routes

Every route is below. "Limit" is the rate limit from the rate limiter (section 17). **fail closed** means the request is blocked if Redis is down; everything else lets the request through.

### 16.1 Route table

| Method and path | Who | Limit | Handler | What it does |
|---|---|---|---|---|
| **Auth** `/api/auth` | | | | |
| POST `/register` | public | 5 per hour per IP, fail closed | `registerUser` | create user (email lowercased, bcrypt hash), create the verification token, print or send the link |
| POST `/login` | public | 5 per minute per IP, fail closed | `loginUser` | check password; return access token and set the refresh cookie |
| POST `/refresh` | refresh cookie | 30 per minute per IP | `refreshToken` | new access token if the cookie is valid and `tokenVersion` matches |
| POST `/logout` | logged in | none | `logoutUser` | add 1 to `tokenVersion`, clear the cookie |
| GET `/me` | logged in | none | `getCurrentUser` | the current user |
| POST `/verify-email` | public | 10 per hour per IP | `verifyEmail` | hash the token, find the user, mark verified |
| POST `/resend-verification` | public | 3 per hour per IP, fail closed | `resendVerification` | same answer whether or not the email exists |
| POST `/google` | public | 10 per minute per IP, fail closed | `googleLogin` | check the Google ID token, find or create the user |
| **Movies** `/api/movies` | | | | |
| GET `/` | public | global | `listMovies` | filters `genre`, `language`, `status`, paging `page`, `limit` |
| GET `/search?q=` | public | 60 per minute per IP | `searchMovies` | MongoDB text search (route is above `/:id` on purpose) |
| GET `/:id` | public | global | `getMovieById` | Bloom filter, then cache, then MongoDB; counts a view |
| GET `/:id/similar` | public | global | `getSimilarMovies` | movies that share genres, best rated first |
| GET `/:id/shows?city=&date=` | public | global | `listShowsForMovie` | showtimes grouped by theatre |
| GET `/:id/reviews` | public | global | `listReviews` | newest first, paged |
| PUT `/:id/reviews/me` | verified user | 10 per hour per user | `saveMyReview` | create or update my review, adjust the rating totals with `$inc` |
| DELETE `/:id/reviews/me` | logged in | none | `deleteMyReview` | delete it, take it out of the totals |
| **Watchlist** `/api/watchlist` (all need login) | | | | |
| GET `/` | logged in | global | `getWatchlist` | my watchlist |
| POST `/` | logged in | global | `addToWatchlist` | body `{ movieId }`; adding twice does nothing |
| GET `/:movieId/status` | logged in | global | `checkWatchlistStatus` | returns `{ inWatchlist: true or false }` |
| DELETE `/:movieId` | logged in | global | `removeFromWatchlist` | 404 if it was not there |
| **Shows** `/api/shows` | | | | |
| GET `/:id/seats` | public | global | `getShowSeats` | sold seats from MongoDB, held seats from Redis |
| POST `/:id/scan` | admin | global | `scanTicket` | one atomic update sets `usedAt`; a second scan is refused |
| **Holds** `/api/holds` | | | | |
| POST `/` | verified user | 10 per minute per user | `holdSeats` | body `{ showId, seatIds }`; Lua hold, all or none |
| DELETE `/:holdId` | logged in | global | `releaseHold` | release my own hold |
| **Orders** `/api/orders` (all need login) | | | | |
| POST `/` | verified user | 10 per minute per user | `createOrder` | body `{ holdId }` plus header `Idempotency-Key`; creates `PENDING_PAYMENT` |
| GET `/` | logged in | global | `listMyOrders` | my orders, newest first |
| GET `/:id` | logged in | global | `getOrder` | only my own order |
| POST `/:id/coupon` | logged in | 10 per minute per user, fail closed | `applyCoupon` | atomic coupon claim, recalculate the total |
| DELETE `/:id/coupon` | logged in | global | `removeCoupon` | release the coupon use |
| POST `/:id/pay` | logged in | global | `payOrder` | the transaction: sell seats, mark paid, create tickets |
| POST `/:id/cancel` | logged in | global | `cancelOrder` | cancel a pending order, release hold and coupon |
| GET `/:id/tickets` | logged in | global | `listOrderTickets` | tickets with QR codes |
| **Other** | | | | |
| POST `/api/webhooks/payments` | payment provider | none | `handlePaymentWebhook` | check the signature on the raw body; process each event once |
| GET `/api/offers` | public | global | `listOffers` | public, enabled, in-date coupons |
| GET `/api/me/recommendations` | logged in | global | `getMyRecommendations` | genres of movies I booked or rated high |
| GET `/health` | public | none | (in `app.ts`) | `{ mongo, redis }` |
| **Admin** `/api/admin` (all need admin) | | | | |
| POST `/movies` | admin | global | `createMovie` | also adds the id to the Bloom filter first |
| PATCH `/movies/:id` | admin | global | `updateMovie` | also deletes the cache entry |
| POST `/theatres` | admin | global | `createTheatre` | with its screens |
| POST `/shows` | admin | global | `createShow` | in a transaction: create the show and one `ShowSeat` per seat |
| POST `/coupons` | admin | global | `createCoupon` | also adds the code to the Bloom filter |
| GET `/coupons` | admin | global | `listCoupons` | all coupons |
| PATCH `/coupons/:id` | admin | global | `updateCoupon` | enable, disable, change dates |

"Global" means the whole `/api` area is limited to 300 requests per minute per IP, in `app.ts`.

### 16.2 Route files

**`src/routes/authRoutes.ts`**
```ts
import express from 'express';
import {
  registerUser, loginUser, refreshToken, logoutUser, getCurrentUser,
  verifyEmail, resendVerification, googleLogin,
} from '../controllers/authController';
import auth from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimiter';

const router = express.Router();

router.post('/register', rateLimit({ name: 'register', limit: 5, windowSeconds: 3600, failOpen: false }), registerUser);
router.post('/login', rateLimit({ name: 'login', limit: 5, windowSeconds: 60, failOpen: false }), loginUser);
router.post('/refresh', rateLimit({ name: 'refresh', limit: 30, windowSeconds: 60 }), refreshToken);
router.post('/logout', auth, logoutUser);
router.get('/me', auth, getCurrentUser);
router.post('/verify-email', rateLimit({ name: 'verify', limit: 10, windowSeconds: 3600 }), verifyEmail);
router.post('/resend-verification', rateLimit({ name: 'resend', limit: 3, windowSeconds: 3600, failOpen: false }), resendVerification);
router.post('/google', rateLimit({ name: 'google', limit: 10, windowSeconds: 60, failOpen: false }), googleLogin);

export default router;
```

**`src/routes/movieRoutes.ts`**
```ts
import express from 'express';
import { listMovies, searchMovies, getMovieById, getSimilarMovies } from '../controllers/movieController';
import { listReviews, saveMyReview, deleteMyReview } from '../controllers/reviewController';
import { listShowsForMovie } from '../controllers/showController';
import auth from '../middleware/auth';
import requireVerified from '../middleware/requireVerified';
import { rateLimit } from '../middleware/rateLimiter';

const router = express.Router();

router.get('/', listMovies);
router.get('/search', rateLimit({ name: 'search', limit: 60, windowSeconds: 60 }), searchMovies); // must come before '/:id'
router.get('/:id', getMovieById);
router.get('/:id/similar', getSimilarMovies);
router.get('/:id/shows', listShowsForMovie);

router.get('/:id/reviews', listReviews);
router.put('/:id/reviews/me', auth, requireVerified, rateLimit({ name: 'review', limit: 10, windowSeconds: 3600, by: 'user' }), saveMyReview);
router.delete('/:id/reviews/me', auth, deleteMyReview);

export default router;
```

**`src/routes/watchlistRoutes.ts`**
```ts
import express from 'express';
import { getWatchlist, addToWatchlist, removeFromWatchlist, checkWatchlistStatus } from '../controllers/watchlistController';
import auth from '../middleware/auth';

const router = express.Router();

router.use(auth); // every watchlist route needs a logged-in user

router.get('/', getWatchlist);
router.post('/', addToWatchlist);
router.get('/:movieId/status', checkWatchlistStatus);
router.delete('/:movieId', removeFromWatchlist);

export default router;
```

**`src/routes/showRoutes.ts`**
```ts
import express from 'express';
import { getShowSeats, scanTicket } from '../controllers/showController';
import auth from '../middleware/auth';
import requireAdmin from '../middleware/requireAdmin';

const router = express.Router();

router.get('/:id/seats', getShowSeats); // seat map: sold seats from MongoDB, held seats from Redis
router.post('/:id/scan', auth, requireAdmin, scanTicket);

export default router;
```

**`src/routes/holdRoutes.ts`**
```ts
import express from 'express';
import { holdSeats, releaseHold } from '../controllers/holdController';
import auth from '../middleware/auth';
import requireVerified from '../middleware/requireVerified';
import { rateLimit } from '../middleware/rateLimiter';

const router = express.Router();

router.post('/', auth, requireVerified, rateLimit({ name: 'hold', limit: 10, windowSeconds: 60, by: 'user' }), holdSeats);
router.delete('/:holdId', auth, releaseHold);

export default router;
```

**`src/routes/orderRoutes.ts`**
```ts
import express from 'express';
import {
  createOrder, listMyOrders, getOrder, applyCoupon, removeCoupon,
  payOrder, cancelOrder, listOrderTickets,
} from '../controllers/orderController';
import auth from '../middleware/auth';
import requireVerified from '../middleware/requireVerified';
import { rateLimit } from '../middleware/rateLimiter';

const router = express.Router();

router.use(auth);

router.post('/', requireVerified, rateLimit({ name: 'order', limit: 10, windowSeconds: 60, by: 'user' }), createOrder);
router.get('/', listMyOrders);
router.get('/:id', getOrder);
router.post('/:id/coupon', rateLimit({ name: 'coupon', limit: 10, windowSeconds: 60, by: 'user', failOpen: false }), applyCoupon);
router.delete('/:id/coupon', removeCoupon);
router.post('/:id/pay', payOrder);
router.post('/:id/cancel', cancelOrder);
router.get('/:id/tickets', listOrderTickets);

export default router;
```

**`src/routes/webhookRoutes.ts`**
```ts
import express from 'express';
import { handlePaymentWebhook } from '../controllers/webhookController';

const router = express.Router();

// No login here: the payment provider calls this. The controller checks the signature instead.
router.post('/payments', handlePaymentWebhook);

export default router;
```

**`src/routes/offerRoutes.ts`**
```ts
import express from 'express';
import { listOffers } from '../controllers/couponController';

const router = express.Router();

router.get('/', listOffers);

export default router;
```

**`src/routes/meRoutes.ts`**
```ts
import express from 'express';
import { getMyRecommendations } from '../controllers/recommendationController';
import auth from '../middleware/auth';

const router = express.Router();

router.get('/recommendations', auth, getMyRecommendations);

export default router;
```

**`src/routes/adminRoutes.ts`**
```ts
import express from 'express';
import {
  createMovie, updateMovie, createTheatre, createShow,
  createCoupon, listCoupons, updateCoupon,
} from '../controllers/adminController';
import auth from '../middleware/auth';
import requireAdmin from '../middleware/requireAdmin';

const router = express.Router();

router.use(auth, requireAdmin); // everything here is admin only

router.post('/movies', createMovie);
router.patch('/movies/:id', updateMovie);
router.post('/theatres', createTheatre);
router.post('/shows', createShow);
router.post('/coupons', createCoupon);
router.get('/coupons', listCoupons);
router.patch('/coupons/:id', updateCoupon);

export default router;
```


## 17. Middleware

**`src/middleware/auth.ts`**
```ts
import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/tokens';

// Reads "Authorization: Bearer <token>" and sets req.userId and req.userRole.
const auth = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authenticated' });
  }

  try {
    const payload = verifyAccessToken(header.slice(7));
    req.userId = payload.userId;
    req.userRole = payload.role;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

export default auth;
```

**`src/middleware/requireAdmin.ts`**
```ts
import type { Request, Response, NextFunction } from 'express';

// Use after auth. Who you are (auth) is different from what you may do (this).
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.userRole !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

export default requireAdmin;
```

**`src/middleware/requireVerified.ts`**
```ts
import type { Request, Response, NextFunction } from 'express';
import User from '../models/User';

// Use after auth, on routes that spend money or write public content.
const requireVerified = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.userId).select('emailVerified');

    if (!user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    if (!user.emailVerified) {
      return res
        .status(403)
        .json({ code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email first' });
    }

    next();
  } catch (error) {
    console.error('Require verified error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export default requireVerified;
```

**`src/middleware/rateLimiter.ts`**
```ts
import type { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';
import { redisKeys } from '../utils/redisKeys';

type Options = {
  name: string; // part of the Redis key, for example 'login'
  limit: number; // requests allowed per window
  windowSeconds: number;
  by?: 'ip' | 'user'; // count per IP address or per logged-in user
  failOpen?: boolean; // if Redis is down: true lets the request through, false blocks it
};

// Fixed-window counter. Because the counters live in Redis (not in server memory),
// all copies of the API behind the load balancer share the same limit.
export const rateLimit = ({ name, limit, windowSeconds, by = 'ip', failOpen = true }: Options) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const who = by === 'user' && req.userId ? req.userId : req.ip || 'unknown';
      const key = redisKeys.rateLimit(name, who);

      await redis.set(key, 0, 'EX', windowSeconds, 'NX'); // create the counter once, with a lifetime
      const count = await redis.incr(key); // atomic add

      res.set('X-RateLimit-Limit', String(limit));
      res.set('X-RateLimit-Remaining', String(Math.max(0, limit - count)));

      if (count > limit) {
        const retryAfter = await redis.ttl(key);
        res.set('Retry-After', String(Math.max(1, retryAfter)));
        return res
          .status(429)
          .json({ code: 'RATE_LIMITED', message: 'Too many requests. Please try again later' });
      }

      next();
    } catch (error) {
      console.error('Rate limiter error:', error);
      if (failOpen) {
        return next();
      }
      res.status(503).json({ message: 'Service temporarily unavailable' });
    }
  };
};
```

**`src/middleware/errorHandler.ts`**
```ts
import type { Request, Response, NextFunction } from 'express';

export const notFound = (_req: Request, res: Response) => {
  res.status(404).json({ message: 'Route not found' });
};

// Express knows this is the error handler because it has four arguments.
export const errorHandler = (error: any, _req: Request, res: Response, _next: NextFunction) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON body' });
  }

  console.error('Unhandled error:', error);
  res.status(500).json({ message: 'Server error' });
};
```

Notes on the rate limiter, for the interview:
- `SET key 0 EX 60 NX` creates the counter only if it does not exist, and gives it a 60 second life. `INCR` then adds one, atomically. If the process died between the two commands the counter would never expire, which is why the lifetime is set in the same command as the creation.
- Weakness: a burst at the edge of two windows can send up to double the limit. The upgrade is a sliding window or token bucket.
- Because the counter is in Redis, three copies of the API behind nginx share one limit.
- `enableOfflineQueue: false` in `config/redis.ts` makes Redis commands fail at once when Redis is down. Without it every request would hang while Redis is away. With it, login is blocked (fail closed) and browsing continues (fail open).
- Access tokens last 15 minutes, so a logout stops the refresh token immediately but the current access token works until it expires. Say this out loud in an interview: it is a known trade-off of short-lived JWTs.

## 18. App, server and stub controllers

**`src/app.ts`**
```ts
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { isDbReady } from './config/db';
import { redis } from './config/redis';
import { rateLimit } from './middleware/rateLimiter';
import { notFound, errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/authRoutes';
import movieRoutes from './routes/movieRoutes';
import watchlistRoutes from './routes/watchlistRoutes';
import showRoutes from './routes/showRoutes';
import holdRoutes from './routes/holdRoutes';
import orderRoutes from './routes/orderRoutes';
import webhookRoutes from './routes/webhookRoutes';
import offerRoutes from './routes/offerRoutes';
import meRoutes from './routes/meRoutes';
import adminRoutes from './routes/adminRoutes';

const app = express();

// Behind nginx, req.ip must be the real client. Set TRUST_PROXY=1 when nginx is in front.
app.set('trust proxy', env.trustProxy);

// Shows which copy of the API answered. You will use this to see load balancing work.
app.use((_req, res, next) => {
  res.set('X-Served-By', env.instanceName);
  next();
});

app.use(cors({ origin: env.clientUrl, credentials: true }));

// The payment webhook needs the raw body to check the signature, so it comes BEFORE express.json()
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/health', async (_req, res) => {
  let redisReady = false;
  try {
    redisReady = (await redis.ping()) === 'PONG';
  } catch {
    redisReady = false;
  }
  const checks = { mongo: isDbReady(), redis: redisReady };
  const ready = checks.mongo && checks.redis;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'not ready', checks });
});

app.use('/api', rateLimit({ name: 'global', limit: 300, windowSeconds: 60 }));

app.use('/api/auth', authRoutes);
app.use('/api/movies', movieRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/shows', showRoutes);
app.use('/api/holds', holdRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/me', meRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
```

**`src/server.ts`**
```ts
import app from './app';
import { env } from './config/env';
import { connectDb } from './config/db';
import { waitForRedis } from './config/redis';

const startServer = async () => {
  await connectDb();
  await waitForRedis();

  // Added in later weeks, in this order:
  // await buildBloomFilters();   // Week 10: fill the Bloom filters from MongoDB
  // startJobs();                 // Weeks 5 and 10: expire unpaid orders, flush view counts

  app.listen(env.port, () => {
    console.log(`QueueSkip API (${env.instanceName}) listening on port ${env.port}`);
  });
};

startServer().catch((error) => {
  console.error('Start server error:', error);
  process.exit(1);
});
```

**Stub controllers.** Create each controller file with every handler answering 501, so the whole app starts and every route exists on day one. Replace one stub at a time as you build each feature. A stub looks like this:
```ts
import type { Request, Response } from 'express';

export const holdSeats = async (_req: Request, res: Response) => {
  res.status(501).json({ message: 'Not built yet' });
};
```
The handlers to create, per file (42 in total):

| File | Handlers |
|---|---|
| `authController.ts` | `registerUser`, `loginUser`, `refreshToken`, `logoutUser`, `getCurrentUser`, `verifyEmail`, `resendVerification`, `googleLogin` |
| `movieController.ts` | `listMovies`, `searchMovies`, `getMovieById`, `getSimilarMovies` |
| `reviewController.ts` | `listReviews`, `saveMyReview`, `deleteMyReview` |
| `watchlistController.ts` | `getWatchlist`, `addToWatchlist`, `removeFromWatchlist`, `checkWatchlistStatus` |
| `showController.ts` | `listShowsForMovie`, `getShowSeats`, `scanTicket` |
| `holdController.ts` | `holdSeats`, `releaseHold` |
| `orderController.ts` | `createOrder`, `listMyOrders`, `getOrder`, `applyCoupon`, `removeCoupon`, `payOrder`, `cancelOrder`, `listOrderTickets` |
| `webhookController.ts` | `handlePaymentWebhook` |
| `couponController.ts` | `listOffers` |
| `recommendationController.ts` | `getMyRecommendations` |
| `adminController.ts` | `createMovie`, `updateMovie`, `createTheatre`, `createShow`, `createCoupon`, `listCoupons`, `updateCoupon` |

When you build a real handler, use the controller pattern from section 7: one `try/catch`, early-return checks, `{ message }` errors, `console.error('Hold seats error:', error)`.

## 19. Input rules and status codes

**Check these in the controller, before touching the database.**

| Input | Rule |
|---|---|
| Any `:id` in a path | must be a valid ObjectId (`mongoose.Types.ObjectId.isValid`), otherwise 400 |
| `name` | 2 to 60 characters |
| `email` | contains one `@` and a dot after it; lowercase and trim it first |
| `password` | 8 to 72 characters (bcrypt ignores everything after 72 bytes) |
| `page`, `limit` | `page` at least 1; `limit` 1 to 100, default 20 |
| Review `rating` | whole number 1 to 10 |
| Review `body` | up to 2000 characters, treated as plain text |
| `seatIds` in a hold | 1 to 6 distinct valid ids, all belonging to the show |
| `Idempotency-Key` header | required on `POST /api/orders`, 8 to 64 characters |
| Coupon `code` | 1 to 30 characters; uppercase and trim it first |
| Webhook | the signature header must match the HMAC of the raw body |

| Code | Meaning in QueueSkip |
|---|---|
| 200 / 201 | ok / created |
| 400 | invalid input or invalid id |
| 401 | not logged in, or the token is wrong or expired |
| 403 | logged in but not allowed (not admin, or `EMAIL_NOT_VERIFIED`) |
| 404 | not found (also: remove from a watchlist where it was not) |
| 409 | conflict: `SEAT_UNAVAILABLE`, duplicate, or "someone else already did it" |
| 410 | the hold expired |
| 422 | a business rule failed (for example an invalid coupon) |
| 429 | rate limited, with a `Retry-After` header |
| 501 | route exists but is not built yet |
| 503 | Redis or MongoDB is down and the route cannot work without it |

## 20. Redis keys

All are built in `utils/redisKeys.ts`. Nearly everything has a lifetime, so memory stays small and Redis can run with `noeviction`.

| Key | Holds | Lifetime | Written by |
|---|---|---|---|
| `hold:{showId}:{seatId}` | the hold id | 300 s, extended to 600 s when an order is created | `holdSeats` (Lua) |
| `holdInfo:{holdId}` | JSON `{ showId, userId, seatIds }` | same as the hold | `holdSeats` |
| `userHold:{userId}:{showId}` | the user's current hold id (one per show; a new hold releases the old one) | same | `holdSeats` |
| `rl:{name}:{ipOrUser}` | request counter | the window (for example 60 s) | `rateLimit` |
| `movie:{id}` | movie JSON | 60 s | `getMovieById` (cache-aside) |
| `similar:{id}` | similar movie ids | 1 hour | `getSimilarMovies` |
| `bloom:movies`, `bloom:coupons` | the Bloom filter bits | none (rebuilt at start) | `bloomFilter.ts` |
| `views:pending` | hash of movieId to view count | none (flushed every 10 s) | `getMovieById` |
| `views:flushing` | the batch being written | none (deleted after the write) | `flushViews` |
| `lock:{jobName}` | which server runs the job | slightly less than the job interval | the jobs |

## 21. Background jobs and server start

Jobs are plain `setInterval` timers started in `server.ts`. All three copies of the API run them, so each job first takes a lock in Redis and skips the run if another copy has it.

**`expireOrders.ts` (every 60 s, Week 5):**
1. `SET lock:expireOrders <instanceName> NX EX 55`. If it does not return OK, stop.
2. Find orders with `status: 'PENDING_PAYMENT'` and `expiresAt` in the past (limit 100).
3. For each: `findOneAndUpdate({ _id, status: 'PENDING_PAYMENT' }, { status: 'EXPIRED' })`. If it returned an order, release its coupon use (`$inc usedCount -1`, `$pull usedBy`) and delete its Redis hold keys with `releaseSeats.lua`.

**`flushViews.ts` (every 10 s, Week 10):**
1. Take the lock `lock:flushViews`.
2. If `views:flushing` already exists (a crash last time), write that batch first.
3. `RENAME views:pending views:flushing` (if `views:pending` is missing, nothing to do).
4. Read the hash, run one `Movie.bulkWrite` with a `$inc` of `viewCount` per movie, then delete `views:flushing`.

**Server start order (`server.ts`):** connect MongoDB, wait for Redis, build the Bloom filters from MongoDB (Week 10), start the jobs, start listening.

## 22. Seed data (`scripts/seed.ts`)

Run with `npm run seed`. It clears the collections first, then creates:
- 1 admin (`admin@queueskip.test`) and 2 normal users, all with `emailVerified: true`
- 12 movies across several genres, each with 4 to 6 cast members
- 2 theatres: one with screens of 8 rows by 10 seats, one with 6 rows by 12 seats
- shows for the next 7 days (2 to 3 per movie per day), each with its `ShowSeat` documents
- 3 coupons: one percent, one flat, one with `maxUses: 1` (for the coupon check)

Use fake posters and fake data only.

## 23. Frontend routes (Weeks 13 to 16)

| URL | Page | Needs login |
|---|---|---|
| `/` | `HomePage` (now showing, upcoming, offers, genre rows) | no |
| `/login`, `/register` | `LoginPage`, `RegisterPage` | no |
| `/verify-email?token=` | `VerifyEmailPage` | no |
| `/search?q=` | `SearchPage` | no |
| `/movies/:id` | `MovieDetailPage` (cast, reviews, similar, watchlist button) | no |
| `/movies/:id/shows` | `ShowtimesPage` | no |
| `/shows/:id/seats` | `SeatSelectionPage` (seat map, hold timer) | yes |
| `/checkout/:orderId` | `CheckoutPage` (coupon, pay) | yes |
| `/tickets` | `MyTicketsPage` (orders and QR codes) | yes |
| `/watchlist` | `WatchlistPage` | yes |
| `/admin` | `AdminPage` (movies, shows, coupons, scanner) | admin |

## 24. What was checked, and what was not

**Checked** (compiled with TypeScript 7 and run in a sandbox against a real Redis):
- every file in sections 13 to 18 compiles with no errors, with `strict` on
- all 11 route files load and every route answers: stubs give 501, a missing token gives 401, an unknown route gives 404, bad JSON gives 400, and `/api/movies/search` is not swallowed by `/:id`
- `holdSeats.lua`: a free group is held; an overlapping group is refused and **none** of it is held; the hold has a 300 second life; 50 parallel holds on one seat give exactly one winner
- `releaseSeats.lua`: releasing with the wrong hold id deletes nothing; with the right id it deletes the seats
- the rate limiter: the 6th login in a minute gets 429 with `Retry-After`
- Redis down: login answers 503 in about 20 ms (fail closed), browsing still works, and everything recovers when Redis returns
- model rules: bad enum, short name, rating 5.5 or 11, 30 rows in a screen, missing required fields are all rejected; emails are lowercased and coupon codes uppercased

**Not checked** (no MongoDB in the sandbox): that unique indexes reject duplicates, transactions, text search, and `$expr` coupon claims. You verify those by hand in Weeks 1 to 7 with `mongosh`, as the "Done when" column says.

## 25. Rule

Finish one feature, check it by hand, look at the database, then move on. Do not start the next thing while the current one is half done.