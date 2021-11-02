FROM node:12.18.1

ENV NODE_ENV=production

WORKDIR /usr/src/app/apple-music-slack-status

COPY ["package.json", "package-lock.json*", "./"]

RUN yarn

RUN pwd

RUN ls

RUN npx prisma generate

COPY . .

CMD [ "node", "index.js" ]
