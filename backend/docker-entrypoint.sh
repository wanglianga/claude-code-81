#!/bin/sh
set -e

echo "Waiting for PostgreSQL at ${DB_HOST:-db}:${DB_PORT:-5432} ..."
until node -e "
const net=require('net');
const s=net.connect({host:process.env.DB_HOST||'db',port:Number(process.env.DB_PORT||5432)});
s.on('connect',()=>{s.end();process.exit(0)});
s.on('error',()=>process.exit(1));
" 2>/dev/null; do
  sleep 1
done
echo "PostgreSQL is up."

echo "Running seed (idempotent) ..."
node dist/seed.js || echo "seed skipped/failed, continuing..."

echo "Starting API server ..."
exec node dist/main.js
