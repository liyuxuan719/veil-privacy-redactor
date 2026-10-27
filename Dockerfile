FROM nginx:1.29-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html guide.html manifest.webmanifest sw.js robots.txt .nojekyll /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
COPY src /usr/share/nginx/html/src

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
