# ============================================================
# Dockerfile - チラシ特売チェッカー Cloud Run バックエンド
# ============================================================

FROM node:22-slim

WORKDIR /app

# 依存関係を先にコピーしてキャッシュを活用
COPY package.json ./
RUN npm install --omit=dev

# ソースコードをコピー
COPY src/ ./src/

# Cloud Run はポート 8080 を使用
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "src/index.js"]
