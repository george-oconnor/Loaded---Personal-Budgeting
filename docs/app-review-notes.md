# App Review notes — Loaded v1.1.0

Paste the relevant parts into App Store Connect. The **App Review Information →
Notes** field is the important one; the demo-account fields don't apply (there
is no username/password — see below).

---

## App Review Information → Notes

```
HOW TO SIGN IN
This app uses "Sign in with Apple" as its only sign-in method — there is no
username/password and no demo account is required. Please sign in with any
Apple ID.

ICLOUD IS REQUIRED
All user data is stored privately in the user's own iCloud (CloudKit), not on
our servers. Before signing in, please make sure the device is signed into
iCloud (Settings → [your name] → iCloud). If iCloud is not available, the app
shows a screen asking you to sign in to iCloud — this is expected.

SEEING A POPULATED APP (IMPORTANT)
Because data lives in each user's private iCloud, a brand-new sign-in starts
empty. To review the app with realistic data:
  1. Complete the short onboarding (you can tap "Skip intro", choose
     "No, I'm new here", enter any name, and set any budget).
  2. Go to the Profile tab (top-right avatar) → tap "Load Sample Data".
This populates example transactions, budgets, and account balances so you can
review all features. "Remove Sample Data" clears it again.

ACCOUNT DELETION
Account deletion is available in Profile → "Delete Account". It permanently
removes all of the user's data from iCloud.

WHAT THE APP DOES
Loaded is a personal budgeting app: track spending, set monthly budgets by
category, view analytics, and import transactions from bank statements
(Revolut, AIB, or CSV). It is ad-free and does not track users.
```

---

## TestFlight → "What to Test" (for external testers)

```
v1.1.0 — now powered by iCloud (CloudKit).

- Sign in with Apple (make sure you're signed into iCloud on the device).
- New here? The onboarding walks you through name + first budget. Try
  Profile → "Load Sample Data" to explore with example data.
- Existing Loaded user? On the sign-in screen tap "Migrating from an email
  account?" (or choose "Yes, import my data" in onboarding) to bring your old
  transactions, budgets and balances across to iCloud.
- Please report anything that looks wrong after importing.
```

---

## Guideline notes (for our reference)

- **4.8 Sign in with Apple** — it's the only login method, so this is satisfied.
- **5.1.1(v) Account deletion** — Profile → Delete Account (CloudKit zone wipe).
- **Export compliance** — `ITSAppUsesNonExemptEncryption: false` is set, so no
  encryption questionnaire on upload.
- **Demo account fields** — leave blank / N/A; sign-in needs only an Apple ID.
- Reviewers **must** be signed into iCloud or the app will (correctly) gate at
  the "sign in to iCloud" screen — call this out so it isn't mistaken for a bug.
