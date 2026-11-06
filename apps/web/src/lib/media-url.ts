// URLs for files the server serves from the Viral home (GET /media/<path>). An artifact's files sit in
// <owner folder>/<kind>/v<version>/, and its `path` and the files its data names are relative to that.

export type MediaOwner = { readonly _tag: "Source" | "Project" | "Reference"; readonly id: string }

const ownerFolder = (owner: MediaOwner) =>
  owner._tag === "Source" ? `sources/${owner.id}` : owner._tag === "Project" ? `projects/${owner.id}` : `references/${owner.id}`

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/")

// A file inside an artifact version's folder, e.g. ("Project", id), "shot-plan", 2, "frames/shot-01.jpg".
export const artifactFileUrl = (server: string, owner: MediaOwner, kind: string, version: number, file: string) =>
  `${server}/media/${encodePath(`${ownerFolder(owner)}/${kind}/v${version}/${file}`)}`

// An artifact's own `path` (relative to its owner's folder).
export const artifactPathUrl = (server: string, owner: MediaOwner, path: string) =>
  `${server}/media/${encodePath(`${ownerFolder(owner)}/${path}`)}`
