# QuickLocal Backend - Optimized for Google Cloud Run
FROM node:18-alpine

# Install runtime dependencies
RUN apk add --no-cache dumb-init tzdata

# Set timezone
ENV TZ=Asia/Kolkata

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p logs uploads public

# Expose port (Cloud Run uses PORT environment variable)
EXPOSE 3000

# Start the application (optimized for 1GB memory)
CMD ["node", "--max-old-space-size=1024", "server.js"]
