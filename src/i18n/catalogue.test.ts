import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import { routing } from "./routing";

/**
 * Guards the message catalogues against the two ways translations rot.
 *
 * A missing key is a runtime crash or a raw key rendered to a user. A dropped
 * ICU placeholder is worse, because it looks fine in review: "Objetivo" reads
 * perfectly until you notice the target value vanished. Neither is caught by
 * TypeScript, and neither is visible unless you happen to open that screen in
 * that language.
 */

const CATALOGUES: Record<string, unknown> = { en, es };

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const entries = new Map<string, string>();
  if (typeof value === "string") {
    entries.set(prefix.replace(/\.$/, ""), value);
    return entries;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      for (const [k, v] of flatten(child, `${prefix}${key}.`)) entries.set(k, v);
    }
  }
  return entries;
}

/**
 * ICU argument names, e.g. `{count}` or `{count, plural, ...}`.
 *
 * The name must be followed by `,` or `}`, which is what separates an argument
 * from a plural branch body — `{Encontramos # sesiones}` is prose, not a
 * placeholder, and a looser pattern reports every translated branch as a
 * mismatch.
 */
function placeholders(message: string): Set<string> {
  return new Set(
    [...message.matchAll(/\{\s*(\w+)\s*(?:,|\})/g)].map((match) => match[1]),
  );
}

const flat = Object.fromEntries(
  Object.entries(CATALOGUES).map(([locale, messages]) => [locale, flatten(messages)]),
);

describe("message catalogues", () => {
  it("ships a catalogue for every routed locale", () => {
    // A locale in the router with no messages 500s on first visit.
    for (const locale of routing.locales) {
      expect(Object.keys(CATALOGUES)).toContain(locale);
    }
  });

  it.each(routing.locales.filter((locale) => locale !== routing.defaultLocale))(
    "%s has exactly the keys English has",
    (locale) => {
      const base = [...flat[routing.defaultLocale].keys()].sort();
      const target = [...flat[locale].keys()].sort();
      expect(target).toEqual(base);
    },
  );

  it.each(routing.locales.filter((locale) => locale !== routing.defaultLocale))(
    "%s keeps every ICU placeholder",
    (locale) => {
      const mismatches: string[] = [];

      for (const [key, source] of flat[routing.defaultLocale]) {
        const translated = flat[locale].get(key);
        if (translated === undefined) continue;

        const expected = [...placeholders(source)].sort();
        const actual = [...placeholders(translated)].sort();
        if (expected.join() !== actual.join()) {
          mismatches.push(`${key}: expected {${expected}} got {${actual}}`);
        }
      }

      expect(mismatches).toEqual([]);
    },
  );

  it("leaves no message empty", () => {
    for (const [locale, messages] of Object.entries(flat)) {
      for (const [key, value] of messages) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("");
      }
    }
  });

  it("does not leave English text sitting in the Spanish catalogue", () => {
    // Catches the copy-paste-and-forget failure. Proper nouns and the language
    // names are legitimately identical, so they are exempt.
    const allowed = new Set(["app.name", "language.en", "language.es"]);
    const untranslated = [...flat.en]
      .filter(([key, value]) => {
        if (allowed.has(key)) return false;
        // Short strings collide innocently across languages ("Total", "min").
        return value.length > 24 && flat.es.get(key) === value;
      })
      .map(([key]) => key);

    expect(untranslated).toEqual([]);
  });
});
