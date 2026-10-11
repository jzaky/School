# Third-party inventory

Generated on 2026-10-11 from `pnpm licenses list -P` over production dependencies of every workspace package (428 packages after deduplication). Development-only tooling (TypeScript, Vitest, Playwright, ESLint, Prettier, tsx) is MIT or Apache-2.0 and is not shipped.

## Direct dependencies and why they are used

| Package | License | Use |
|---|---|---|
| @prisma/client, prisma | Apache-2.0 | Database client and migrations |
| pg | MIT | PostgreSQL driver for migration scripts |
| fastify, @fastify/* , fastify-plugin | MIT | API server, CORS, Helmet headers, rate limiting, cookies, multipart |
| next, react, react-dom | MIT | Console and public site |
| radix-ui, cmdk, lucide-react, sonner | MIT | UI primitives, command palette, icons, toasts |
| @tanstack/react-table, @tanstack/react-query | MIT | Tables and data fetching |
| @xyflow/react | MIT | Visual policy editor canvas |
| recharts | MIT | Charts (depends on victory-vendor, MIT AND ISC) |
| framer-motion | MIT | Transitions |
| tailwindcss, @tailwindcss/postcss, clsx, tailwind-merge, class-variance-authority | MIT | Styling |
| zod | MIT | Validation |
| argon2 | MIT | Password hashing (argon2id) |
| jose | MIT | JWT and JWKS verification for OpenID Connect |
| ajv, ajv-formats | MIT | JSON Schema validation of tool parameters |
| pino | MIT | Structured logging with redaction |
| ioredis | MIT | Redis client |
| @opentelemetry/* | Apache-2.0 | Tracing and metrics |
| pdfkit | MIT | PDF report generation |
| pdf-parse | MIT | PDF text extraction (bundles pdf.js, Apache-2.0) |
| mammoth | BSD-2-Clause | DOCX text extraction |
| dotenv | BSD-2-Clause | Environment loading |
| date-fns | MIT | Date formatting |
| qrcode | MIT | MFA enrolment QR codes |

## Licenses requiring attention

- @img/sharp-libvips-linux-x64@1.3.4: LGPL-3.0-or-later. Prebuilt libvips binaries that the optional `sharp` image library (used by Next.js image optimization) depends on. AEGIS does not process user images; the dependency can be removed by disabling Next.js image optimization (`images.unoptimized`) if legal review prefers not to ship LGPL binaries. Flagged for human legal review.
- @img/sharp-libvips-linuxmusl-x64@1.3.4: LGPL-3.0-or-later. Prebuilt libvips binaries that the optional `sharp` image library (used by Next.js image optimization) depends on. AEGIS does not process user images; the dependency can be removed by disabling Next.js image optimization (`images.unoptimized`) if legal review prefers not to ship LGPL binaries. Flagged for human legal review.
- caniuse-lite@1.0.30001815: CC-BY-4.0. Browser compatibility data (caniuse-lite) used at build time by Next.js and Tailwind; attribution satisfied by this inventory.
- duck@0.1.12: BSD. Legacy BSD identifier without a clause count (duck, a transitive dependency of mammoth); treated as BSD-3-Clause, flagged for review.
- jszip@3.10.2: (MIT OR GPL-3.0-or-later). Dual licensed; AEGIS uses it under the MIT option.
- tslib@2.8.1: 0BSD. Legacy BSD identifier without a clause count (duck, a transitive dependency of mammoth); treated as BSD-3-Clause, flagged for review.

## Adapted code

No source code was copied from any third-party repository. Algorithms implemented from public specifications: Luhn checksum, IBAN mod-97 (ISO 7064), RFC 6238 TOTP, RFC 8785-style canonical JSON, BM25 (Robertson and Zaragoza), PKCE (RFC 7636). Patterns studied from public documentation only: Open Policy Agent (decision input and explanation model), Cerbos (readable resource policy shape), Microsoft Presidio (recognizer and anonymizer registry), XACML (deny-overrides combining). Nothing was taken from AGPL or GPL repositories.

## Full production inventory by license

### (MIT AND Zlib) (1)

pako@1.0.11

### (MIT OR GPL-3.0-or-later) (1)

jszip@3.10.2

### 0BSD (1)

tslib@2.8.1

### Apache-2.0 (52)

@grpc/grpc-js@1.14.6, @grpc/proto-loader@0.8.1, @img/sharp-linux-x64@0.35.5, @img/sharp-linuxmusl-x64@0.35.5, @opentelemetry/api@1.9.1, @opentelemetry/api-logs@0.57.2, @opentelemetry/context-async-hooks@1.30.1, @opentelemetry/core@1.30.1, @opentelemetry/exporter-logs-otlp-grpc@0.57.2, @opentelemetry/exporter-logs-otlp-http@0.57.2, @opentelemetry/exporter-logs-otlp-proto@0.57.2, @opentelemetry/exporter-metrics-otlp-grpc@0.57.2, @opentelemetry/exporter-metrics-otlp-http@0.57.2, @opentelemetry/exporter-metrics-otlp-proto@0.57.2, @opentelemetry/exporter-prometheus@0.57.2, @opentelemetry/exporter-trace-otlp-grpc@0.57.2, @opentelemetry/exporter-trace-otlp-http@0.57.2, @opentelemetry/exporter-trace-otlp-proto@0.57.2, @opentelemetry/exporter-zipkin@1.30.1, @opentelemetry/instrumentation@0.57.2, @opentelemetry/otlp-exporter-base@0.57.2, @opentelemetry/otlp-grpc-exporter-base@0.57.2, @opentelemetry/otlp-transformer@0.57.2, @opentelemetry/propagator-b3@1.30.1, @opentelemetry/propagator-jaeger@1.30.1, @opentelemetry/resources@1.30.1, @opentelemetry/sdk-logs@0.57.2, @opentelemetry/sdk-metrics@1.30.1, @opentelemetry/sdk-node@0.57.2, @opentelemetry/sdk-trace-base@1.30.1, @opentelemetry/sdk-trace-node@1.30.1, @opentelemetry/semantic-conventions@1.28.0, 1.43.0, @playwright/test@1.56.1, @prisma/client@6.19.3, @prisma/config@6.19.3, @prisma/debug@6.19.3, @prisma/engines@6.19.3, @prisma/engines-version@7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7, @prisma/fetch-engine@6.19.3, @prisma/get-platform@6.19.3, @swc/helpers@0.5.15, 0.5.23, class-variance-authority@0.7.1, cluster-key-slot@1.1.1, denque@2.1.0, detect-libc@2.1.2, import-in-the-middle@1.15.0, long@5.3.2, playwright@1.56.1, playwright-core@1.56.1, prisma@6.19.3, sharp@0.35.5, typescript@5.9.3

### BSD (1)

duck@0.1.12

### BSD-2-Clause (6)

dingbat-to-unicode@1.0.2, dotenv@16.6.1, lop@0.4.2, mammoth@1.13.0, option@0.2.4, shimmer@1.2.1

### BSD-3-Clause (18)

@protobufjs/aspromise@1.1.2, @protobufjs/base64@1.1.2, @protobufjs/codegen@2.0.5, @protobufjs/eventemitter@1.1.1, @protobufjs/fetch@1.1.1, @protobufjs/float@1.0.2, @protobufjs/path@1.1.2, @protobufjs/pool@1.1.0, @protobufjs/utf8@1.1.2, d3-ease@3.0.1, deepmerge-ts@7.1.5, fast-uri@3.1.8, 4.2.2, light-my-request@6.8.0, protobufjs@7.6.6, react-transition-group@4.4.5, secure-json-parse@4.1.1, source-map-js@1.2.2, sprintf-js@1.0.3

### CC-BY-4.0 (1)

caniuse-lite@1.0.30001815

### ISC (32)

cliui@6.0.0, 8.0.1, d3-array@3.2.4, d3-color@3.1.0, d3-dispatch@3.0.1, d3-drag@3.0.0, d3-format@3.1.2, d3-interpolate@3.0.1, d3-path@3.1.0, d3-scale@4.0.2, d3-selection@3.0.0, d3-shape@3.2.0, d3-time@3.1.0, d3-time-format@4.1.0, d3-timer@3.0.1, d3-transition@3.0.1, d3-zoom@3.0.0, fastq@1.20.3, get-caller-file@2.0.5, inherits@2.0.4, internmap@2.0.3, isexe@2.0.0, lucide-react@0.577.0, pg-int8@1.0.1, picocolors@1.1.1, require-main-filename@2.0.0, semver@7.8.5, set-blocking@2.0.0, split2@4.2.0, which@2.0.2, which-module@2.0.1, y18n@4.0.3, 5.0.8, yargs-parser@18.1.3, 21.1.1

### LGPL-3.0-or-later (2)

@img/sharp-libvips-linux-x64@1.3.4, @img/sharp-libvips-linuxmusl-x64@1.3.4

### MIT (312)

@babel/runtime@7.29.10, @epic-web/invariant@1.0.0, @fastify/ajv-compiler@4.0.7, @fastify/busboy@3.2.3, @fastify/cookie@11.1.3, @fastify/cors@11.3.1, @fastify/deepmerge@3.2.2, @fastify/error@4.2.1, @fastify/fast-json-stringify-compiler@5.1.1, @fastify/forwarded@3.1.1, @fastify/helmet@13.1.2, @fastify/merge-json-schemas@0.2.2, @fastify/multipart@9.4.0, @fastify/proxy-addr@5.1.2, @fastify/rate-limit@10.3.0, @floating-ui/core@1.8.0, @floating-ui/dom@1.8.0, @floating-ui/react-dom@2.1.9, @floating-ui/utils@0.2.12, @img/colour@1.1.0, @ioredis/commands@1.10.0, @js-sdsl/ordered-map@4.4.2, @lukeed/ms@2.0.2, @next/env@15.5.26, @next/swc-linux-x64-gnu@15.5.26, @next/swc-linux-x64-musl@15.5.26, @noble/ciphers@1.3.0, @noble/hashes@1.8.0, @phc/format@1.0.0, @pinojs/redact@0.4.0, @radix-ui/number@1.1.3, @radix-ui/primitive@1.1.7, @radix-ui/react-accessible-icon@1.1.16, @radix-ui/react-accordion@1.2.21, @radix-ui/react-alert-dialog@1.1.24, @radix-ui/react-arrow@1.1.16, @radix-ui/react-aspect-ratio@1.1.16, @radix-ui/react-avatar@1.2.7, @radix-ui/react-checkbox@1.3.12, @radix-ui/react-collapsible@1.1.21, @radix-ui/react-collection@1.1.16, @radix-ui/react-compose-refs@1.1.5, @radix-ui/react-context@1.2.2, @radix-ui/react-context-menu@2.3.8, @radix-ui/react-dialog@1.2.0, @radix-ui/react-direction@1.1.5, @radix-ui/react-dismissable-layer@1.1.20, @radix-ui/react-dropdown-menu@2.1.25, @radix-ui/react-focus-guards@1.1.6, @radix-ui/react-focus-scope@1.2.0, @radix-ui/react-form@0.2.0, @radix-ui/react-hover-card@1.1.24, @radix-ui/react-id@1.1.4, @radix-ui/react-label@2.1.16, @radix-ui/react-menu@2.1.25, @radix-ui/react-menubar@1.1.25, @radix-ui/react-navigation-menu@1.3.0, @radix-ui/react-one-time-password-field@0.1.17, @radix-ui/react-password-toggle-field@0.1.12, @radix-ui/react-popover@1.2.0, @radix-ui/react-popper@1.3.8, @radix-ui/react-portal@1.1.18, @radix-ui/react-presence@1.1.11, @radix-ui/react-primitive@2.1.11, @radix-ui/react-progress@1.1.17, @radix-ui/react-radio-group@1.4.8, @radix-ui/react-roving-focus@1.1.20, @radix-ui/react-scroll-area@1.3.0, @radix-ui/react-select@2.3.8, @radix-ui/react-separator@1.1.16, @radix-ui/react-slider@1.5.0, @radix-ui/react-slot@1.4.0, @radix-ui/react-switch@1.3.8, @radix-ui/react-tabs@1.1.22, @radix-ui/react-toast@1.2.24, @radix-ui/react-toggle@1.1.19, @radix-ui/react-toggle-group@1.1.20, @radix-ui/react-toolbar@1.1.20, @radix-ui/react-tooltip@1.3.0, @radix-ui/react-use-callback-ref@1.1.4, @radix-ui/react-use-controllable-state@1.2.6, @radix-ui/react-use-effect-event@0.0.5, @radix-ui/react-use-escape-keydown@1.1.5, @radix-ui/react-use-is-hydrated@0.1.3, @radix-ui/react-use-layout-effect@1.1.4, @radix-ui/react-use-previous@1.1.4, @radix-ui/react-use-rect@1.1.4, @radix-ui/react-use-size@1.1.5, @radix-ui/react-visually-hidden@1.2.12, @radix-ui/rect@1.1.3, @standard-schema/spec@1.1.0, @tanstack/query-core@5.104.1, @tanstack/react-query@5.104.1, @tanstack/react-table@8.21.3, @tanstack/table-core@8.21.3, @types/d3-array@3.2.2, @types/d3-color@3.1.3, @types/d3-drag@3.0.7, @types/d3-ease@3.0.2, @types/d3-interpolate@3.0.4, @types/d3-path@3.1.1, @types/d3-scale@4.0.9, @types/d3-selection@3.0.12, @types/d3-shape@3.2.0, @types/d3-time@3.0.4, @types/d3-timer@3.0.2, @types/d3-transition@3.0.9, @types/d3-zoom@3.0.9, @types/node@22.20.5, @types/qrcode@1.5.6, @types/react@19.3.0, @types/react-dom@19.3.0, @types/shimmer@1.2.0, @xmldom/xmldom@0.8.15, @xyflow/react@12.12.0, @xyflow/system@0.0.83, abstract-logging@2.0.1, acorn@8.19.0, acorn-import-attributes@1.9.5, ajv@8.20.0, ajv-formats@3.0.1, ansi-regex@5.0.1, ansi-styles@4.3.0, argon2@0.45.1, argparse@1.0.10, aria-hidden@1.2.6, atomic-sleep@1.0.0, avvio@9.3.1, base64-js@0.0.8, 1.5.1, brotli@1.3.3, c12@3.1.0, camelcase@5.3.1, chokidar@4.0.3, citty@0.1.6, 0.2.2, cjs-module-lexer@1.4.3, classcat@5.0.5, client-only@0.0.1, clone@2.1.2, clsx@2.1.1, cmdk@1.1.1, color-convert@2.0.1, color-name@1.1.4, confbox@0.2.4, 0.3.1, consola@3.4.2, cookie@2.0.1, core-util-is@1.0.3, cross-env@10.1.0, cross-spawn@7.0.6, csstype@3.2.3, date-fns@4.4.0, debug@4.4.3, decamelize@1.2.0, decimal.js-light@2.5.1, defu@6.1.7, dequal@2.0.3, destr@2.0.5, detect-node-es@1.1.0, dfa@1.2.0, dijkstrajs@1.0.3, dom-helpers@5.2.1, effect@3.21.0, emoji-regex@8.0.0, empathic@2.0.0, es-errors@1.3.0, escalade@3.2.0, eventemitter3@4.0.7, exsolve@1.1.3, fast-check@3.23.2, fast-decode-uri-component@1.0.1, fast-deep-equal@3.1.3, fast-equals@5.4.4, fast-json-stringify@7.1.0, fast-querystring@1.1.2, fastify@5.12.5, fastify-plugin@5.1.0, 6.0.1, fflate@0.8.3, find-my-way@9.10.0, find-up@4.1.0, fontkit@2.0.4, framer-motion@12.43.0, function-bind@1.1.2, get-nonce@1.0.1, giget@2.0.0, hasown@2.0.4, helmet@8.3.0, immediate@3.0.6, ioredis@5.11.1, ipaddr.js@2.5.0, is-core-module@2.17.0, is-fullwidth-code-point@3.0.0, isarray@1.0.0, jiti@2.7.0, jose@6.2.12, js-tokens@4.0.0, json-schema-ref-resolver@3.0.1, json-schema-traverse@1.0.0, lie@3.3.0, linebreak@1.1.0, locate-path@5.0.0, lodash@4.18.1, lodash.camelcase@4.3.0, loose-envify@1.4.0, module-details-from-path@1.0.4, motion-dom@12.43.0, motion-utils@12.39.0, ms@2.1.3, nanoid@3.3.20, next@15.5.26, node-addon-api@8.9.2, node-ensure@0.0.0, node-fetch-native@1.6.7, node-gyp-build@4.8.4, nypm@0.6.10, object-assign@4.1.1, ohash@2.0.12, on-exit-leak-free@2.1.2, p-limit@2.3.0, p-locate@4.1.0, p-try@2.2.0, pako@0.2.9, path-exists@4.0.0, path-key@3.1.1, path-parse@1.0.7, pathe@2.0.3, pdf-parse@1.1.4, pdfkit@0.20.2, perfect-debounce@1.0.0, pg@8.23.1, pg-cloudflare@1.4.1, pg-connection-string@2.14.1, pg-pool@3.14.0, pg-protocol@1.16.1, pg-types@2.2.0, pgpass@1.0.5, pino@9.14.0, pino-abstract-transport@2.0.0, pino-std-serializers@7.1.0, pkg-types@2.3.3, png-js@2.0.0, pngjs@5.0.0, postcss@8.4.31, postgres-array@2.0.0, postgres-bytea@1.0.1, postgres-date@1.0.7, postgres-interval@1.2.0, process-nextick-args@2.0.1, process-warning@5.1.1, prop-types@15.8.1, pure-rand@6.1.0, qrcode@1.5.4, quick-format-unescaped@4.0.4, radix-ui@1.7.0, rc9@2.1.2, react@19.1.1, react-dom@19.1.1, react-is@16.13.1, 18.3.1, react-remove-scroll@2.7.2, react-remove-scroll-bar@2.3.8, react-smooth@4.0.4, react-style-singleton@2.2.3, readable-stream@2.3.8, readdirp@4.1.2, real-require@0.2.0, recharts@2.15.4, recharts-scale@0.4.5, redis-errors@1.2.0, redis-parser@3.0.0, require-directory@2.1.1, require-from-string@2.0.2, require-in-the-middle@7.5.2, resolve@1.22.13, restructure@3.0.2, ret@0.5.0, reusify@1.1.0, rfdc@1.4.1, safe-buffer@5.1.2, safe-regex2@5.1.2, safe-stable-stringify@2.5.0, scheduler@0.26.0, server-only@0.0.1, set-cookie-parser@3.1.3, setimmediate@1.0.5, shebang-command@2.0.0, shebang-regex@3.0.0, sonic-boom@4.2.1, sonner@2.0.8, standard-as-callback@2.1.0, string_decoder@1.1.1, string-width@4.2.3, strip-ansi@6.0.1, styled-jsx@5.1.6, supports-preserve-symlinks-flag@1.0.0, tailwind-merge@3.7.0, thread-stream@3.2.0, tiny-inflate@1.0.3, tiny-invariant@1.3.3, tinyexec@1.3.1, toad-cache@3.7.4, underscore@1.13.8, undici-types@6.21.0, unicode-properties@1.4.1, unicode-trie@2.0.0, use-callback-ref@1.3.3, use-sidecar@1.1.3, use-sync-external-store@1.7.0, util-deprecate@1.0.2, wrap-ansi@6.2.0, 7.0.0, xmlbuilder@10.1.1, xtend@4.0.2, yargs@15.4.1, 17.7.3, zod@3.25.76, zustand@4.5.7

### MIT AND ISC (1)

victory-vendor@36.9.2

