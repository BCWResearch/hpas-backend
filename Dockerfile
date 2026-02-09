FROM node:20

# Create app directory inside container
WORKDIR /usr/src/app
# Copy everything into container
COPY . .

# Install dependencies
RUN pnpm install

# Generate Prisma client
RUN pnpm exec prisma generate

# Expose API port
EXPOSE 3003

# Start the dev server
CMD ["pnpm", "run", "deploy"]