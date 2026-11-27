# Imagem do frontend: Nginx sem root servindo os arquivos estáticos e repassando /api ao backend.
FROM nginxinc/nginx-unprivileged:1.28-alpine

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY erp3d.html /usr/share/nginx/html/index.html
COPY erp3d.html /usr/share/nginx/html/erp3d.html
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js

EXPOSE 8080
