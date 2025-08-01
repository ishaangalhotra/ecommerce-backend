// config/db.js
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const retry = require('async-retry');

class DatabaseManager {
  constructor() {
    this.connected = false;
    this.db = null;
    this.connectionOptions = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      heartbeatFrequencyMS: 30000,
      retryWrites: true,
      retryReads: true,
      bufferCommands: false
      // bufferMaxEntries: 0 - REMOVED (deprecated option)
    };

    // Event listeners for connection monitoring
    this.setupEventListeners();
  }

  setupEventListeners() {
    mongoose.connection.on('connected', () => {
      logger.info('📡 MongoDB connection established');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('❌ MongoDB connection error', { error: err.message });
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('⚠️ MongoDB disconnected');
      this.connected = false;
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('🔁 MongoDB reconnected');
      this.connected = true;
    });

    mongoose.connection.on('reconnectFailed', () => {
      logger.error('🔥 MongoDB reconnect attempts failed');
      this.connected = false;
    });
  }

  async connectDB() {
    if (this.connected) {
      logger.debug('Database already connected');
      return;
    }

    const uri = process.env.MONGO_URI;
    const dbName = process.env.MONGO_DB_NAME;

    if (!uri || !dbName) {
      throw new Error('MONGO_URI and MONGO_DB_NAME environment variables are required');
    }

    try {
      await retry(
        async (bail) => {
          try {
            const conn = await mongoose.connect(uri, {
              ...this.connectionOptions,
              dbName
            });

            this.db = conn.connection;
            this.connected = true;

            logger.info('✅ MongoDB connected successfully', {
              host: this.db.host,
              name: this.db.name,
              port: this.db.port,
              version: this.db.version
            });

            this.registerModels();
          } catch (error) {
            if (error.message.includes('Authentication failed')) {
              // Don't retry for auth errors
              bail(new Error('Authentication failed - check your credentials'));
              return;
            }
            throw error;
          }
        },
        {
          retries: 5,
          minTimeout: 1000,
          maxTimeout: 5000,
          factor: 2, // exponential backoff
          onRetry: (err, attempt) => {
            logger.warn(`Retrying MongoDB connection (attempt ${attempt})`, {
              error: err.message
            });
          }
        }
      );
    } catch (error) {
      logger.error('🔥 Failed to connect to MongoDB after retries', {
        error: error.message
      });
      throw error;
    }
  }

  async disconnectDB() {
    if (this.connected) {
      try {
        await mongoose.disconnect();
        this.connected = false;
        logger.info('🔌 MongoDB disconnected gracefully');
      } catch (error) {
        logger.error('Failed to disconnect MongoDB', { error: error.message });
        throw error;
      }
    }
  }

  async pingDB() {
    if (!this.connected) throw new Error('Database not connected');
    try {
      const start = Date.now();
      const admin = this.db.getClient().db().admin();
      await admin.ping();
      const latency = Date.now() - start;
      logger.debug('🏓 MongoDB ping successful', { latency: `${latency}ms` });
      return { success: true, latency };
    } catch (error) {
      logger.error('Failed to ping MongoDB', { error: error.message });
      throw error;
    }
  }

  async getDBStats() {
    if (!this.connected) throw new Error('Database not connected');
    try {
      const stats = await this.db.db.command({ dbStats: 1 });
      logger.debug('📊 Database stats retrieved', {
        collections: stats.collections,
        objects: stats.objects,
        dataSize: `${(stats.dataSize / 1024 / 1024).toFixed(2)} MB`,
        storageSize: `${(stats.storageSize / 1024 / 1024).toFixed(2)} MB`
      });
      return stats;
    } catch (error) {
      logger.error('Failed to get database stats', { error: error.message });
      throw error;
    }
  }

  async executeTransaction(fn, options = {}) {
    if (!this.connected) throw new Error('Database not connected');

    const session = await mongoose.startSession();
    session.startTransaction({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
      ...options
    });

    try {
      logger.debug('🏦 Starting database transaction');
      const result = await fn(session);
      await session.commitTransaction();
      logger.debug('✅ Transaction committed successfully');
      return result;
    } catch (error) {
      await session.abortTransaction();
      logger.error('❌ Transaction aborted', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    } finally {
      session.endSession();
    }
  }

  async createIndexes() {
    if (!this.connected) {
      throw new Error('Cannot create indexes - database not connected');
    }

    try {
      logger.info('📌 Creating MongoDB indexes...');
      await this.registerModels();

      // Sync indexes for all registered models
      const models = mongoose.modelNames();
      for (const modelName of models) {
        const model = mongoose.model(modelName);
        await model.syncIndexes();
        logger.debug(`Indexes synced for model: ${modelName}`);
      }

      logger.info(`✅ Created indexes for ${models.length} models`);
    } catch (error) {
      logger.error('Failed to create indexes', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async dropDatabase() {
    if (!this.connected) throw new Error('Database not connected');
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('Database can only be dropped in test environment');
    }

    try {
      logger.warn('🔥 Dropping database...');
      await this.db.dropDatabase();
      logger.warn('✅ Database dropped successfully');
    } catch (error) {
      logger.error('Failed to drop database', { error: error.message });
      throw error;
    }
  }

  registerModels() {
    try {
      // Dynamic model loading based on files in models directory
      require('fs').readdirSync(require('path').join(__dirname, '../models'))
        .filter(file => file.endsWith('.js') && !file.startsWith('_'))
        .forEach(file => {
          const modelName = file.replace('.js', '');
          
          // Check if model is already registered to avoid overwrite error
          const capitalizedModelName = modelName.charAt(0).toUpperCase() + modelName.slice(1);
          
          if (!mongoose.models[modelName] && !mongoose.models[capitalizedModelName]) {
            try {
              require(`../models/${file}`);
              logger.debug(`Registered model: ${modelName}`);
            } catch (error) {
              if (error.name === 'OverwriteModelError') {
                logger.debug(`Model ${modelName} already exists, skipping...`);
              } else {
                throw error;
              }
            }
          } else {
            logger.debug(`Model ${modelName} already registered, skipping...`);
          }
        });
    } catch (error) {
      logger.error('Failed to register models', {
        error: error.message,
        stack: error.stack
      });
      // Don't throw here - let the app continue even if some models fail
      // throw error;
    }
  }

  getConnectionState() {
    return {
      connected: this.connected,
      readyState: this.db?.readyState || 0,
      host: this.db?.host || 'unknown',
      name: this.db?.name || 'unknown',
      port: this.db?.port || 'unknown'
    };
  }
}

// Singleton instance
const dbManager = new DatabaseManager();

// Graceful shutdown handler
process.on('SIGINT', async () => {
  await dbManager.disconnectDB();
  process.exit(0);
});

module.exports = {
  DatabaseManager,
  dbManager,
  connectDB: dbManager.connectDB.bind(dbManager),
  disconnectDB: dbManager.disconnectDB.bind(dbManager),
  getDBStats: dbManager.getDBStats.bind(dbManager),
  pingDB: dbManager.pingDB.bind(dbManager),
  createIndexes: dbManager.createIndexes.bind(dbManager),
  executeTransaction: dbManager.executeTransaction.bind(dbManager),
  registerModels: dbManager.registerModels.bind(dbManager),
  dropDatabase: dbManager.dropDatabase.bind(dbManager),
  getConnectionState: dbManager.getConnectionState.bind(dbManager),
  // For testing purposes
  _reset: () => {
    if (dbManager.connected) {
      mongoose.deleteModel(/.+/); // Remove all models
      mongoose.connection.models = {};
      mongoose.connection.deleteModel(/.+/);
    }
  },
  // ESM compatibility
  default: dbManager,
};
