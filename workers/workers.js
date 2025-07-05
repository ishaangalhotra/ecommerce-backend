const { Worker } = require('bullmq');
const Redis = require('ioredis');
const nodemailer = require('nodemailer');
const { compileTemplate } = require('./utils/template');
const logger = require('./utils/logger');

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

connection.on('error', (err) => {
  logger.error('Redis connection error:', err);
});

const worker = new Worker('jobs', async (job) => {
  try {
    switch (job.name) {
      case 'sendEmail':
        const { to, subject, template, context } = job.data;
        
        if (!to || !subject || !template) {
          throw new Error('Missing required email parameters');
        }

        const html = await compileTemplate(template, context);
        
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
          }
        });

        await transporter.sendMail({
          from: `"${process.env.EMAIL_SENDER_NAME}" <${process.env.EMAIL_USER}>`,
          to,
          subject,
          html
        });
        break;

      default:
        logger.warn(`Unknown job type: ${job.name}`);
    }
  } catch (error) {
    logger.error(`Job ${job.id} failed:`, error);
    throw error; // Will trigger retry
  }
}, { 
  connection,
  limiter: {
    max: 10,
    duration: 1000
  }
});

worker.on('completed', (job) => {
  logger.info(`✅ Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  logger.error(`❌ Job ${job.id} failed:`, err);
});

worker.on('error', (err) => {
  logger.error('Worker error:', err);
});

process.on('SIGTERM', async () => {
  await worker.close();
  await connection.quit();
});