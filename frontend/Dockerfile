FROM node:20-alpine

RUN apk add --no-cache python3 make g++ linux-headers eudev-dev libusb-dev

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps --ignore-scripts

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]
