FROM nginx:1.27-alpine
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && rm /etc/nginx/conf.d/default.conf
COPY index.html saude.html dieta.html treinos.html db.html /usr/share/nginx/html/
COPY manifest.webmanifest service-worker.js /usr/share/nginx/html/
COPY css/ /usr/share/nginx/html/css/
COPY js/  /usr/share/nginx/html/js/
COPY icons/ /usr/share/nginx/html/icons/
EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
