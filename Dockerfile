# Restaurant app — single image that builds the React frontend and runs the
# Express + SSE backend, which serves that built frontend on the same origin.
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching). Copy only the manifests so
# a code change doesn't bust the npm cache.
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
RUN npm install \
 && npm --prefix backend install \
 && npm --prefix frontend install

# Copy the rest of the source and build the frontend into frontend/dist.
COPY . .
RUN npm --prefix frontend run build

ENV NODE_ENV=production
# The platform (Railway/Fly) injects its own PORT at runtime; this is just a
# sensible default for `docker run` locally.
ENV PORT=3001
EXPOSE 3001

# Start the backend, which also serves frontend/dist.
CMD ["npm", "--prefix", "backend", "run", "start"]
