FROM alpine:edge

RUN apk --update add nodejs-current freeswitch
WORKDIR /opt

COPY package.json /opt/
COPY yarn.lock /opt/
COPY .yarnrc.yml /opt/
RUN corepack enable && yarn --immutable

COPY build.mjs /opt/
COPY src /opt/src
RUN yarn build

COPY test /opt/test
COPY test-reconnect /opt/test-reconnect
COPY tsconfig.json /opt/

RUN yarn prepublishOnly
# RUN ulimit -a
