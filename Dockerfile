FROM node:12.18.1

ENV NODE_ENV=production

WORKDIR /usr/src/app/apple-music-slack-status

COPY . .

RUN yarn

RUN npx prisma generate

CMD [ "node", "index.js" ]
