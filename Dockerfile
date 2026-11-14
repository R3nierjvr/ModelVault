FROM node:22-alpine

# Archive tools: 7-Zip (zip/7z/rar), libarchive's bsdtar (zip/7z/rar4/rar5 fallback + ZIP downloads), unrar if available.
# vips-tools: the picture optimizer.
RUN apk add --no-cache 7zip libarchive-tools tini cifs-utils vips-tools \
 && (apk add --no-cache unrar || true)

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    PORT=8420 \
    DATA_DIR=/data \
    LIBRARY_DIR=/library \
    DOWNLOADS_DIR=/downloads

EXPOSE 8420
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8420/api/meta >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
