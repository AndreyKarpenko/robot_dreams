# syntax=docker/dockerfile:1.7
# Production image for hw-28: multi-stage (≥2 FROM), distroless, non-root.
# Build-time decoy token (secret id=npm_token) must never land in
# history / config / layers — only RUN --mount=type=secret.

FROM node:22-bookworm AS builder
WORKDIR /app

# Vendored tarball: offline `npm ci` (Docker npm client hangs on the registry
# on some hosts). BuildKit secret is still required for the install step.
COPY docker/package.json docker/package-lock.json ./
COPY docker/vendor ./vendor
RUN --mount=type=secret,id=npm_token \
    TOKEN="$(cat /run/secrets/npm_token)" && \
    test -n "$TOKEN" && \
    npm ci --offline --no-audit --no-fund && \
    npx tsc --version >/dev/null

# Precompiled by scripts/image-build.sh (host has @types/node).
COPY docker/k8s-app.js ./k8s-app.js
RUN rm -rf node_modules package.json package-lock.json vendor

# Final stage: no shell. Numeric UID — kubelet cannot resolve the name "nonroot".
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app

COPY --from=builder /app/k8s-app.js ./k8s-app.js

ENV PORT=3000
ENV WARMUP_MS=4000
ENV DRAIN_MS=5000
USER 65532:65532
EXPOSE 3000

CMD ["k8s-app.js"]
