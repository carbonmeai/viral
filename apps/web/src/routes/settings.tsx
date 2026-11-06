import { createFileRoute, Outlet } from "@tanstack/react-router"

// Settings: each section is its own page; the sidebar lists them while you're here.
export const Route = createFileRoute("/settings")({ component: Outlet })
