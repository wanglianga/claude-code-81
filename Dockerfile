# ========== Stage 1: 前端构建 ==========
FROM node:22-alpine AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ========== Stage 2: 后端构建 ==========
FROM node:22-alpine AS backend
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --no-audit --no-fund
COPY backend/ ./
# 前端产物由 Nest 静态托管
COPY --from=frontend /fe/dist ./public
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

# ========== Stage 3: 运行时（非 root） ==========
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
WORKDIR /app

# wget 用于 HEALTHCHECK（alpine 自带 busybox wget）
RUN addgroup -S app && adduser -S -G app app
COPY --from=backend --chown=app:app /app/node_modules ./node_modules
COPY --from=backend --chown=app:app /app/dist ./dist
COPY --from=backend --chown=app:app /app/public ./public
COPY --from=backend --chown=app:app /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

USER app
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health | grep -q '"ok"' || exit 1

CMD ["./docker-entrypoint.sh"]
