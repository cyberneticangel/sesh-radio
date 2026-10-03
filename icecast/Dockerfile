FROM alpine:3.20

RUN apk add --no-cache icecast mailcap \
 && (addgroup -S icecast 2>/dev/null || true) \
 && (adduser -S -G icecast -H icecast 2>/dev/null || true) \
 && mkdir -p /var/log/icecast /etc/icecast \
 && chown -R icecast:icecast /var/log/icecast /etc/icecast

COPY icecast.xml.template /etc/icecast/icecast.xml.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER icecast
EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
