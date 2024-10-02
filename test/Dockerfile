FROM node:22-alpine

RUN apk --update add freeswitch
WORKDIR /opt

COPY package.json /opt/
COPY yarn.lock /opt/
COPY .yarnrc.yml /opt/
RUN corepack enable && yarn --immutable

COPY build.mjs /opt/
COPY src /opt/src
RUN yarn build

COPY test /opt/test
COPY tsconfig.json /opt/

RUN yarn prepublishOnly
# RUN ulimit -a
RUN node --test --abort-on-uncaught-exception --report-uncaught-exception --test-timeout=120000 --test-force-exit --test-reporter spec --test-concurrency 1 \
  --test-name-pattern='.*'
