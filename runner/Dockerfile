# SiteOps Browser Runner - containerized Playwright execution service.
#
# Build:
#   docker build -t siteops-browser-runner ./runner
#
# Run:
#   docker run -d --name siteops-browser-runner \
#     -e BROWSER_RUNNER_TOKEN='<long random token>' \
#     -p 127.0.0.1:3200:3200 \
#     siteops-browser-runner
#
# Bind to 127.0.0.1 as shown above and put a reverse proxy with HTTPS in
# front of it, exactly as the systemd install does - see runner/README.md.
#
# Uses Playwright's own base image (Chromium + OS deps already installed,
# so the build needs nothing beyond `npm ci` and no `apt-get`/sudo dance).
# PLAYWRIGHT_VERSION must match the version package-lock.json resolves -
# the build fails loudly instead of silently running a mismatched browser
# if package.json's playwright range moves to a new major/minor and this
# isn't bumped to match; run `npm ls playwright` in runner/ to check.
ARG PLAYWRIGHT_VERSION=1.63.0
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG PLAYWRIGHT_VERSION
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && installed="$(node -p "require('./node_modules/playwright/package.json').version")" \
    && if [ "$installed" != "$PLAYWRIGHT_VERSION" ]; then \
         echo "Playwright version mismatch: image has v$PLAYWRIGHT_VERSION, package-lock.json resolves to $installed." >&2; \
         echo "Update this Dockerfile's PLAYWRIGHT_VERSION (and FROM tag) to match, or pin package.json back down." >&2; \
         exit 1; \
       fi

COPY server.mjs ./

RUN groupadd --system siteops-runner \
    && useradd --system --gid siteops-runner --home-dir /app --shell /usr/sbin/nologin siteops-runner \
    && chown -R siteops-runner:siteops-runner /app

USER siteops-runner

ENV HOST=0.0.0.0
ENV PORT=3200
EXPOSE 3200

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
