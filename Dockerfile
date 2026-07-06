FROM node:18-slim

# Install git and ssh client for resolving git+ssh dependency URLs
RUN apt-get update && apt-get install -y git openssh-client --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV HOME=/app

WORKDIR /app

# Set the environment variable to force Git to rewrite SSH/Git protocols to HTTPS for all subprocesses
ENV GIT_CONFIG_PARAMETERS="'url.https://github.com/.insteadOf=ssh://git@github.com/' 'url.https://github.com/.insteadOf=git+ssh://git@github.com/' 'url.https://github.com/.insteadOf=git@github.com:'"

# Salin HANYA package.json (bukan package-lock.json) untuk menghindari
# penelusuran dependensi dev yang dikunci lewat Git SSH di lockfile lokal.
COPY package.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
