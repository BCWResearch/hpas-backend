FROM node:20

# Create app directory inside container
WORKDIR /usr/src/app
# Copy everything into container
COPY . .

# Install dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Expose API port
EXPOSE 3003

# Start the dev server
CMD ["npm", "run", "deploy"]
