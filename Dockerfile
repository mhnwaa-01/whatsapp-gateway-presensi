FROM node:18-slim

# Install git and ssh client for resolving git+ssh dependency URLs
RUN apt-get update && apt-get install -y git openssh-client --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV HOME=/app

# Configure git to use HTTPS instead of SSH for all git and ssh URLs (avoids SSH key requirements)
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    git config --global url."https://github.com/".insteadOf "git@github.com:" && \
    git config --global url."https://".insteadOf "ssh://" && \
    git config --global url."https://".insteadOf "git+ssh://"

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
