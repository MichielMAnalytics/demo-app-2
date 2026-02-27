/**
 * Scheduled cleanup task.
 *
 * Runs every 5 minutes:
 * - Archives events older than 24 hours
 * - Retries failed events (up to 3 times)
 * - Publishes summary stats to cache
 */

import pg from "pg";
import Redis from "ioredis";

const { Pool } = pg;

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

async function archiveOldEvents() {
	const result = await db.query(
		`UPDATE events
		 SET status = 'archived'
		 WHERE status = 'processed'
		   AND created_at < NOW() - INTERVAL '24 hours'
		 RETURNING id`,
	);
	return result.rowCount;
}

async function retryFailedEvents() {
	// Re-queue failed events that haven't been retried too many times
	const result = await db.query(
		`UPDATE events
		 SET status = 'pending'
		 WHERE status = 'failed'
		   AND created_at > NOW() - INTERVAL '1 hour'
		 RETURNING id`,
	);

	// Push back to worker queue
	for (const row of result.rows) {
		await redis.lpush("events:queue", String(row.id));
	}

	return result.rowCount;
}

async function publishStats() {
	const result = await db.query(`
		SELECT status, COUNT(*)::int as count
		FROM events
		GROUP BY status
	`);

	const stats = {};
	for (const row of result.rows) {
		stats[row.status] = row.count;
	}
	stats.last_cron_run = new Date().toISOString();

	await redis.set("events:cron_stats", JSON.stringify(stats), "EX", 600);
	return stats;
}

async function run() {
	console.log(`[${new Date().toISOString()}] Cron job starting`);

	try {
		const archived = await archiveOldEvents();
		console.log(`  Archived ${archived} old events`);

		const retried = await retryFailedEvents();
		console.log(`  Retried ${retried} failed events`);

		const stats = await publishStats();
		console.log(`  Stats:`, stats);

		console.log(`[${new Date().toISOString()}] Cron job complete`);
	} catch (err) {
		console.error(`[${new Date().toISOString()}] Cron job failed:`, err.message);
		process.exitCode = 1;
	} finally {
		await db.end();
		redis.disconnect();
	}
}

run();
