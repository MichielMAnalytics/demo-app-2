export const metadata = {
	title: "Event Dashboard",
	description: "Real-time event processing dashboard",
};

export default function RootLayout({ children }) {
	return (
		<html lang="en">
			<body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0a0a0a", color: "#e5e5e5" }}>
				{children}
			</body>
		</html>
	);
}
