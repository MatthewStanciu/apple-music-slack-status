FROM node:16.13.2
ENV NODE_ENV=production

WORKDIR /usr/src/app/apple-music-slack-status

COPY . .

RUN yarn

COPY . .

CMD [ "yarn", "run", "tsnode" ]
