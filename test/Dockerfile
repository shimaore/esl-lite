FROM node:22-alpine

RUN apk --update add freeswitch
WORKDIR /opt

COPY package.json /opt/
COPY yarn.lock /opt/
RUN corepack enable && yarn --immutable

COPY build.mjs /opt/
COPY src /opt/src
RUN yarn build

COPY test /opt/test
COPY tsconfig.json /opt/

RUN ulimit -a && yarn test
