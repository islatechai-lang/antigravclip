FROM python:3.11-slim

# Install system dependencies (FFmpeg for video compositing, fonts, git, curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS for Next.js frontend
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# 2. Install Node.js dependencies
COPY package*.json ./
RUN npm install

# 3. Copy application source code
COPY . .

# 4. Build Next.js production bundle
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# Make start.sh executable
RUN chmod +x start.sh

# Environment defaults
ENV PYTHONUNBUFFERED=1
ENV BACKEND_PORT=8000
ENV BACKEND_API_URL=http://127.0.0.1:8000

EXPOSE 10000 8000

CMD ["./start.sh"]
