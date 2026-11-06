import { createFileRoute } from "@tanstack/react-router"
import { AccountsPage } from "../modules/settings/accounts/accounts-page.tsx"

export const Route = createFileRoute("/settings/accounts")({ component: AccountsPage })
