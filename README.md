# Lady Bulldog Invitational — Version 12 Live Hub

This is a **deployable starter project**, not an already deployed website. The existing Version 11 bracket and scheduling code is preserved in `admin.html`. `index.html` is the public read-only view. No text messages are sent until Firebase and Twilio are configured and deployed.

## Deploy

1. Create a Firebase project and enable **Cloud Firestore**, **Email/Password Authentication**, **Cloud Functions**, **App Check** (reCAPTCHA Enterprise for web), and **Hosting**. Firebase Blaze billing is required for Cloud Functions.
2. Replace values in `firebase-config.js` with your project's web app configuration. Serve these files over HTTPS, not `file://`.
3. Install Firebase CLI (`npm install -g firebase-tools`), sign in (`firebase login`), then in this directory run `firebase use --add` to select your project.
4. Install backend dependencies: `cd functions && npm install && cd ..`.
5. Set secrets with `firebase functions:secrets:set TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, and `TWILIO_PHONE_NUMBER`.
6. Run `firebase deploy --only firestore:rules,functions,hosting`.
7. In Firebase Authentication create an administrator account. In Firestore, create document `admins/<that user's UID>` with a field such as `role: "admin"`. This document must be created by the Firebase console / privileged administrator, never by the public website.
8. Configure Firebase App Check for your site and initialize it in both web pages with your site key **before** invoking the subscription functions; the starter intentionally enforces App Check on SMS endpoints. Without this step SMS signup will fail closed. Set up Firebase App Check following current Firebase documentation.
9. In Twilio set the SMS inbound webhook to the deployed `inboundSms` HTTPS URL and configure environment variable `TWILIO_WEBHOOK_URL` to that **exact public URL** in the function's runtime configuration. The webhook rejects requests without a matching signed URL. Verify STOP handling in a real device test before announcing signup.
10. Set up Twilio A2P 10DLC / toll-free verification and compliant consent disclosures as applicable. Confirm Twilio Verify, SMS sender, carrier compliance, budget limits, and school/district data policies before launch.
11. Visit `/admin.html`, sign in, and publish a change; coaches visit `/` and see updates through Firestore listeners.

## Important implementation notes

- Public Firestore read access currently exposes the `tournaments/lady-bulldog` document, which contains team names, matchups and scores, **not phone numbers**. Phone numbers are in protected `subscriptions` documents, readable only by backend functions.
- The original admin still uses localStorage as a local backup; the live Firestore document becomes the shared source when signed in. Avoid editing simultaneously from multiple admin devices until conflict resolution is added.
- Cloud saves are debounced and **not transactional**; do not consider this production-hardened without conflict/rollback tests. Public updates are immediate once Firestore confirms a save.
- Text alerts fire only for **new or changed confirmed next games**, not for every score. The backend compares before/after bracket state. Dedupe is per Firestore event/subscriber. Phone verification and opt-in are required.
- SMS onboarding needs Firebase App Check initialized on both web clients; the provided client files are not preconfigured with your reCAPTCHA key.
- The current consolation scheduler has **not** been proven for every possible tournament outcome. Review three-game guarantees and rest before using it at a real event.
- Poster PDF is available in the admin bracket. Public browser print is available; a public 90 × 30-inch PDF exporter can be added later.
- This is a technical foundation. Before live use, test on real devices, apply rate limits to SMS enrollment, add admin audit history, data retention, consent records, and reliable unsubscribe workflows.
