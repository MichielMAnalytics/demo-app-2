package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

var (
	db    *pgxpool.Pool
	cache *redis.Client
)

type Event struct {
	ID        int       `json:"id"`
	Type      string    `json:"type"`
	Payload   string    `json:"payload"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Connect to Postgres
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL != "" {
		var err error
		db, err = pgxpool.New(context.Background(), dbURL)
		if err != nil {
			log.Printf("WARNING: Could not connect to database: %v", err)
		} else {
			initDB()
			log.Println("Connected to PostgreSQL")
		}
	}

	// Connect to Valkey/Redis
	redisURL := os.Getenv("REDIS_URL")
	if redisURL != "" {
		opt, err := redis.ParseURL(redisURL)
		if err != nil {
			log.Printf("WARNING: Could not parse REDIS_URL: %v", err)
		} else {
			cache = redis.NewClient(opt)
			if err := cache.Ping(context.Background()).Err(); err != nil {
				log.Printf("WARNING: Could not connect to cache: %v", err)
			} else {
				log.Println("Connected to Valkey cache")
			}
		}
	}

	app := fiber.New(fiber.Config{
		AppName: "demo-app-2-api",
	})

	app.Use(logger.New())
	app.Use(cors.New())

	app.Get("/health", healthCheck)
	app.Get("/api/events", listEvents)
	app.Post("/api/events", createEvent)
	app.Get("/api/stats", getStats)

	log.Printf("API server starting on :%s", port)
	log.Fatal(app.Listen(":" + port))
}

func initDB() {
	ctx := context.Background()
	_, err := db.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS events (
			id SERIAL PRIMARY KEY,
			type VARCHAR(50) NOT NULL,
			payload JSONB DEFAULT '{}',
			status VARCHAR(20) DEFAULT 'pending',
			created_at TIMESTAMPTZ DEFAULT NOW()
		)
	`)
	if err != nil {
		log.Printf("WARNING: Could not initialize schema: %v", err)
	}
}

func healthCheck(c *fiber.Ctx) error {
	status := map[string]string{"status": "ok", "service": "api"}

	if db != nil {
		if err := db.Ping(context.Background()); err != nil {
			status["database"] = "error"
		} else {
			status["database"] = "connected"
		}
	} else {
		status["database"] = "not_configured"
	}

	if cache != nil {
		if err := cache.Ping(context.Background()).Err(); err != nil {
			status["cache"] = "error"
		} else {
			status["cache"] = "connected"
		}
	} else {
		status["cache"] = "not_configured"
	}

	return c.JSON(status)
}

func listEvents(c *fiber.Ctx) error {
	if db == nil {
		return c.Status(503).JSON(fiber.Map{"error": "database not configured"})
	}

	// Try cache first
	if cache != nil {
		cached, err := cache.Get(context.Background(), "events:list").Result()
		if err == nil {
			var events []Event
			if json.Unmarshal([]byte(cached), &events) == nil {
				return c.JSON(fiber.Map{"events": events, "source": "cache"})
			}
		}
	}

	rows, err := db.Query(context.Background(),
		"SELECT id, type, payload, status, created_at FROM events ORDER BY created_at DESC LIMIT 50")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.Type, &e.Payload, &e.Status, &e.CreatedAt); err != nil {
			continue
		}
		events = append(events, e)
	}

	// Cache for 10 seconds
	if cache != nil {
		data, _ := json.Marshal(events)
		cache.Set(context.Background(), "events:list", data, 10*time.Second)
	}

	return c.JSON(fiber.Map{"events": events, "source": "database"})
}

func createEvent(c *fiber.Ctx) error {
	if db == nil {
		return c.Status(503).JSON(fiber.Map{"error": "database not configured"})
	}

	var body struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid body"})
	}

	if body.Type == "" {
		return c.Status(400).JSON(fiber.Map{"error": "type is required"})
	}

	payload := "{}"
	if body.Payload != nil {
		payload = string(body.Payload)
	}

	var id int
	err := db.QueryRow(context.Background(),
		"INSERT INTO events (type, payload) VALUES ($1, $2) RETURNING id",
		body.Type, payload).Scan(&id)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	// Invalidate cache
	if cache != nil {
		cache.Del(context.Background(), "events:list")
		// Push to worker queue
		cache.LPush(context.Background(), "events:queue", fmt.Sprintf("%d", id))
		log.Printf("Pushed event %d to worker queue", id)
	}

	return c.Status(201).JSON(fiber.Map{"id": id, "status": "pending"})
}

func getStats(c *fiber.Ctx) error {
	if db == nil {
		return c.Status(503).JSON(fiber.Map{"error": "database not configured"})
	}

	// Try cache first
	if cache != nil {
		cached, err := cache.Get(context.Background(), "events:stats").Result()
		if err == nil {
			var stats map[string]interface{}
			if json.Unmarshal([]byte(cached), &stats) == nil {
				stats["source"] = "cache"
				return c.JSON(stats)
			}
		}
	}

	var total, pending, processed, failed int
	db.QueryRow(context.Background(), "SELECT COUNT(*) FROM events").Scan(&total)
	db.QueryRow(context.Background(), "SELECT COUNT(*) FROM events WHERE status = 'pending'").Scan(&pending)
	db.QueryRow(context.Background(), "SELECT COUNT(*) FROM events WHERE status = 'processed'").Scan(&processed)
	db.QueryRow(context.Background(), "SELECT COUNT(*) FROM events WHERE status = 'failed'").Scan(&failed)

	stats := map[string]interface{}{
		"total":     total,
		"pending":   pending,
		"processed": processed,
		"failed":    failed,
		"source":    "database",
	}

	if cache != nil {
		queueLen, _ := cache.LLen(context.Background(), "events:queue").Result()
		stats["queue_length"] = queueLen
		data, _ := json.Marshal(stats)
		cache.Set(context.Background(), "events:stats", data, 30*time.Second)
	}

	return c.JSON(stats)
}
