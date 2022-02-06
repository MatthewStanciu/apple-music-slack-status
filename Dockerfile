FROM node:16.13.10
ENV NODE_ENV=production

WORKDIR /usr/src/app/apple-music-slack-status

COPY . .

RUN yarn

RUN npx prisma generate

COPY . .

CMD [ "yan", "run", "tsnode" ]
