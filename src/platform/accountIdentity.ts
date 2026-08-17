const accountColors = ["navy", "teal", "violet", "amber", "rose", "green"] as const;

export type AccountIdentityColor = (typeof accountColors)[number];

export function accountIdentityInitials(slug: string): string {
  const normalized = slug.trim().replace(/[^a-z0-9]+/gi, "").toUpperCase();
  return normalized.slice(0, 2).padEnd(2, "?");
}

export function accountIdentityColor(slug: string): AccountIdentityColor {
  let hash = 0;
  for (const character of slug.trim().toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return accountColors[hash % accountColors.length];
}
