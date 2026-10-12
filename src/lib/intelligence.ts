import { fallbackEntities } from "./analysis";
export async function extract(text: string) {
  return fallbackEntities(text);
}
