#!/bin/sh
set -e
: "${API_HOST:?API_HOST env var required}"

# Build admin unlock map: $admin_unlock = "1" only if X-Admin-Secret header matches ADMIN_SECRET.
# If ADMIN_SECRET is empty/unset, no match is possible → /db.html always 404.
ADMIN_SECRET="${ADMIN_SECRET:-}"
cat > /etc/nginx/conf.d/00-admin-map.conf <<EOF
map \$http_x_admin_secret \$admin_unlock {
  default              "0";
  "${ADMIN_SECRET}"    "${ADMIN_SECRET:+1}";
}
EOF

sed "s|API_HOST_PLACEHOLDER|${API_HOST}|g" /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
