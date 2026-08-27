# TruckOps API

Express + MongoDB backend for the Truck Dispatch Management System.

## Scripts

- `npm run dev` — start API with hot reload
- `npm run seed` — seed demo Individual + Company accounts
- `npm run build` / `npm start` — production

## Critical modules

- `src/lib/scope.ts` — tenant + user scoping (never remove)
- `src/middleware/auth.ts` — JWT session from cookie/Bearer
- `src/routes/auth.ts` — register / login / logout / me
