# Use an official Node.js runtime as the base image
FROM node:18-slim

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy the rest of your application code
COPY . .

# Command to run the application
CMD [ "node", "index.js" ]