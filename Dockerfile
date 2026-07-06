FROM node:18-slim

WORKDIR /app

# Salin HANYA package.json (bukan package-lock.json) untuk menghindari
# penelusuran dependensi dev (seperti eslint) yang dikunci lewat Git SSH di lockfile lokal.
COPY package.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
