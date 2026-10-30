FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npx tsc && npm prune --omit=dev
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
