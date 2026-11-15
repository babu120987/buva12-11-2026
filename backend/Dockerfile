FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js invoices.js order-emails.js commerce.js knowledge.js knowledge-drafts.js ./
COPY migrations ./migrations
# admin-uploaded product images are written to /app/uploads (mounted as a volume)
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 9000
HEALTHCHECK --interval=15s --timeout=4s --retries=5 CMD wget -qO- http://localhost:9000/health || exit 1
CMD ["node", "server.js"]
