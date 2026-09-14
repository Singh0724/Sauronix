FROM node:24-bullseye-slim

# Install Git and build utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Configure Git user for autonomous commits
RUN git config --global user.name "Autonomous Studio Coder" && \
    git config --global user.email "studio-bot@company.com"

# Copy package descriptors
COPY package*.json ./

# Copy entire repository
COPY . .

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose CCTV Mission Control Web & API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Start CCTV Mission Control Server
CMD ["node", "src/server/cctv-server.js"]
