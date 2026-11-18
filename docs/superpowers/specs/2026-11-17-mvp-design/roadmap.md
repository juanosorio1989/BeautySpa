# Roadmap after the MVP

## Phase 2 — money and depth
Stripe deposits/prepayment per service (reusing holds), SMS reminders turned on
after 10DLC approval, client history, technical file (color formulas, notes,
before/after photos on R2 with signed URLs, allergies, signed consents),
encrypted and role-restricted.

## Phase 3 — retention and business
Loyalty points, packages/memberships, gift cards (Stripe), coupons, waitlist
(auto-offer freed slots via BullMQ), reviews per service, commissions and tips,
reports (revenue, occupancy, top services, employee performance, no-shows,
retention), birthday and reactivation campaigns.

## Scale to many salons (when sellable)
1. Turn on Postgres RLS keyed by `organization_id` (set per transaction).
2. Resolve tenant from subdomain (`{slug}.<product-domain>`), later custom
   domains.
3. Salon onboarding wizard, platform admin panel, subscription billing.
4. Stripe Connect so deposits go to each salon.
5. One WhatsApp sender per salon (Twilio subaccounts / WhatsApp senders), with
   per-salon approved templates.

## Native app (Expo)
1. Create `apps/mobile` with Expo Router.
2. Reuse `contracts`, `api-client` (with a SecureStore `TokenStore`),
   `availability`, `datetime`, `i18n`.
3. Auth: same endpoints; refresh token in the body instead of a cookie.
4. Add `PushProvider` (Expo push) to the notification router and a
   `device_token` table. No API redesign needed.

## Later
Google/Apple sign-in for clients; POS and inventory if salons ask for it.
