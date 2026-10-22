#!/bin/sh
set -eu

: "${DATABASE_URL:?Сказ: задайте DATABASE_URL в skaz.env.}"
: "${BETTER_AUTH_SECRET:?Сказ: задайте BETTER_AUTH_SECRET в skaz.env.}"
: "${PAPERCLIP_AGENT_JWT_SECRET:?Сказ: задайте PAPERCLIP_AGENT_JWT_SECRET в skaz.env.}"
: "${PAPERCLIP_TOOL_ACTION_SIGNING_SECRET:?Сказ: задайте PAPERCLIP_TOOL_ACTION_SIGNING_SECRET в skaz.env.}"
if [ "${PAPERCLIP_STORAGE_PROVIDER:-local_disk}" = s3 ]; then
    : "${PAPERCLIP_STORAGE_S3_ENDPOINT:?Сказ: задайте адрес MinIO в PAPERCLIP_STORAGE_S3_ENDPOINT.}"
    : "${PAPERCLIP_STORAGE_S3_BUCKET:?Сказ: задайте PAPERCLIP_STORAGE_S3_BUCKET.}"
    : "${AWS_ACCESS_KEY_ID:?Сказ: задайте AWS_ACCESS_KEY_ID.}"
    : "${AWS_SECRET_ACCESS_KEY:?Сказ: задайте AWS_SECRET_ACCESS_KEY.}"
fi

exec docker-entrypoint.sh "$@"
