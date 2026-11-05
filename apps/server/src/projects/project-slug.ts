// "01-he-put-every-taste-into-one-candy": the short's number within its source, then the title in kebab-case.
export const projectSlug = (number: number, title: string): string => {
  const words = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `${String(number).padStart(2, "0")}-${words === "" ? "short" : words}`
}
