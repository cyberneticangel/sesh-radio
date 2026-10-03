#!/bin/sh
set -e

# Icecast can't read env vars, so render the config at startup.
sed \
  -e "s|@SOURCE_PASSWORD@|${ICECAST_SOURCE_PASSWORD}|g" \
  -e "s|@ADMIN_PASSWORD@|${ICECAST_ADMIN_PASSWORD}|g" \
  -e "s|@RELAY_PASSWORD@|${ICECAST_RELAY_PASSWORD}|g" \
  -e "s|@HOSTNAME@|${ICECAST_HOSTNAME}|g" \
  /etc/icecast/icecast.xml.template > /etc/icecast/icecast.xml

exec icecast -c /etc/icecast/icecast.xml
