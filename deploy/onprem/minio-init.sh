#!/bin/sh
set -eu
for name in MINIO_ROOT_USER MINIO_ROOT_PASSWORD OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY OBJECT_STORAGE_BUCKET; do
  eval "value=\${$name:-}"
  [ -n "$value" ] || { echo "$name is required" >&2; exit 1; }
done

until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do sleep 2; done
mc mb --ignore-existing "local/$OBJECT_STORAGE_BUCKET" >/dev/null
mc anonymous set none "local/$OBJECT_STORAGE_BUCKET" >/dev/null

cat >/tmp/hrbp-app-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {"Effect":"Allow","Action":["s3:GetBucketLocation","s3:ListBucket"],"Resource":["arn:aws:s3:::$OBJECT_STORAGE_BUCKET"]},
    {"Effect":"Allow","Action":["s3:GetObject","s3:PutObject","s3:DeleteObject"],"Resource":["arn:aws:s3:::$OBJECT_STORAGE_BUCKET/*"]}
  ]
}
EOF
if ! mc admin user info local "$OBJECT_STORAGE_ACCESS_KEY" >/dev/null 2>&1; then
  mc admin user add local "$OBJECT_STORAGE_ACCESS_KEY" "$OBJECT_STORAGE_SECRET_KEY" >/dev/null
fi
if ! mc admin policy info local hrbp-app >/dev/null 2>&1; then
  mc admin policy create local hrbp-app /tmp/hrbp-app-policy.json >/dev/null
fi
mc admin policy attach local hrbp-app --user "$OBJECT_STORAGE_ACCESS_KEY" >/dev/null
