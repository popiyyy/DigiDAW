# ponytail: minimal nginx alpine to serve static 3D web twin & models without node runtime bloat
FROM nginx:alpine

# Copy static frontend files to default nginx html directory
COPY . /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
