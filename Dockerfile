FROM node:12.18.1
ENV NODE_ENV=production

WORKDIR /usr/src/app

COPY ["package.json", "package-lock.json*", "./"]

RUN yarn

COPY . .

RUN prisma generate

CMD [ "node", "index.js" ]
