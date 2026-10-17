# Arabic and English localization

## Architecture

- **Messages.** `apps/web/src/i18n/messages.ts` holds English and Arabic messages. The Arabic table is
  typed against the English keys, so a missing translation is a type error. Navigation labels and
  figures computed in `@aegis/core` (Control Center tiles, health checks, readiness areas, deployment
  models) are translated by their stable key; their computed details stay as computed.
- **Language choice.** The organization sets a default language in Settings. Each person can switch
  from their account menu; the choice is kept in the `aegis-locale` cookie (HTTP only, one year) and
  changes presentation only.
- **Server and client.** `getConsoleContext` resolves the region (language, time zone, currency) once
  per request and stores it in a request-scoped cache; server components use `t()` from
  `i18n/server.ts`. Client components read the same region from `RegionProvider` with `useT()` and
  `useRegion()`, so server and browser render the same text.
- **Direction.** In Arabic the console shell renders `dir="rtl"` and the document element follows, so
  menus and dialogs rendered outside the shell are right to left too. Layout uses logical properties
  (`ms`, `me`, `ps`, `pe`, `start`, `end`), which flip automatically. English text computed by the
  server is isolated with `dir="auto"` or `<bdi>` so its punctuation stays in place.
- **Formats.** Dates use `en-GB` or `ar-AE` with Western digits, in the organization's time zone.
  Amounts use the organization's currency.

## Coverage today

Translated: the console shell and navigation, theme and shortcut labels, the Control Center, System
Health and Deployment pages. Other pages show English inside the Arabic layout, and the account menu
says so. The public website is English only.

## Adding a translation

1. Add the English key and text to `en` in `messages.ts`.
2. Add the Arabic entry to `ar` (TypeScript fails until you do).
3. Use `t("key")` in a server component or `useT().t("key")` in a client component.

Arabic text in this repository was written without a professional translator's review; review it with
a native-speaking reviewer before a customer launch.
