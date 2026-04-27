FROM nginx:alpine

# Generate self-signed SSL certificate
RUN apk add --no-cache openssl && \
    mkdir -p /etc/nginx/ssl && \
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/key.pem \
      -out /etc/nginx/ssl/cert.pem \
      -subj "/CN=seabird-label-printer" && \
    apk del openssl

# Copy nginx template and app files
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY index.html explorer.html style.css app.js printer.js explorer.js \
     /usr/share/nginx/html/

# nginx:alpine auto-processes .template files with envsubst on startup
ENV HTTPS_PORT=443

EXPOSE 80 443
