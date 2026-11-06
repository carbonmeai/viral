import { createFileRoute } from "@tanstack/react-router"
import { StoragePage } from "../modules/settings/storage/storage-page.tsx"

export const Route = createFileRoute("/settings/storage")({ component: StoragePage })
