# BookHaven

An online bookstore with a lending desk. 101 real books, sign-in, five access levels, and a staff dashboard. It runs fully in the cloud for free. **No Docker, no AWS, no card needed.**

## Sample logins

| Role | Email | Password |
|---|---|---|
| Admin | `admin@bh.com` | `Book@123` |
| Librarian | `librarian@bh.com` | `Book@123` |
| Customer | `customer@bh.com` | `Book@123` |

Change the password at seed time with `SEED_PASSWORD` (see step 2) before sharing the link publicly.

## What each role can do

| Role | Can do |
|---|---|
| Customer | Browse, wishlist, cart, checkout, see own orders and loans |
| Staff | Issue and return loans, see dashboard |
| Librarian | Everything Staff can, plus add books, edit stock and prices |
| Auditor | Read-only view of dashboard, users and audit log |
| Admin | Everything, plus delete books and change user roles |

Rules are enforced by the server on every request, not just hidden in the screen.

## Deploy in 8 steps (all free)

You need free accounts on **GitHub**, **Supabase**, **Render** and **Vercel**.

**1. Supabase (database).** Open your project > **Connect** > **Session pooler** and copy the connection string. Replace `[YOUR-PASSWORD]` with your database password. Use the *Session pooler* string, not "Direct connection": it works on free hosts.

**2. Load the books (once, from your computer).** Needs Node.js 20+.
```
cd backend
copy .env.example .env
```
Open `backend/.env`, paste the connection string into `DATABASE_URL`, and set `JWT_SECRET` to any random 32+ characters. Then:
```
npm install
npx prisma db push
npm run db:seed
```
`db:seed` prints `Ready: 101 books in the shop.` It is safe to run again. If your tables already exist, `db push` changes nothing. Old `@bookhaven.demo` accounts are renamed to the short logins above.

**3. Lock the database.** In Supabase open **SQL Editor**, paste the contents of `backend/prisma/lockdown.sql`, and run it. This blocks anyone from reaching your tables through Supabase's public data API. The website keeps working because only the BookHaven server talks to the database.

**4. Put the code on GitHub.** Create an empty repo and push this whole folder (the `.gitignore` keeps secrets out).

**5. Render (the server).** Render > **New** > **Blueprint** > pick your repo. It reads `render.yaml`. When asked, enter:
- `DATABASE_URL`: the same Session pooler string
- `FRONTEND_ORIGIN`: leave as `http://localhost:5173` for now

Wait for "Live", then open `https://YOUR-APP.onrender.com/api/health`. You should see `"status":"ok"`. Copy the site address.

**6. Vercel (the website).** Vercel > **Add New Project** > pick the repo. Set **Root Directory** to `frontend`. Add environment variable `VITE_API_URL` = `https://YOUR-APP.onrender.com/api` (note the `/api` at the end). Deploy and copy your Vercel address.

**7. Connect them.** In Render > your service > **Environment**, set `FRONTEND_ORIGIN` to your Vercel address with no trailing slash, for example `https://bookhaven.vercel.app`. Render redeploys by itself.

**8. Test.** Open the Vercel address. Check: home page loads with books, sign in as admin, add a book, sign in as customer, buy a book, sign in as librarian, issue and return a loan.

Optional: on uptimerobot.com (free) add an HTTP monitor for `/api/health` every 5 minutes so the server does not fall asleep.

## Cloud principles applied

| Principle | How BookHaven applies it |
|---|---|
| Managed database (DBaaS) | PostgreSQL runs on Supabase. No database server to install or patch. |
| Platform as a Service | The server runs on Render from Git, with a health check and automatic redeploys on every push. |
| Static hosting and CDN | The website is built once and served from Vercel's global network. |
| Three separate tiers | Website, server and database are deployed separately and can be changed or scaled on their own. |
| Stateless services | The server keeps no sessions in memory. Login uses signed tokens, so more copies of the server can run side by side. |
| Configuration outside code | Passwords, database address and secrets live only in environment variables. The server refuses to start without a strong `JWT_SECRET`. |
| Identity and access (IAM) | Five roles with least privilege, checked on the server. Every denied attempt is written to an audit log. |
| Defence in depth | Passwords are hashed with bcrypt. Helmet security headers, request rate limiting, an allow-list of website addresses (CORS), input validation, and Row Level Security on every table. |
| Encryption in transit | Website, server and database connections all use HTTPS or TLS. |
| Monitoring | `/api/health` for uptime checks, plus the in-app audit log for security events. |
| Pay-as-you-go cost | Runs on free plans. Nothing is created that bills automatically. |

Honest limits of the free plans: Render sleeps after about 15 minutes idle (the first visit after that takes up to a minute), and Supabase pauses projects after about a week with no activity (click Restore). Automatic scaling and managed backups need paid plans.

## Run on your computer (optional)

Two terminals. In `backend`: `npm run dev`. In `frontend`: copy `.env.example` to `.env.local`, set `VITE_API_URL=http://localhost:4000/api`, then `npm install` and `npm run dev`. Open http://localhost:5173.

## Troubleshooting

| Problem | Fix |
|---|---|
| Books do not load, or a red error appears | Wait a minute (server waking up), then refresh. Check `FRONTEND_ORIGIN` matches the Vercel address exactly. |
| Seed cannot connect | Use the *Session pooler* string and check the password has no stray brackets. |
| Sign-in says wrong password | Run `npm run db:seed` again. |
| Some covers show a plain brown cover | Expected when the cover service has no image for that book. |
