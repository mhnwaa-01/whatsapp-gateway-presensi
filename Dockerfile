# Menggunakan Node 20 agar Web Crypto API tersedia secara default
FROM node:20-slim

# Install git, ssh client, dan ca-certificates (untuk mencegah error SSL)
RUN apt-get update && apt-get install -y git openssh-client ca-certificates --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV HOME=/app
WORKDIR /app

# Konfigurasi Git jika Anda menggunakan dependensi private (opsional, bawaan dari Anda)
ENV GIT_CONFIG_PARAMETERS="'url.https://github.com/.insteadOf=ssh://git@github.com/' 'url.https://github.com/.insteadOf=git+ssh://git@github.com/' 'url.https://github.com/.insteadOf=git@github.com:'"

COPY package.json ./

# Install dependencies
RUN npm install --omit=dev

COPY . .

# Expose port untuk Render.com
EXPOSE 3000

CMD ["npm", "start"]
