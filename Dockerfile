FROM node:22-alpine

# Install git, curl, and ca-certificates via apk (super fast, robust, no 404 debian mirrors)
RUN apk add --no-cache git curl ca-certificates

WORKDIR /app

# Configure Git user for autonomous commits
RUN git config --global user.name "Autonomous Studio Coder" && \
    git config --global user.email "studio-bot@company.com"

# Copy repository and set permissions
COPY --chown=node:node . .

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Use non-root node user for container execution
USER node

# Expose CCTV Mission Control Web & API port
EXPOSE 3000

# Start CCTV Mission Control Server
CMD ["node", "src/server/cctv-server.js"]
