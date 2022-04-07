FROM node:16-alpine

RUN apk update && apk add ghostscript zip

WORKDIR /app

COPY package.json yarn.lock .
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

CMD ["yarn", "start"]
