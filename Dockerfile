FROM node:10.13-alpine
ENV NODE_ENV production
ENV IP 127.0.0.1
ENV PASSWORD password
WORKDIR /usr/src/app
COPY ["package.json", "package-lock.json*", "npm-shrinkwrap.json*", "./"]
RUN npm install --production --silent && mv node_modules ../
COPY . .

CMD node app.js