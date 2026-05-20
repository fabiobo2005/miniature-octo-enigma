#!/bin/sh
set -e
: "${API_HOST:?API_HOST env var required}"
sed "s|API_HOST_PLACEHOLDER|${API_HOST}|g" /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
