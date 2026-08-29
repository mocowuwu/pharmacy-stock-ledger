# The container image referenced by docker-compose.yml.
#
# Deliberately plain: install, build, run. No standalone output tracing, no
# multi-stage juggling of a pruned node_modules. Those make the image smaller,
# and smaller is worth very little on a mini PC in a clinic -- while every
# clever step is one more thing that can break on the day somebody is trying to
# get the pharmacy running again.
#
# Debian rather than Alpine because `@node-rs/argon2` ships prebuilt native
# bindings per libc, and glibc is the better-trodden path. A password hash that
# fails to load is a pharmacy nobody can sign in to.
#
# NOTE: this image has not been built and run. Docker was not installed on the
# machine this was written on, so the compose path is written but unverified.
# The plain Node path in DEPLOY.md is the one that has actually been tested end
# to end against PostgreSQL 18.

FROM node:24-bookworm-slim AS build
WORKDIR /app

# postgresql-client gives the image pg_dump and pg_restore, so `npm run backup`
# works from inside the container rather than needing a second install.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The build does not touch the database: every page is server-rendered on
# demand, so no DATABASE_URL is needed here.
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Migrations run at start, then the server starts. One container owns the
# database, so there is no second writer to race with; if the migration fails
# the container exits rather than serving against a schema it does not match.
CMD ["sh", "-c", "npm run db:migrate && npx next start -p 3000"]
