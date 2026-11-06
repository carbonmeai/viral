import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

// Joins class names and lets a later Tailwind class win over an earlier one of the same kind.
export const cn = (...inputs: ReadonlyArray<ClassValue>) => twMerge(clsx(inputs))
