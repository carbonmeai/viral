import { createFileRoute } from "@tanstack/react-router"
import { HomePage } from "../modules/home/home-page.tsx"

export const Route = createFileRoute("/")({ component: HomePage })
