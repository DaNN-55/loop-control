export function openChatCutProjectPath(path: string): string {
  return path.endsWith("/index.html") ? `${path.slice(0, -"/index.html".length)}/project.json` : path.endsWith(".json") ? path : `${path}/project.json`;
}
