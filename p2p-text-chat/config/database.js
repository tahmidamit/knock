const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI;
    
    if (!mongoURI) {
      throw new Error('MONGODB_URI environment variable is not defined. Please set it in your .env file.');
    }

    console.log('🔄 Connecting to MongoDB Atlas...');
    
    await mongoose.connect(mongoURI, {
      // Removed deprecated options - they're no longer needed in latest MongoDB driver
    });
    
    console.log('✅ MongoDB Atlas connected successfully');
    console.log('� Database:', mongoose.connection.name);
    
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    
    if (error.message.includes('MONGODB_URI')) {
      console.error('� Please:');
      console.error('   1. Create a .env file in your project root');
      console.error('   2. Add: MONGODB_URI=your-mongodb-atlas-connection-string');
    } else {
      console.error('🔧 MongoDB Atlas troubleshooting:');
      console.error('   - Verify your connection string is correct');
      console.error('   - Check database user credentials');
      console.error('   - Ensure IP address is whitelisted');
      console.error('   - Confirm cluster is running');
    }
    
    process.exit(1);
  }
};

// Connection event listeners
mongoose.connection.on('connected', () => {
  console.log('🟢 Mongoose connected to MongoDB Atlas');
});

mongoose.connection.on('error', (err) => {
  console.error('🔴 Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('🟡 Mongoose disconnected from MongoDB Atlas');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('👋 MongoDB Atlas connection closed');
  process.exit(0);
});

module.exports = connectDB;
