# syntax=docker/dockerfile:1
FROM nginx:stable-alpine

ADD --checksum=sha256:9caac977a0af0c2229abd397eee3345899c4020da2a1a0b711c1cc543fe3719d --chmod=644 https://cdn.jsdelivr.net/npm/bootstrap@5.3.9/dist/css/bootstrap.min.css /usr/share/nginx/html/bootstrap.min.css
COPY index.html styles.css app.js /usr/share/nginx/html/
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

ENV NGINX_ENVSUBST_FILTER="^API_UPSTREAM$"
EXPOSE 80 443
