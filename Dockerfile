FROM node:14
WORKDIR /opt/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8080
CMD [ "npm", "run", "prod" ]
