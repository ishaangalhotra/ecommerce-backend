const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class MigrationRunner {
  constructor() {
    this.migrationsPath = __dirname;
    this.migrationCollection = 'migrations';
  }

  async runMigrations() {
    try {
      // Create migrations collection if it doesn't exist
      const db = mongoose.connection.db;
      const collections = await db.listCollections({ name: this.migrationCollection }).toArray();
      
      if (collections.length === 0) {
        await db.createCollection(this.migrationCollection);
        logger.info('Created migrations collection');
      }

      // Get all migration files
      const migrationFiles = fs.readdirSync(this.migrationsPath)
        .filter(file => file.match(/^\d{3}_.*\.js$/))
        .sort();

      // Get completed migrations
      const completedMigrations = await db.collection(this.migrationCollection)
        .find({}).toArray();
      
      const completedNames = completedMigrations.map(m => m.name);

      // Run pending migrations
      for (const file of migrationFiles) {
        const migrationName = file.replace('.js', '');
        
        if (!completedNames.includes(migrationName)) {
          logger.info(`Running migration: ${migrationName}`);
          
          const migration = require(path.join(this.migrationsPath, file));
          await migration.up();
          
          // Record migration as completed
          await db.collection(this.migrationCollection).insertOne({
            name: migrationName,
            completedAt: new Date(),
            version: '1.0'
          });
          
          logger.info(`Completed migration: ${migrationName}`);
        } else {
          logger.info(`Skipping already completed migration: ${migrationName}`);
        }
      }

      logger.info('All migrations completed successfully');
    } catch (error) {
      logger.error('Migration failed:', error);
      throw error;
    }
  }

  async rollbackMigration(migrationName) {
    try {
      const migrationFile = `${migrationName}.js`;
      const migrationPath = path.join(this.migrationsPath, migrationFile);
      
      if (fs.existsSync(migrationPath)) {
        const migration = require(migrationPath);
        if (migration.down) {
          await migration.down();
          
          // Remove from completed migrations
          const db = mongoose.connection.db;
          await db.collection(this.migrationCollection).deleteOne({ name: migrationName });
          
          logger.info(`Rolled back migration: ${migrationName}`);
        }
      }
    } catch (error) {
      logger.error('Rollback failed:', error);
      throw error;
    }
  }
}

module.exports = MigrationRunner;
