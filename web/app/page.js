"use client";

import { useState, useEffect, useCallback } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export default function Home() {
	const [events, setEvents] = useState([]);
	const [stats, setStats] = useState(null);
	const [newType, setNewType] = useState("user.signup");
	const [loading, setLoading] = useState(false);
	const [source, setSource] = useState("");

	const fetchEvents = useCallback(async () => {
		try {
			const res = await fetch(`${API_URL}/api/events`);
			const data = await res.json();
			setEvents(data.events || []);
			setSource(data.source || "");
		} catch (err) {
			console.error("Failed to fetch events:", err);
		}
	}, []);

	const fetchStats = useCallback(async () => {
		try {
			const res = await fetch(`${API_URL}/api/stats`);
			const data = await res.json();
			setStats(data);
		} catch (err) {
			console.error("Failed to fetch stats:", err);
		}
	}, []);

	useEffect(() => {
		fetchEvents();
		fetchStats();
		const interval = setInterval(() => {
			fetchEvents();
			fetchStats();
		}, 5000);
		return () => clearInterval(interval);
	}, [fetchEvents, fetchStats]);

	const createEvent = async () => {
		setLoading(true);
		try {
			await fetch(`${API_URL}/api/events`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					type: newType,
					payload: { timestamp: Date.now(), demo: true },
				}),
			});
			await fetchEvents();
			await fetchStats();
		} catch (err) {
			console.error("Failed to create event:", err);
		}
		setLoading(false);
	};

	const statusColor = {
		pending: "#f59e0b",
		processed: "#22c55e",
		failed: "#ef4444",
		archived: "#6b7280",
	};

	return (
		<div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>
			<h1 style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>Event Dashboard</h1>
			<p style={{ color: "#888", marginBottom: "2rem" }}>
				Go API + Python Worker + Node.js Cron + Postgres + Valkey
			</p>

			{stats && (
				<div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
					{[
						["Total", stats.total, "#8b5cf6"],
						["Pending", stats.pending, "#f59e0b"],
						["Processed", stats.processed, "#22c55e"],
						["Failed", stats.failed, "#ef4444"],
					].map(([label, value, color]) => (
						<div key={label} style={{ background: "#1a1a1a", borderRadius: 8, padding: "1rem", border: "1px solid #333" }}>
							<div style={{ color: "#888", fontSize: "0.8rem", marginBottom: 4 }}>{label}</div>
							<div style={{ fontSize: "1.5rem", fontWeight: 700, color }}>{value ?? 0}</div>
						</div>
					))}
				</div>
			)}

			<div style={{ display: "flex", gap: "0.5rem", marginBottom: "2rem" }}>
				<select
					value={newType}
					onChange={(e) => setNewType(e.target.value)}
					style={{ background: "#1a1a1a", color: "#e5e5e5", border: "1px solid #333", borderRadius: 6, padding: "0.5rem 1rem" }}
				>
					<option value="user.signup">user.signup</option>
					<option value="order.placed">order.placed</option>
					<option value="payment.received">payment.received</option>
					<option value="email.sent">email.sent</option>
					<option value="webhook.received">webhook.received</option>
				</select>
				<button
					onClick={createEvent}
					disabled={loading}
					style={{
						background: "#8b5cf6",
						color: "white",
						border: "none",
						borderRadius: 6,
						padding: "0.5rem 1.5rem",
						cursor: loading ? "wait" : "pointer",
						opacity: loading ? 0.6 : 1,
					}}
				>
					{loading ? "Creating..." : "Create Event"}
				</button>
				{source && <span style={{ color: "#555", alignSelf: "center", fontSize: "0.8rem" }}>via {source}</span>}
			</div>

			<table style={{ width: "100%", borderCollapse: "collapse" }}>
				<thead>
					<tr style={{ borderBottom: "1px solid #333" }}>
						<th style={{ textAlign: "left", padding: "0.5rem", color: "#888", fontWeight: 500 }}>ID</th>
						<th style={{ textAlign: "left", padding: "0.5rem", color: "#888", fontWeight: 500 }}>Type</th>
						<th style={{ textAlign: "left", padding: "0.5rem", color: "#888", fontWeight: 500 }}>Status</th>
						<th style={{ textAlign: "left", padding: "0.5rem", color: "#888", fontWeight: 500 }}>Created</th>
					</tr>
				</thead>
				<tbody>
					{events.length === 0 ? (
						<tr>
							<td colSpan={4} style={{ padding: "2rem", textAlign: "center", color: "#555" }}>
								No events yet. Create one above.
							</td>
						</tr>
					) : (
						events.map((e) => (
							<tr key={e.id} style={{ borderBottom: "1px solid #1a1a1a" }}>
								<td style={{ padding: "0.5rem", fontFamily: "monospace" }}>#{e.id}</td>
								<td style={{ padding: "0.5rem" }}>{e.type}</td>
								<td style={{ padding: "0.5rem" }}>
									<span style={{
										color: statusColor[e.status] || "#888",
										fontWeight: 500,
									}}>
										{e.status}
									</span>
								</td>
								<td style={{ padding: "0.5rem", color: "#888" }}>
									{new Date(e.created_at).toLocaleTimeString()}
								</td>
							</tr>
						))
					)}
				</tbody>
			</table>

			{stats?.queue_length !== undefined && (
				<p style={{ color: "#555", fontSize: "0.8rem", marginTop: "1rem" }}>
					Worker queue depth: {stats.queue_length}
				</p>
			)}
		</div>
	);
}
