"""
Event processor worker.

Pulls event IDs from a Redis queue, processes them (simulates work),
and updates their status in PostgreSQL.
"""

import json
import os
import random
import signal
import sys
import time
import logging

import psycopg2
import redis

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [worker] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

shutdown = False


def handle_signal(sig, frame):
    global shutdown
    log.info("Received shutdown signal, finishing current job...")
    shutdown = True


signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)


def connect_db():
    url = os.environ.get("DATABASE_URL")
    if not url:
        log.error("DATABASE_URL not set")
        sys.exit(1)
    return psycopg2.connect(url)


def connect_cache():
    url = os.environ.get("REDIS_URL")
    if not url:
        log.error("REDIS_URL not set")
        sys.exit(1)
    return redis.from_url(url)


def process_event(db, event_id: int) -> bool:
    """Simulate processing an event. Returns True on success."""
    cur = db.cursor()
    cur.execute("SELECT type, payload, status FROM events WHERE id = %s", (event_id,))
    row = cur.fetchone()

    if not row:
        log.warning(f"Event {event_id} not found, skipping")
        return False

    event_type, payload, status = row

    if status != "pending":
        log.info(f"Event {event_id} already {status}, skipping")
        return True

    log.info(f"Processing event {event_id} (type={event_type})")

    # Simulate work (1-3 seconds)
    work_time = random.uniform(1.0, 3.0)
    time.sleep(work_time)

    # 5% chance of failure for realism
    if random.random() < 0.05:
        cur.execute(
            "UPDATE events SET status = 'failed' WHERE id = %s",
            (event_id,),
        )
        db.commit()
        log.warning(f"Event {event_id} failed after {work_time:.1f}s")
        return False

    cur.execute(
        "UPDATE events SET status = 'processed' WHERE id = %s",
        (event_id,),
    )
    db.commit()
    log.info(f"Event {event_id} processed in {work_time:.1f}s")
    return True


def main():
    log.info("Worker starting up...")
    db = connect_db()
    rds = connect_cache()
    log.info("Connected to database and cache")

    processed = 0
    failed = 0

    while not shutdown:
        # Block-pop from queue with 5s timeout
        result = rds.brpop("events:queue", timeout=5)

        if result is None:
            continue  # Timeout, check shutdown flag and loop

        _, event_id_bytes = result
        event_id = int(event_id_bytes)

        try:
            if process_event(db, event_id):
                processed += 1
            else:
                failed += 1
        except Exception as e:
            log.error(f"Error processing event {event_id}: {e}")
            failed += 1

        if (processed + failed) % 10 == 0:
            log.info(f"Stats: {processed} processed, {failed} failed")

    log.info(f"Shutting down. Final stats: {processed} processed, {failed} failed")
    db.close()


if __name__ == "__main__":
    main()
