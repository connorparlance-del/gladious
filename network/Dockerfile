# Imagen mínima del servidor de señalización (opcional)
FROM node:20-alpine
WORKDIR /app
COPY signaling-server.js package.json ./
ENV PORT=9000
EXPOSE 9000
CMD ["node", "signaling-server.js"]
