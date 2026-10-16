export const SITE_URL = 'https://www.alburhaniyainternational.org.uk';
export const MAIN_EMAIL = 'info@alburhaniyainternational.org.uk';

// Translate only the former organisation identity in existing CMS content.
// Other custom contact addresses and external website links are preserved.
export function migrateSiteIdentity<T>(value: T): T {
  if (typeof value === 'string') return value
    .replace(/\binfo@al-burhaniyainternational\.co\.uk(?![a-z0-9_.-])/gi, MAIN_EMAIL)
    .replace(/https?:\/\/(?:www\.)?al-burhaniyainternational\.co\.uk(?=[\/?#\s"'<>]|$)/gi, SITE_URL) as T;
  if (Array.isArray(value)) return value.map(item => migrateSiteIdentity(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, migrateSiteIdentity(item)])) as T;
  return value;
}
