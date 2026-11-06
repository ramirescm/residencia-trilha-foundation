#!/usr/bin/env bash

set -euo pipefail

backend_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
catalog_dir="${backend_dir}/lambdas/01-catalog-backend-api-lambda"
orders_dir="${backend_dir}/lambdas/02-order-backend-api-lambda"
processor_dir="${backend_dir}/lambdas/03-order-processor-lambda"

npm --prefix "${catalog_dir}" ci
npm --prefix "${catalog_dir}" run build
rm -f "${catalog_dir}/catalog-backend-api-lambda.zip"
(
  cd "${catalog_dir}/dist"
  zip -qr "../catalog-backend-api-lambda.zip" .
)

orders_publish_dir="${orders_dir}/dist"
rm -rf "${orders_publish_dir}"
dotnet publish "${orders_dir}/OrderBackendApi.csproj" \
  --configuration Release \
  --runtime linux-arm64 --self-contained false \
  --output "${orders_publish_dir}"
rm -f "${orders_dir}/order-backend-api-lambda.zip"
(
  cd "${orders_publish_dir}"
  zip -qr "../order-backend-api-lambda.zip" .
)

npm --prefix "${processor_dir}" ci
npm --prefix "${processor_dir}" run build
rm -f "${processor_dir}/order-processor-lambda.zip"
(
  cd "${processor_dir}/dist"
  zip -qr "../order-processor-lambda.zip" .
)

NODE_PATH="${catalog_dir}/node_modules" "${catalog_dir}/node_modules/.bin/esbuild" \
  "${backend_dir}/schema/index.ts" --bundle --platform=node --target=node24 --format=esm \
  --loader:.sql=text \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile="${backend_dir}/schema/dist/index.mjs"

printf 'Lambda ZIPs and schema helper built.\n'
